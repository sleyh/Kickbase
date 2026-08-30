import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { getAuthContext, isAuthContextError } from "../_shared/auth-context.ts";
import { buildTeamDetail } from "../_shared/team-detail.ts";
import { KickbaseError } from "../_shared/kickbase-client.ts";

/** Not cached - fetched fresh when a TeamBadge is clicked, same reasoning as live-matchday. */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const id: string | undefined = body?.id;
    if (!id) return Response.json({ error: "id is required." }, { status: 400 });

    const ctxResult = await getAuthContext(ctx.supabaseAdmin, ctx.userClaims!.id);
    if (isAuthContextError(ctxResult)) {
      return Response.json({ error: ctxResult.error }, { status: ctxResult.status });
    }
    const { client } = ctxResult;

    try {
      const report = await buildTeamDetail(client, id);
      return Response.json(report);
    } catch (err) {
      const message = err instanceof KickbaseError ? err.message : String(err);
      return Response.json({ error: message }, { status: 502 });
    }
  }),
};
