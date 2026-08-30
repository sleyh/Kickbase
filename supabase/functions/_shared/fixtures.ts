// deno-lint-ignore-file no-explicit-any
/**
 * Shared Bundesliga table/fixture lookups. Originally built inline inside
 * squad-rating.ts for its fixture-difficulty adjustment; pulled out here
 * since player-detail.ts and team-detail.ts need the same table/match
 * data and shouldn't each fetch it their own way.
 */

import { KickbaseClient } from "./kickbase-client.ts";

export const BUNDESLIGA_COMPETITION_ID = "1";

// Team "strength" blends two different signals on purpose: table
// position alone is noisy early in a season (small sample, a couple of
// results can swing it a lot), while squad market value is a steadier
// read on underlying quality but doesn't capture current form. Weights
// are a judgment call, not derived - retune here if it doesn't feel
// right against a real table.
const WEIGHT_RANK = 0.6;
const WEIGHT_MARKET_VALUE = 0.4;

export interface TeamStanding {
  tid: string;
  name: string;
  rank: number; // 1-based (from the table's own "cpl" field), 1 = strongest
  strength: number; // 0..1 blend of rank + squad market value, 1 = strongest
  crest: string | null;
}

/**
 * Every listed player's market value, summed by team - confirmed live
 * that the competition table itself carries no squad-value field (just
 * cpl/pts/goal-difference), so this is the closest available proxy:
 * whichever players are currently on this league's own computer market,
 * grouped by club. Not a true full-squad valuation (there's no
 * confirmed "all players for a team" endpoint to build one from - see
 * team-detail.ts's own roster disclaimer) - a team with few or no
 * players listed at the moment this runs will undervalue here, which is
 * exactly why this is blended with table position rather than used
 * alone.
 */
async function fetchTeamMarketValues(client: KickbaseClient, leagueId: string): Promise<Map<string, number>> {
  const marketResp = await client.getMarket(leagueId);
  const items: any[] = marketResp?.it ?? [];
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!item.tid || item.mv == null) continue;
    totals.set(item.tid, (totals.get(item.tid) ?? 0) + item.mv);
  }
  return totals;
}

function normalize01(values: number[], value: number): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0.5;
  return (value - min) / (max - min);
}

/**
 * The competition table, rank-ordered by the table's own "cpl" (current
 * placement) field - confirmed live, not guessed - refined into a
 * blended strength score with each team's approximate squad market value.
 */
export async function fetchLeagueTable(client: KickbaseClient, leagueId: string): Promise<TeamStanding[]> {
  const [tableResp, marketValueByTeam] = await Promise.all([
    client.getCompetitionTable(BUNDESLIGA_COMPETITION_ID),
    fetchTeamMarketValues(client, leagueId),
  ]);

  const table: any[] = tableResp?.it ?? [];
  const ranked = [...table].sort((a, b) => (a.cpl ?? 0) - (b.cpl ?? 0));
  const teamCount = Math.max(1, ranked.length - 1);
  const mvValues = ranked.map((t) => marketValueByTeam.get(t.tid) ?? 0);

  return ranked.map((t, i) => {
    const rankStrength = 1 - i / teamCount;
    const mv = marketValueByTeam.get(t.tid);
    const mvStrength = mv != null ? normalize01(mvValues, mv) : 0.5;
    return {
      tid: t.tid,
      name: t.tn,
      rank: t.cpl ?? i + 1,
      strength: rankStrength * WEIGHT_RANK + mvStrength * WEIGHT_MARKET_VALUE,
      crest: t.tim ?? null,
    };
  });
}

/** Every match across every matchday, raw, unfiltered - one call, callers filter with the helpers below. */
export async function fetchAllMatches(client: KickbaseClient): Promise<any[]> {
  const matchdaysResp = await client.getCompetitionMatchdays(BUNDESLIGA_COMPETITION_ID);
  const matchdays: any[] = matchdaysResp?.it ?? [];
  return matchdays.flatMap((d: any) => d.it ?? []);
}

/** A team's next N scheduled (not yet started) matches, soonest first. */
export function scheduledMatchesForTeam(matches: any[], teamId: string, n = Infinity): any[] {
  return matches
    .filter((m: any) => (m.t1 === teamId || m.t2 === teamId) && (m.st ?? 0) === 0)
    .sort((a: any, b: any) => new Date(a.dt).getTime() - new Date(b.dt).getTime())
    .slice(0, n);
}

/** A team's last N finished matches, most recent first. */
export function finishedMatchesForTeam(matches: any[], teamId: string, n = Infinity): any[] {
  return matches
    .filter((m: any) => (m.t1 === teamId || m.t2 === teamId) && (m.st ?? 0) !== 0)
    .sort((a: any, b: any) => new Date(b.dt).getTime() - new Date(a.dt).getTime())
    .slice(0, n);
}
