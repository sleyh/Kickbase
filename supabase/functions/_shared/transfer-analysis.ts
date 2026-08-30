// deno-lint-ignore-file no-explicit-any
/**
 * TypeScript port of kickbase/cli.py's _build_spending_profiles() - what
 * each league member actually paid for a player vs. that player's
 * *current* market value, split into computer-market buys (feed a
 * per-manager average) vs. manager-to-manager trades (shown
 * individually - too few per manager for an average to mean anything,
 * and the price reflects a human negotiation, not a sealed-bid field).
 */

import { KickbaseClient, KickbaseError } from "./kickbase-client.ts";

export interface SpendingEntry {
  playerId: string;
  playerName: string;
  trp: number;
  mv: number;
  premiumPct: number;
  othnm?: string;
}

export interface SpendingProfile {
  id: string;
  name: string;
  computerBuys: SpendingEntry[];
  managerBuys: SpendingEntry[];
}

export async function buildSpendingProfiles(
  client: KickbaseClient,
  leagueId: string
): Promise<SpendingProfile[]> {
  const ranking = await client.getRanking(leagueId);
  const managers: Record<string, string> = {};
  for (const u of ranking.us ?? []) {
    if (u.i) managers[u.i] = u.n ?? "?";
  }

  const mvCache = new Map<string, number | null>();
  async function currentMv(playerId: string): Promise<number | null> {
    if (!mvCache.has(playerId)) {
      try {
        const player = await client.getPlayer(leagueId, playerId);
        mvCache.set(playerId, player.mv ?? null);
      } catch (err) {
        if (!(err instanceof KickbaseError)) throw err;
        mvCache.set(playerId, null);
      }
    }
    return mvCache.get(playerId)!;
  }

  const profiles: SpendingProfile[] = [];
  for (const [managerId, name] of Object.entries(managers)) {
    let log: any[];
    try {
      log = (await client.getManagerTransfers(leagueId, managerId)).it ?? [];
    } catch {
      continue;
    }

    const computerBuys: SpendingEntry[] = [];
    const managerBuys: SpendingEntry[] = [];
    for (const t of log) {
      if (t.tty !== 1) continue; // only purchases feed spending behavior, not sales
      const trp = t.trp;
      const mv = await currentMv(t.pi);
      if (!trp || !mv) continue;
      const entry: SpendingEntry = {
        playerId: t.pi,
        playerName: t.pn,
        trp,
        mv,
        premiumPct: ((trp - mv) / mv) * 100,
      };
      if (t.othnm) {
        entry.othnm = t.othnm;
        managerBuys.push(entry);
      } else {
        computerBuys.push(entry);
      }
    }
    profiles.push({ id: managerId, name, computerBuys, managerBuys });
  }
  return profiles;
}
