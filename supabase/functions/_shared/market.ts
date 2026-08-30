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
const FALLING = 2;

/**
 * Whether a market listing is worth surfacing: rising in value, or
 * already producing real points - filters out the falling/zero-point
 * dead weight that makes up a chunk of raw computer listings.
 */
export function isNotableListing(player: any): boolean {
  return player.mvt === RISING || (player.ap ?? 0) > 0;
}

export interface MarketListingSummary {
  id: string;
  name: string;
  price: number;
  marketValue: number;
  rising: boolean;
  avgPoints: number;
  hasOwnBid: boolean;
  ownBidAmount: number | null;
  photo: string | null;
  pos: number | null;
  /** "flat" covers mvt values beyond RISING/FALLING (e.g. brand new listings with no trend yet). */
  trend: "up" | "down" | "flat";
  expiresInSeconds: number | null;
  /** Only populated by buildFullMarketListings() (enrichWithHistory() is a per-item call the cached market_alert snapshot doesn't make) - null on the notable/own-bid summaries from buildMarketSnapshot(). */
  d1: number | null;
  d7: number | null;
  teamId: string | null;
  teamName: string | null;
  teamCrest: string | null;
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

function trendOf(item: any): "up" | "down" | "flat" {
  if (item.mvt === RISING) return "up";
  if (item.mvt === FALLING) return "down";
  return "flat";
}

function baseListingSummary(item: any, team?: { tid: string; name: string; crest: string | null }): MarketListingSummary {
  return {
    id: item.i,
    name: playerName(item),
    price: item.prc ?? 0,
    marketValue: item.mv ?? 0,
    rising: item.mvt === RISING,
    avgPoints: item.ap ?? 0,
    hasOwnBid: (item.ofc ?? 0) > 0,
    ownBidAmount: item.uop ?? null,
    photo: item.pim ?? null,
    pos: item.pos ?? null,
    trend: trendOf(item),
    expiresInSeconds: item.exs ?? null,
    d1: item.d1 ?? null,
    d7: item.d7 ?? null,
    teamId: team?.tid ?? item.tid ?? null,
    teamName: team?.name ?? null,
    teamCrest: team?.crest ?? null,
  };
}

export function buildMarketSnapshot(leagueName: string, marketItems: any[]): MarketSnapshot {
  const summaries: MarketListingSummary[] = marketItems.map((item) => baseListingSummary(item));

  const notable = summaries
    .filter((s, i) => isNotableListing(marketItems[i]))
    .sort((a, b) => b.avgPoints - a.avgPoints || Number(b.rising) - Number(a.rising));
  const ownBids = summaries.filter((s) => s.hasOwnBid);

  return { leagueName, notable, ownBids };
}

/**
 * Every live listing (not just the notable-filtered subset), soonest
 * expiring first - for the dedicated Market page. Callers must run
 * enrichWithHistory() (squad-value.ts) on marketItems first if d1/d7
 * should be populated - this function just reads whatever's already on
 * each item, it doesn't fetch.
 */
export function buildFullMarketListings(
  marketItems: any[],
  table: Array<{ tid: string; name: string; crest: string | null }>
): MarketListingSummary[] {
  const teamById = new Map(table.map((t) => [t.tid, t]));
  return marketItems
    .map((item) => baseListingSummary(item, item.tid ? teamById.get(item.tid) : undefined))
    .sort((a, b) => (a.expiresInSeconds ?? Infinity) - (b.expiresInSeconds ?? Infinity));
}
