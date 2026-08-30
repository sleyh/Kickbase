import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { getAuthContext, isAuthContextError } from "../_shared/auth-context.ts";
import { buildFullMarketListings } from "../_shared/market.ts";
import { enrichWithHistory } from "../_shared/squad-value.ts";
import { fetchLeagueTable } from "../_shared/fixtures.ts";
import { KickbaseError } from "../_shared/kickbase-client.ts";

/**
 * Every live market listing (not the notable-filtered subset market_alert
 * caches), with per-item 24h/7d deltas - not cached, fetched fresh when
 * the Market page loads, same reasoning as live-matchday/player-detail.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const ctxResult = await getAuthContext(ctx.supabaseAdmin, ctx.userClaims!.id);
    if (isAuthContextError(ctxResult)) {
      return Response.json({ error: ctxResult.error }, { status: ctxResult.status });
    }
    const { client, leagueId, leagueName } = ctxResult;

    try {
      const [marketResp, table] = await Promise.all([client.getMarket(leagueId), fetchLeagueTable(client, leagueId)]);
      const items: any[] = marketResp?.it ?? [];
      await enrichWithHistory(client, leagueId, items);

      const listings = buildFullMarketListings(items, table);
      const ownBids = listings.filter((l) => l.hasOwnBid);

      return Response.json({ leagueName, listings, ownBids });
    } catch (err) {
      const message = err instanceof KickbaseError ? err.message : String(err);
      return Response.json({ error: message }, { status: 502 });
    }
  }),
};
