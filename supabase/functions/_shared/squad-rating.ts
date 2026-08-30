// deno-lint-ignore-file no-explicit-any
/**
 * A 0-100 "value rating" per squad player, blending current performance
 * (points), recent momentum (d1+d7), a minor value-tier signal (mv), and
 * a fixture-difficulty adjustment (upcoming opponents' league strength -
 * tough opponents pull the rating down, weak ones push it up).
 *
 * Deliberately relative to the user's OWN squad (min-max normalized
 * within it) - there's no full-player-pool endpoint to benchmark
 * against here, so this ranks "who on my roster looks best right now,"
 * not an absolute league-wide quality score. The weights below are a
 * judgment call, not a derived constant - retune here if the output
 * doesn't feel right against a real squad.
 */

import { KickbaseClient } from "./kickbase-client.ts";
import { fetchAllMatches, fetchLeagueTable, scheduledMatchesForTeam } from "./fixtures.ts";

const UPCOMING_FIXTURES_TO_CONSIDER = 3;

const WEIGHT_PERFORMANCE = 0.45;
const WEIGHT_MOMENTUM = 0.3;
const WEIGHT_VALUE_TIER = 0.1;
// The remaining 0.15 of the 1.0 weight budget belongs to fixtures: a
// neutral (average-strength) set of opponents contributes its "50%"
// value (15), swinging up to +/-15 either way for the easiest/toughest
// possible run of fixtures.
const FIXTURE_SWING = 30;
const FIXTURE_BASE = 15;

function minMaxNormalize(values: number[], value: number): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

/**
 * Every Bundesliga team's average opponent strength over its next
 * UPCOMING_FIXTURES_TO_CONSIDER scheduled matches - one league-table
 * fetch + one matchdays fetch total, not per player.
 */
async function fetchUpcomingOpponentStrength(client: KickbaseClient, leagueId: string): Promise<Map<string, number>> {
  const [table, matches] = await Promise.all([fetchLeagueTable(client, leagueId), fetchAllMatches(client)]);
  const strengthByTeam = new Map(table.map((t) => [t.tid, t.strength]));

  const opponentStrengthByTeam = new Map<string, number>();
  for (const team of table) {
    const nextMatches = scheduledMatchesForTeam(matches, team.tid, UPCOMING_FIXTURES_TO_CONSIDER);
    if (nextMatches.length === 0) continue;
    const strengths = nextMatches.map((m: any) => {
      const opponentId = m.t1 === team.tid ? m.t2 : m.t1;
      return strengthByTeam.get(opponentId) ?? 0.5;
    });
    opponentStrengthByTeam.set(team.tid, strengths.reduce((sum, v) => sum + v, 0) / strengths.length);
  }
  return opponentStrengthByTeam;
}

export interface RatingInput {
  tid: string | null;
  points: number | null;
  d1: number | null;
  d7: number | null;
  value: number;
}

/** Returns one 0-100 rating per input player, same order. */
export async function computeSquadRatings(
  client: KickbaseClient,
  leagueId: string,
  players: RatingInput[]
): Promise<number[]> {
  if (players.length === 0) return [];

  const opponentStrength = await fetchUpcomingOpponentStrength(client, leagueId);

  const pointsValues = players.map((p) => p.points ?? 0);
  const momentumValues = players.map((p) => (p.d1 ?? 0) + (p.d7 ?? 0));
  const valueValues = players.map((p) => p.value);

  return players.map((p) => {
    const perf = minMaxNormalize(pointsValues, p.points ?? 0);
    const momentum = minMaxNormalize(momentumValues, (p.d1 ?? 0) + (p.d7 ?? 0));
    const valueTier = minMaxNormalize(valueValues, p.value);
    const strength = p.tid != null ? opponentStrength.get(p.tid) : undefined;
    const fixtureAdjustment = strength != null ? (0.5 - strength) * FIXTURE_SWING : 0;

    const rating =
      perf * WEIGHT_PERFORMANCE +
      momentum * WEIGHT_MOMENTUM +
      valueTier * WEIGHT_VALUE_TIER +
      fixtureAdjustment +
      FIXTURE_BASE;

    return Math.max(0, Math.min(100, Math.round(rating)));
  });
}
