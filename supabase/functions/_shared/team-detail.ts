// deno-lint-ignore-file no-explicit-any
/**
 * Standing + recent/upcoming fixtures for one Bundesliga club.
 * Deliberately doesn't claim a full squad/roster list - there's no
 * confirmed "all players for a team" endpoint, and assembling one from
 * just whichever players happen to be in this league's squads/market
 * would be a misleadingly incomplete list, not a real roster.
 */

import { KickbaseClient } from "./kickbase-client.ts";
import { fetchAllMatches, fetchLeagueTable, finishedMatchesForTeam, scheduledMatchesForTeam } from "./fixtures.ts";

const FIXTURES_TO_SHOW = 5;

export interface TeamFixture {
  matchId: string;
  opponentId: string;
  opponentName: string;
  opponentStrength: number;
  date: string;
  home: boolean;
  ownGoals: number | null;
  opponentGoals: number | null;
}

export interface TeamDetailReport {
  id: string;
  name: string;
  rank: number | null;
  strength: number | null;
  recentMatches: TeamFixture[];
  upcomingMatches: TeamFixture[];
}

export async function buildTeamDetail(client: KickbaseClient, teamId: string): Promise<TeamDetailReport> {
  const [table, matches] = await Promise.all([fetchLeagueTable(client), fetchAllMatches(client)]);
  const team = table.find((t) => t.tid === teamId);

  function toFixture(m: any): TeamFixture {
    const home = m.t1 === teamId;
    const opponentId = home ? m.t2 : m.t1;
    const opponent = table.find((t) => t.tid === opponentId);
    return {
      matchId: m.mi,
      opponentId,
      opponentName: opponent?.name ?? opponentId,
      opponentStrength: opponent?.strength ?? 0.5,
      date: m.dt,
      home,
      ownGoals: (home ? m.t1g : m.t2g) ?? null,
      opponentGoals: (home ? m.t2g : m.t1g) ?? null,
    };
  }

  return {
    id: teamId,
    name: team?.name ?? teamId,
    rank: team?.rank ?? null,
    strength: team?.strength ?? null,
    recentMatches: finishedMatchesForTeam(matches, teamId, FIXTURES_TO_SHOW).map(toFixture),
    upcomingMatches: scheduledMatchesForTeam(matches, teamId, FIXTURES_TO_SHOW).map(toFixture),
  };
}
