// deno-lint-ignore-file no-explicit-any
/**
 * TypeScript port of the squad-value data-gathering logic from
 * kickbase/cli.py (_enrich_with_history, the day-index/attribution
 * helpers, _estimate_manager_budget, _fetch_competitors, and
 * cmd_squad_value's own assembly) - kept separate from report.ts the
 * same way cli.py (fetch/compute) and report.py (render) are separate
 * modules in the Python original.
 *
 * One deliberate scope cut from the Python version for this first pass:
 * _estimate_manager_budget() there also adds inferred achievement
 * rewards (achievements.py + a persisted "newly unlocked" tracker). That
 * subsystem isn't ported yet, so competitor budget estimates here are a
 * slightly lower bound than the Python CLI's - consistent with the
 * existing "likely a lower bound" disclaimer already shown in the UI,
 * since an achievement reward is exactly the kind of thing that
 * disclaimer already warns isn't counted.
 */

import { KickbaseClient, KickbaseError } from "./kickbase-client.ts";
import { historyDeltas } from "./predict.ts";
import { computeSquadRatings } from "./squad-rating.ts";

const UPDATE_CUTOFF_HOUR_UTC = 18; // the daily market-value update empirically fires ~18:00-20:00 UTC

function dayIndex(dtStr: string): number {
  const dt = new Date(dtStr);
  return Math.floor(dt.getTime() / 86_400_000);
}

/**
 * Epoch day index of the *first* daily update this purchase was already
 * in place for - a purchase asks "which update already reflects my
 * ownership", which does not shift pre-cutoff (the imminent update is
 * the first one that does). A player bought pre-cutoff the same day an
 * update fired was once wrongly excluded from that day's attributed
 * gain - caught live, this is the fix.
 */
function firstUpdateDayAfterBuy(buyDt: string): number {
  const dt = new Date(buyDt);
  const day = dayIndex(buyDt);
  return dt.getUTCHours() < UPDATE_CUTOFF_HOUR_UTC ? day : day + 1;
}

function ownedSinceDay(playerId: string, transferLog: any[]): number | null {
  const buys = transferLog.filter((t) => t.pi === playerId && t.tty === 1);
  if (buys.length === 0) return null;
  const latest = buys.reduce((max, t) => (t.dt > max ? t.dt : max), buys[0].dt);
  return firstUpdateDayAfterBuy(latest);
}

/**
 * Whether a player's d1 can be credited to their current owner in a
 * "squad total gain today" sum. Attributable iff their purchase was
 * already in place for the update that produced d1.
 */
export function isDeltaAttributable(player: any, transferLog: any[]): boolean {
  const windowStart = player.d1WindowStartDay;
  if (windowStart == null) return true; // no window info to compare against - don't exclude
  const ownedSince = ownedSinceDay(player.i, transferLog);
  if (ownedSince == null) return true; // starting allocation - always attributable
  return ownedSince <= windowStart + 1;
}

/** get_manager_squad()'s items use pi/pn instead of getSquad()'s i/fn+n - remap in place. */
export function normalizeManagerSquadItems(items: any[]): any[] {
  for (const item of items) {
    item.i = item.pi;
    item.n = item.pn;
  }
  return items;
}

/**
 * Mutates each player in place, attaching real d1/d7/d1WindowStartDay
 * from Kickbase's own history endpoint. Also stashes the raw per-day
 * entries under _historyEntries - not part of any public report shape
 * (every payload builds its own explicit object), just there for
 * buildValueTrend() below to sum without a second round of API calls.
 */
export async function enrichWithHistory(
  client: KickbaseClient,
  leagueId: string,
  players: any[]
): Promise<void> {
  await Promise.all(
    players.map(async (player) => {
      const playerId = player.i;
      if (!playerId) return;
      try {
        const history = await client.getMarketValueHistory(leagueId, playerId);
        Object.assign(player, historyDeltas(history));
        player._historyEntries = history?.it ?? [];
      } catch (err) {
        if (!(err instanceof KickbaseError)) throw err;
      }
    })
  );
}

export interface ValueTrendPoint {
  day: number;
  totalValue: number;
}

/** A player's own recent market-value points (up to the last 7 days), from the same _historyEntries enrichWithHistory() already stashed - for a per-player sparkline, no extra fetch. */
function playerSparkline(entries: any[]): number[] {
  return [...(entries ?? [])]
    .filter((e) => e?.mv != null && e?.dt != null)
    .sort((a, b) => a.dt - b.dt)
    .slice(-7)
    .map((e) => e.mv);
}

/**
 * Squad-wide value per day for roughly the last two weeks, built from the
 * same getMarketValueHistory() entries enrichWithHistory() already
 * fetched for d1/d7 - no extra API calls. Sums whichever players have a
 * value for a given day (not ownership-filtered like the d1 attribution
 * logic above - a simpler "what was the squad worth" trend line, not a
 * "what did I gain" one).
 */
