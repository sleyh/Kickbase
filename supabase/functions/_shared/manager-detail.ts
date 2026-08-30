// deno-lint-ignore-file no-explicit-any
/**
 * A full profile for one league manager - reuses almost everything
 * fetchCompetitors() in squad-value.ts already does per-competitor, just
 * exposed as its own page for one specific manager instead of a
 * league-wide summary list.
 */

import { KickbaseClient, KickbaseError } from "./kickbase-client.ts";
import {
  allManagerTransfers,
  enrichWithHistory,
  estimateManagerBudget,
  normalizeManagerSquadItems,
} from "./squad-value.ts";

export interface ManagerDetailReport {
  id: string;
  name: string;
  photo: string | null;
  isYou: boolean;
  rank: number | null;
  squadValue: number;
  estimatedBudget: number | null;
  dashboard: {
    teamValue: number | null;
    profit: number | null;
    avgPoints: number | null;
    matchdayWins: number | null;
  } | null;
  seasonTotalPoints: number | null;
  performance: Array<{ day: number; points: number; won: boolean }>;
  transfers: Array<{
    playerName: string;
    type: "buy" | "sell";
    amount: number;
    date: string;
    counterparty: string | null;
  }>;
  squad: Array<{
    id: string;
    name: string;
    photo: string | null;
    pos: number | null;
    value: number;
    d1: number | null;
  }>;
}

function playerName(p: any): string {
  const first = p.fn ?? "";
  const last = p.n ?? p.pn ?? p.ln ?? "";
  return [first, last].filter(Boolean).join(" ") || "?";
}

export async function buildManagerDetail(
  client: KickbaseClient,
  leagueId: string,
  managerId: string
): Promise<ManagerDetailReport> {
  const ranking = await client.getRanking(leagueId);
  const managers: any[] = ranking.us ?? [];
  const rankIndex = managers.findIndex((m) => m.i === managerId);
  const manager = rankIndex >= 0 ? managers[rankIndex] : null;
  const name = manager?.n ?? "?";
  const joinDt = manager?.jd;

  const squadResponse = await client.getManagerSquad(leagueId, managerId);
  const squad: any[] = squadResponse.it ?? [];
  const photo: string | null = squadResponse.uim ?? null;
  normalizeManagerSquadItems(squad);
  await enrichWithHistory(client, leagueId, squad);
  const squadValue = squad.reduce((sum, p) => sum + (p.mv ?? 0), 0);

  const log = await allManagerTransfers(client, leagueId, managerId);

  let estimatedBudget: number | null = null;
  if (joinDt) {
    try {
      estimatedBudget = await estimateManagerBudget(client, leagueId, joinDt, squad, log);
    } catch {
      // Leave null - a failed reconstruction shouldn't fail the whole page.
    }
  }

  let dashboard: ManagerDetailReport["dashboard"] = null;
  try {
    const d = await client.getManagerDashboard(leagueId, managerId);
    dashboard = {
      teamValue: d.tv ?? null,
      profit: d.prft ?? null,
      avgPoints: d.ap ?? null,
      matchdayWins: d.mdw ?? null,
    };
  } catch (err) {
    if (!(err instanceof KickbaseError)) throw err;
  }

  let seasonTotalPoints: number | null = null;
  let performance: ManagerDetailReport["performance"] = [];
  try {
    const perf = await client.getManagerPerformance(leagueId, managerId);
    const currentSeason = perf.it?.[0];
    seasonTotalPoints = currentSeason?.tp ?? null;
    performance = (currentSeason?.it ?? []).map((m: any) => ({
      day: m.day,
      points: m.mdp ?? 0,
      won: m.tw === true,
    }));
  } catch (err) {
    if (!(err instanceof KickbaseError)) throw err;
  }

  const transfers: ManagerDetailReport["transfers"] = log
    .map((t: any) => ({
      playerName: t.pn ?? playerName(t),
      type: (t.tty === 1 ? "buy" : "sell") as "buy" | "sell",
      amount: t.trp ?? 0,
      date: t.dt,
      counterparty: t.othnm ?? null,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    id: managerId,
    name,
    photo,
    isYou: managerId === client.userId,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    squadValue,
    estimatedBudget,
    dashboard,
    seasonTotalPoints,
    performance,
    transfers,
    squad: squad.map((p) => ({
      id: p.i,
      name: playerName(p),
      photo: p.pim ?? null,
      pos: p.pos ?? null,
      value: p.mv ?? 0,
      d1: p.d1 ?? null,
    })),
  };
}
