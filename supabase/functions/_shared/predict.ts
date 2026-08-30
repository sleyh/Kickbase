// deno-lint-ignore-file no-explicit-any
/**
 * TypeScript port of the parts of kickbase/predict.py this app needs so
 * far - just history_deltas(), the real-data d1/d7 computation squad
 * value and competitor deltas are built from.
 */

export interface HistoryDeltas {
  d1: number | null;
  d7: number | null;
  /**
   * Epoch day index of entries[-2], i.e. when the d1 window began - a
   * squad's "today's gain" is only correct to sum d1 across players
   * owned for the *entire* window; a player bought partway through it
   * saw some of that market movement happen before/without this manager
   * owning them. See squad-value.ts's isDeltaAttributable().
   */
  d1WindowStartDay: number | null;
}

/**
 * Given a getMarketValueHistory() response, returns the actual observed
 * {d1, d7} market-value change - null for either if there isn't enough
 * history yet (e.g. a player who only just appeared).
 */
export function historyDeltas(history: any): HistoryDeltas {
  const entries: any[] = history?.it ?? [];
  if (entries.length < 2) {
    return { d1: null, d7: null, d1WindowStartDay: null };
  }
  const latest = entries[entries.length - 1].mv;
  const d1 = entries.length >= 2 ? latest - entries[entries.length - 2].mv : null;
  const d7 = entries.length >= 8 ? latest - entries[entries.length - 8].mv : null;
  return { d1, d7, d1WindowStartDay: entries[entries.length - 2]?.dt ?? null };
}
