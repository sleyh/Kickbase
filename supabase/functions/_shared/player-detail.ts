// deno-lint-ignore-file no-explicit-any
/**
 * A full profile for one player: current value + full history (not the
 * 7-point sparkline used elsewhere), season points, and upcoming
 * fixture difficulty for their club - reusing the same fixtures.ts
 * lookups squad-rating.ts uses for the Squad page's rating. If the
 * player is in the caller's own squad, also surfaces when/for how much
 * they bought them.
 */

import { KickbaseClient, KickbaseError } from "./kickbase-client.ts";
import { allManagerTransfers } from "./squad-value.ts";
import { fetchAllMatches, fetchLeagueTable, scheduledMatchesForTeam } from "./fixtures.ts";
import { ownerOf } from "./market.ts";

const UPCOMING_FIXTURES_TO_SHOW = 5;

export interface PlayerDetailReport {
  id: string;
  name: string;
  photo: string | null;
  pos: number | null;
  team: { id: string; name: string; crest: string | null } | null;
  value: number | null;
  points: number | null;
  history: Array<{ day: number; value: number }>;
  upcomingFixtures: Array<{
    opponentId: string;
    opponentName: string;
    opponentCrest: string | null;
    opponentStrength: number;
    date: string;
  }>;
  ownership: { boughtPrice: number; boughtDate: string } | null;
  /** The manager currently selling this player, if they're presently listed on the market by one - same "u" object market.ts's ownerOf() reads. null if not currently listed, or listed by the computer market. */
  listedBy: { id: string; name: string; photo: string | null } | null;
}

function playerName(p: any): string {
  const first = p.fn ?? "";
  const last = p.n ?? p.ln ?? "";
  return [first, last].filter(Boolean).join(" ") || "?";
}

export async function buildPlayerDetail(
  client: KickbaseClient,
  leagueId: string,
  playerId: string
): Promise<PlayerDetailReport> {
  const player = await client.getPlayer(leagueId, playerId);

  const [historyResp, table, matches, marketResp] = await Promise.all([
    client.getMarketValueHistory(leagueId, playerId, 92).catch((err) => {
      if (err instanceof KickbaseError) return null;
      throw err;
    }),
    fetchLeagueTable(client, leagueId),
    fetchAllMatches(client),
    client.getMarket(leagueId).catch((err) => {
      if (err instanceof KickbaseError) return null;
      throw err;
    }),
  ]);

  const marketItem = (marketResp?.it ?? []).find((item: any) => item.i === playerId);
  const listedBy = marketItem ? ownerOf(marketItem) : null;

  const history = ((historyResp?.it ?? []) as any[]).map((e) => ({ day: e.dt, value: e.mv }));

  const tid: string | null = player.tid ?? null;
  const teamEntry = tid != null ? table.find((t) => t.tid === tid) : undefined;
  const team = teamEntry ? { id: teamEntry.tid, name: teamEntry.name, crest: teamEntry.crest } : null;

  const upcomingFixtures = tid
    ? scheduledMatchesForTeam(matches, tid, UPCOMING_FIXTURES_TO_SHOW).map((m: any) => {
        const opponentId = m.t1 === tid ? m.t2 : m.t1;
        const opponent = table.find((t) => t.tid === opponentId);
        return {
          opponentId,
          opponentName: opponent?.name ?? opponentId,
          opponentCrest: opponent?.crest ?? null,
          opponentStrength: opponent?.strength ?? 0.5,
          date: m.dt,
        };
      })
    : [];

  let ownership: PlayerDetailReport["ownership"] = null;
  try {
    const myLog = await allManagerTransfers(client, leagueId, client.userId!);
    const buys = myLog.filter((t: any) => t.pi === playerId && t.tty === 1);
    const latestBuy = buys.reduce((latest: any, t: any) => (!latest || t.dt > latest.dt ? t : latest), null);
    if (latestBuy) {
      ownership = { boughtPrice: latestBuy.trp ?? 0, boughtDate: latestBuy.dt };
    }
  } catch (err) {
    if (!(err instanceof KickbaseError)) throw err;
  }

  return {
    id: playerId,
    name: playerName(player),
    photo: player.pim ?? null,
    pos: player.pos ?? null,
    team,
    value: player.mv ?? null,
    points: player.tp ?? player.p ?? player.ap ?? null,
    history,
    upcomingFixtures,
    ownership,
    listedBy,
  };
}
