// deno-lint-ignore-file no-explicit-any
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { getAuthContext, isAuthContextError } from "../_shared/auth-context.ts";
import { buildPlayerDetail, PlayerDetailReport } from "../_shared/player-detail.ts";
import { KickbaseError } from "../_shared/kickbase-client.ts";

/**
 * App-local watchlist (no Kickbase API equivalent). {action: "list"}
 * reuses buildPlayerDetail() verbatim per scouted id - no new
 * player-shape code, and a stale/delisted id just gets skipped rather
 * than failing the whole list.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const userId = ctx.userClaims!.id;

    if (action === "add" || action === "remove") {
      const playerId: string | undefined = body?.playerId;
      if (!playerId || typeof playerId !== "string") {
        return Response.json({ error: "playerId is required." }, { status: 400 });
      }
      if (action === "add") {
        const { error } = await ctx.supabaseAdmin
          .from("scouted_players")
          .upsert({ user_id: userId, player_id: playerId }, { onConflict: "user_id,player_id" });
        if (error) return Response.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await ctx.supabaseAdmin
          .from("scouted_players")
          .delete()
          .eq("user_id", userId)
          .eq("player_id", playerId);
        if (error) return Response.json({ error: error.message }, { status: 500 });
      }
      return Response.json({ ok: true });
    }

    if (action !== "list") {
      return Response.json({ error: "action must be one of list, add, remove." }, { status: 400 });
    }

    const { data: rows, error } = await ctx.supabaseAdmin
      .from("scouted_players")
      .select("player_id")
      .eq("user_id", userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const playerIds: string[] = (rows ?? []).map((r: any) => r.player_id);
    if (playerIds.length === 0) return Response.json({ players: [] });

    const ctxResult = await getAuthContext(ctx.supabaseAdmin, userId);
    if (isAuthContextError(ctxResult)) {
      return Response.json({ error: ctxResult.error }, { status: ctxResult.status });
    }
    const { client, leagueId } = ctxResult;

    const players = (
      await Promise.all(
        playerIds.map(async (id): Promise<PlayerDetailReport | null> => {
          try {
            return await buildPlayerDetail(client, leagueId, id);
          } catch (err) {
            if (err instanceof KickbaseError) return null;
            throw err;
          }
        })
      )
    ).filter((p): p is PlayerDetailReport => p != null);

    return Response.json({ players });
  }),
};
