// deno-lint-ignore-file no-explicit-any
/**
 * Shared Bundesliga table/fixture lookups. Originally built inline inside
 * squad-rating.ts for its fixture-difficulty adjustment; pulled out here
 * since player-detail.ts and team-detail.ts need the same table/match
 * data and shouldn't each fetch it their own way.
 */

import { KickbaseClient } from "./kickbase-client.ts";

export const BUNDESLIGA_COMPETITION_ID = "1";

export interface TeamStanding {
  tid: string;
  name: string;
  rank: number; // 1-based, 1 = strongest
  strength: number; // 0..1, 1 = strongest
}

/**
 * The competition table, rank-ordered. Array position is the primary
 * rank signal (a "table" endpoint is inherently ordered), refined by an
 * explicit rank/points field when one is present - doesn't depend on
 * knowing the exact field name Kickbase uses for it.
 */
export async function fetchLeagueTable(client: KickbaseClient): Promise<TeamStanding[]> {
  const tableResp = await client.getCompetitionTable(BUNDESLIGA_COMPETITION_ID);
  const table: any[] = tableResp?.it ?? [];
  const ranked = [...table].sort((a, b) => {
    const aRank = a.pos ?? a.tp ?? null;
    const bRank = b.pos ?? b.tp ?? null;
    return aRank != null && bRank != null ? aRank - bRank : 0;
  });
  const teamCount = Math.max(1, ranked.length - 1);
  return ranked.map((t, i) => ({
    tid: t.tid,
    name: t.tn,
    rank: i + 1,
    strength: 1 - i / teamCount,
  }));
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
