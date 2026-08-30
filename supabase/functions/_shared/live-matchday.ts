// deno-lint-ignore-file no-explicit-any
/**
 * TypeScript port of the live-data endpoints discovered live in this
 * session (not present in the original Python CLI, which predates them):
 * teamcenter/myeleven for real-time per-player fantasy points, and
 * users/{userId}/teamcenter for a live league-wide standings board.
 * Bundesliga is hardcoded as competition "1", matching every other
 * hardcoded assumption already in this codebase (single-league,
 * single-competition personal tool).
 */

import { KickbaseClient } from "./kickbase-client.ts";

const BUNDESLIGA_COMPETITION_ID = "1";

/** The matchday most recently underway - the highest day number with at least one match that's kicked off (st != 0). */
async function currentMatchday(client: KickbaseClient): Promise<{ day: number; matches: any[] } | null> {
  const matchdays = (await client.getCompetitionMatchdays(BUNDESLIGA_COMPETITION_ID)).it ?? [];
  const started = matchdays.filter((d: any) => (d.it ?? []).some((m: any) => (m.st ?? 0) !== 0));
  if (started.length === 0) return null;
  const latest = started.reduce((a: any, b: any) => (b.day > a.day ? b : a));
  return { day: latest.day, matches: latest.it ?? [] };
}

export interface LiveMatchTeam {
  id: string;
  name: string;
  crest: string | null;
  goals: number;
}

export interface LiveMatchGroup {
  team1: LiveMatchTeam;
  team2: LiveMatchTeam;
  minute: string;
  status: number;
  isLive: boolean;
  players: Array<{ id: string; name: string; points: number; team: string; photo: string | null }>;
}

export interface LiveStandingEntry {
  id: string;
  name: string;
  points: number;
  isYou: boolean;
  photo: string | null;
}

export interface LiveMatchdayReport {
  leagueName: string;
  day: number | null;
  myMatches: LiveMatchGroup[];
  standings: LiveStandingEntry[];
}

export async function buildLiveMatchdayReport(
  client: KickbaseClient,
  leagueId: string,
  leagueName: string
): Promise<LiveMatchdayReport> {
  const dayInfo = await currentMatchday(client);
  const day = dayInfo?.day ?? null;

  const teamNames = new Map<string, string>();
  const teamCrests = new Map<string, string | null>();
  if (day != null) {
    const table = (await client.getCompetitionTable(BUNDESLIGA_COMPETITION_ID)).it ?? [];
    for (const t of table) {
      teamNames.set(t.tid, t.tn);
      teamCrests.set(t.tid, t.tim ?? null);
    }
  }

  const myMatches: LiveMatchGroup[] = [];
  if (day != null) {
    const myEleven = await client.getTeamcenterMyEleven(leagueId);
    const players: any[] = myEleven.lp ?? [];
    const matchByTeam = new Map<string, any>();
    for (const m of dayInfo!.matches) {
      matchByTeam.set(m.t1, m);
      matchByTeam.set(m.t2, m);
    }

    const groups = new Map<string, LiveMatchGroup & { matchId: string }>();
    for (const p of players) {
      const match = matchByTeam.get(p.tid);
      if (!match) continue;
      const t1Name = teamNames.get(match.t1) ?? match.t1;
      const t2Name = teamNames.get(match.t2) ?? match.t2;
      const key = match.mi;
      if (!groups.has(key)) {
        groups.set(key, {
          matchId: key,
          team1: { id: match.t1, name: t1Name, crest: teamCrests.get(match.t1) ?? null, goals: match.t1g ?? 0 },
          team2: { id: match.t2, name: t2Name, crest: teamCrests.get(match.t2) ?? null, goals: match.t2g ?? 0 },
          minute: match.mtd ?? "?",
          status: match.st ?? 0,
          isLive: match.il === true,
          players: [],
        });
      }
      groups.get(key)!.players.push({
        id: p.i,
        name: p.n,
        points: p.p ?? 0,
        team: teamNames.get(p.tid) ?? p.tid,
        photo: p.pim ?? null,
      });
    }
    myMatches.push(...groups.values());
  }

  const standings: LiveStandingEntry[] = [];
  if (day != null) {
    const teamcenter = await client.getUserTeamcenter(leagueId, client.userId!, day);
    for (const u of teamcenter.us ?? []) {
      standings.push({
        id: u.i,
        name: u.unm,
        points: u.mdp ?? 0,
        isYou: u.i === client.userId,
        photo: u.uim ?? null,
      });
    }
    standings.sort((a, b) => b.points - a.points);
  }

  return { leagueName, day, myMatches, standings };
}
