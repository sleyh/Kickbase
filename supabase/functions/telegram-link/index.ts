import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { getMe } from "../_shared/telegram.ts";

/**
 * Get-or-create the caller's telegram_links row and return a ready-to-tap
 * deep link (t.me/<bot>?start=<link_token>). Runs as the user (not via a
 * client-side RLS insert) so it can also report whether a link already
 * exists and fetch the bot's username server-side - the bot token itself
 * never has to be exposed to the client, only its public username.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const userId = ctx.userClaims!.id;
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) {
      return Response.json({ error: "Telegram bot is not configured." }, { status: 500 });
    }

    const { data: existing, error: selectError } = await ctx.supabaseAdmin
      .from("telegram_links")
      .select("link_token, chat_id, linked_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (selectError) {
      return Response.json({ error: selectError.message }, { status: 500 });
    }

    let row = existing;
    if (!row) {
      const { data: inserted, error: insertError } = await ctx.supabaseAdmin
        .from("telegram_links")
        .insert({ user_id: userId })
        .select("link_token, chat_id, linked_at")
        .single();
      if (insertError) {
        return Response.json({ error: insertError.message }, { status: 500 });
      }
      row = inserted;
    }

    const bot = await getMe(token);

    return Response.json({
      deepLink: `https://t.me/${bot.username}?start=${row.link_token}`,
      linked: row.chat_id !== null,
      linkedAt: row.linked_at,
    });
  }),
};