export function buildValueTrend(players: any[]): ValueTrendPoint[] {
  const byDay = new Map<number, number>();
  for (const player of players) {
    for (const entry of player._historyEntries ?? []) {
      if (entry?.dt == null || entry?.mv == null) continue;
      byDay.set(entry.dt, (byDay.get(entry.dt) ?? 0) + entry.mv);
    }
  }
  return [...byDay.keys()]
    .sort((a, b) => a - b)
    .slice(-14)
    .map((day) => ({ day, totalValue: byDay.get(day)! }));
}

/** Every transfer for a manager, walking pagination fully. */
export async function allManagerTransfers(
  client: KickbaseClient,
  leagueId: string,
  managerId: string
): Promise<any[]> {
  const entries: any[] = [];
  let start = 0;
  while (true) {
    const batch = (await client.getManagerTransfers(leagueId, managerId, start)).it ?? [];
    if (batch.length === 0) break;
    entries.push(...batch);
    start += batch.length;
  }
  return entries;
}

/**
 * Reconstructs a manager's current budget: the fixed 150M starting
 * allocation, minus their starting-allocation squad's value, minus
 * everything they've ever bought, plus everything they've ever sold. See
 * the module docstring for the achievement-reward scope cut vs. the
 * Python original.
 *
 * Previously anchored the starting squad's value to the day the manager
 * joined (`jd` on getRanking()'s response). Confirmed live that field no
 * longer exists on that endpoint at all - every field a real league's
 * ranking response actually carries (i, n, adm, sp, mdp, shp, tv, spl,
 * mdpl, pa, lp, lipc, ppc, uim, hhsp, hll) was checked, none is a date -
 * so estimatedBudget was silently coming back null for every competitor.
 *
 * A first fix valued still-held starting players at *today's* price
 * instead - checked against the one real number this app can verify
 * exactly (the logged-in account's own getBudget(), -15.97M at the time
 * of checking): that version came back +34.1M, ~50M too high, because
 * (a) today's price has drifted well above assignment-day price for
 * players who've since gained value, and (b) starting players that have
 * *since been sold* weren't valued at all - a real gap for anyone who's
 * traded actively, i.e. exactly the managers a "spending power" number
 * matters most for. That's what "returning a debt/spending-capacity
 * number instead of the actual budget" looked like in practice.
 *
 * This version instead fetches each starting-allocation player's full
 * 365-day getMarketValueHistory() (covers this league's entire history -
 * confirmed live the real league is 13 days old) and uses the *earliest*
 * entry in it as the assignment-day price proxy, for every starting
 * player who's ever been held (current squad or since sold) - not just
 * the ones still on the roster. Checked against the same known-real
 * number: -7.3M, ~8.6M off instead of ~50M. Not exact - Kickbase's own
 * daily snapshot granularity means "earliest tracked price" isn't
 * necessarily "price at the literal moment of assignment," and a
 * starting player later re-bought after being sold gets excluded from
 * this calculation entirely (shows up in boughtIdsEver, so it's
 * indistinguishable from a normal market buy) - but it's a real
 * historical anchor instead of a live one, which is the actual ask.
 */
export async function estimateManagerBudget(
  client: KickbaseClient,
  leagueId: string,
  squadItems: any[],
  log: any[]
): Promise<number> {
  const boughtIdsEver = new Set(log.filter((t) => t.tty === 1).map((t) => t.pi));
  const currentIds = new Set(squadItems.map((p) => p.i));
  const soldIds = new Set(log.filter((t) => t.tty === 2).map((t) => t.pi));
  const startingIds = [...new Set([...currentIds, ...soldIds])].filter((id) => !boughtIdsEver.has(id));

  let startingCost = 0;
  await Promise.all(
    startingIds.map(async (playerId) => {
      try {
        const history = await client.getMarketValueHistory(leagueId, playerId as string, 365);
        const entries: any[] = history?.it ?? [];
        if (entries.length === 0) return;
        const earliest = entries.reduce((min, e) => (e.dt < min.dt ? e : min));
        startingCost += earliest.mv ?? 0;
      } catch (err) {
        if (!(err instanceof KickbaseError)) throw err;
      }
    })
  );

  const totalBought = log.filter((t) => t.tty === 1).reduce((sum, t) => sum + (t.trp ?? 0), 0);
  const totalSold = log.filter((t) => t.tty === 2).reduce((sum, t) => sum + (t.trp ?? 0), 0);

  return 150_000_000 - startingCost - totalBought + totalSold;
}

export interface CompetitorSummary {
  id: string;
  name: string;
  totalValue: number;
  totalDelta: number | null;
  estimatedBudget: number | null;
  photo: string | null;
}

