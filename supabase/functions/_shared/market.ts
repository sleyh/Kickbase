// deno-lint-ignore-file no-explicit-any
/**
 * TypeScript port of the market-snapshot pieces of kickbase/strategy.py +
 * cli.py's `alert` command this app needs for an on-demand dashboard
 * view. Deliberately narrower than the Python original: cmd_alert()
 * diffs each poll against the previous one (via a local JSON state file)
 * to alert only on *newly*-listed notable players and your own bid
 * status changes over time - that needs a persistent previous-snapshot
 * to compare against, which is exactly what a scheduled cron dispatcher
 * would provide. Without one yet, this instead shows "what's notable on
 * the market right now" - still useful on demand, just not a diff.
 */

const RISING = 1;

/**
 * Whether a market listing is worth surfacing: rising in value, or
 * already producing real points - filters out the falling/zero-point
 * dead weight that makes up a chunk of raw computer listings.
 */
export function isNotableListing(player: any): boolean {
  return player.mvt === RISING || (player.ap ?? 0) > 0;
}

export interface MarketListingSummary {
  name: string;
  price: number;
  marketValue: number;
  rising: boolean;
  avgPoints: number;
  hasOwnBid: boolean;
  ownBidAmount: number | null;
}

export interface MarketSnapshot {
  leagueName: string;
  notable: MarketListingSummary[];
  ownBids: MarketListingSummary[];
}

function playerName(item: any): string {
  const first = item.fn ?? "";
  const last = item.n ?? "";
  return [first, last].filter(Boolean).join(" ") || "?";
}

export function buildMarketSnapshot(leagueName: string, marketItems: any[]): MarketSnapshot {
  const summaries: MarketListingSummary[] = marketItems.map((item) => ({
    name: playerName(item),
    price: item.prc ?? 0,
    marketValue: item.mv ?? 0,
    rising: item.mvt === RISING,
    avgPoints: item.ap ?? 0,
    hasOwnBid: (item.ofc ?? 0) > 0,
    ownBidAmount: item.uop ?? null,
  }));

  const notable = summaries
    .filter((s, i) => isNotableListing(marketItems[i]))
    .sort((a, b) => b.avgPoints - a.avgPoints || Number(b.rising) - Number(a.rising));
  const ownBids = summaries.filter((s) => s.hasOwnBid);

  return { leagueName, notable, ownBids };
}
