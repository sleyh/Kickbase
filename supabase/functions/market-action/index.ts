import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { getAuthContext, isAuthContextError } from "../_shared/auth-context.ts";
import { validateMarketActionRequest, runMarketAction } from "../_shared/market-action.ts";
import { KickbaseError } from "../_shared/kickbase-client.ts";

/** Not cached - a one-off mutation triggered from a PlayerCard's action menu. */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const request = validateMarketActionRequest(body);
    if ("error" in request) {
      return Response.json({ error: request.error }, { status: 400 });
    }

    const ctxResult = await getAuthContext(ctx.supabaseAdmin, ctx.userClaims!.id);
    if (isAuthContextError(ctxResult)) {
      return Response.json({ error: ctxResult.error }, { status: ctxResult.status });
    }
    const { client, leagueId } = ctxResult;

    try {
      const result = await runMarketAction(client, leagueId, request);
      return Response.json(result);
    } catch (err) {
      const message = err instanceof KickbaseError ? err.message : String(err);
      return Response.json({ error: message }, { status: 502 });
    }
  }),
};