/**
 * Every other league member's squad value, today's gain/loss, and
 * estimated budget. Returns null (rather than a partial/misleading list)
 * if the ranking call itself fails; a single competitor's squad failing
 * to load just drops that one manager.
 */
export async function fetchCompetitors(
  client: KickbaseClient,
  leagueId: string
): Promise<CompetitorSummary[] | null> {
  let ranking: any;
  try {
    ranking = await client.getRanking(leagueId);
  } catch {
    return null;
  }

  const managers: any[] = ranking.us ?? [];
  const competitors: CompetitorSummary[] = [];

  await Promise.all(
    managers.map(async (manager) => {
      const managerId = manager.i;
      const managerName = manager.n ?? "?";
      if (!managerId || managerId === client.userId) return;

      let squadResponse: any;
      try {
        squadResponse = await client.getManagerSquad(leagueId, managerId);
      } catch {
        return;
      }
      const squad: any[] = squadResponse.it ?? [];
      const photo: string | null = squadResponse.uim ?? null;
      normalizeManagerSquadItems(squad);
      await enrichWithHistory(client, leagueId, squad);
      const totalValue = squad.reduce((sum, p) => sum + (p.mv ?? 0), 0);

      const log = await allManagerTransfers(client, leagueId, managerId);
      const attributable = squad.filter((p) => p.d1 != null && isDeltaAttributable(p, log));
      const totalDelta = attributable.length > 0 ? attributable.reduce((sum, p) => sum + p.d1, 0) : null;

      const estimatedBudget = await estimateManagerBudget(client, leagueId, squad, log);

      competitors.push({ id: managerId, name: managerName, totalValue, totalDelta, estimatedBudget, photo });
    })
  );

  return competitors;
}

export interface SquadValueReport {
  leagueName: string;
  budget: number;
  totalValue: number;
  netWorth: number;
  totalDelta: number;
  players: Array<{
    id: string;
    name: string;
    value: number;
    d1: number;
    d7: number | null;
    points: number | null;
    rating: number;
    attributable: boolean;
    photo: string | null;
    sparkline: number[];
    pos: number | null;
    tid: string | null;
  }>;
  noHistoryYet: string[];
  competitors: CompetitorSummary[] | null;
  valueTrend: ValueTrendPoint[];
}

function playerName(player: any): string {
  const first = player.fn ?? "";
  const last = player.n ?? player.ln ?? "";
  const name = [first, last].filter(Boolean).join(" ");
  return name || "?";
}

/**
 * TS port of cmd_squad_value()'s data assembly (own squad + budget +
 * history enrichment + attribution flags + competitors), returning
 * structured data rather than printing - report.ts renders this both to
 * the dashboard's JSON shape and to a Telegram HTML string.
 */
export async function buildSquadValueReport(
  client: KickbaseClient,
  leagueId: string,
  leagueName: string,
  includeCompetitors: boolean
): Promise<SquadValueReport> {
  const squad: any[] = (await client.getSquad(leagueId)).it ?? [];
  const budget = (await client.getBudget(leagueId)).b ?? 0;
  await enrichWithHistory(client, leagueId, squad);

  const myLog = await allManagerTransfers(client, leagueId, client.userId!);
  for (const player of squad) {
    player.attributable = isDeltaAttributable(player, myLog);
  }

  const withDelta = squad.filter((p) => p.d1 != null);
  const withoutDelta = squad.filter((p) => p.d1 == null);
  const totalDelta = withDelta
    .filter((p) => p.attributable !== false)
    .reduce((sum, p) => sum + p.d1, 0);
  const totalValue = squad.reduce((sum, p) => sum + (p.mv ?? 0), 0);

  withDelta.sort((a, b) => b.d1 - a.d1);

  const competitors = includeCompetitors ? await fetchCompetitors(client, leagueId) : null;

  const ratings = await computeSquadRatings(
    client,
    leagueId,
    withDelta.map((p) => ({
      tid: p.tid ?? null,
      points: p.tp ?? p.p ?? p.ap ?? null,
      d1: p.d1,
      d7: p.d7 ?? null,
      value: p.mv ?? 0,
    }))
  );

  return {
    leagueName,
    budget,
    totalValue,
    netWorth: budget + totalValue,
    totalDelta,
    players: withDelta.map((p, i) => ({
      id: p.i,
      name: playerName(p),
      value: p.mv ?? 0,
      d1: p.d1,
      d7: p.d7 ?? null,
      points: p.tp ?? p.p ?? p.ap ?? null,
      rating: ratings[i],
      attributable: p.attributable !== false,
      photo: p.pim ?? null,
      sparkline: playerSparkline(p._historyEntries),
      pos: p.pos ?? null,
      tid: p.tid ?? null,
    })),
    noHistoryYet: withoutDelta.map((p) => playerName(p)),
    competitors,
    valueTrend: buildValueTrend(squad),
  };
}
