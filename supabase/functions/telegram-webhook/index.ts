import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { sendMessage } from "../_shared/telegram.ts";

/**
 * Best-effort confirmation reply. The state change (updating
 * telegram_links) already happened by the time this is called - a
 * Telegram-side delivery failure (chat closed, bot blocked, whatever)
 * shouldn't turn a successful link into a 500 that makes Telegram retry
 * the whole update. Confirmed live: an unhandled throw here previously
 * did exactly that even though the DB write had already succeeded.
 */
async function tryNotify(token: string, chatId: string, text: string): Promise<void> {
  try {
    await sendMessage(token, chatId, text);
  } catch (err) {
    console.error("Telegram notify failed (link/DB state is unaffected):", err);
  }
}

/**
 * Receives Telegram Bot API updates. Telegram never sends a Supabase JWT
 * or apikey, so this runs as auth: 'none' (and needs verify_jwt = false
 * for this function in config.toml, since the platform's default JWT
 * check would otherwise reject every call before it reaches us).
 *
 * Instead, Telegram's own secret_token mechanism guards this endpoint:
 * setWebhook was called with secret_token set to TELEGRAM_WEBHOOK_SECRET,
 * so every real update carries a matching X-Telegram-Bot-Api-Secret-Token
 * header - anything else is rejected before touching the database.
 */
export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!expected || got !== expected) {
      return new Response("Forbidden", { status: 403 });
    }

    const update = await req.json().catch(() => null);
    const message = update?.message;
    const text: string | undefined = message?.text;
    const chatId: number | undefined = message?.chat?.id;

    if (!text || !chatId || !text.startsWith("/start")) {
      // Not a /start command - nothing to do, but still 200 so Telegram
      // doesn't retry-storm us over ordinary messages it isn't for.
      return new Response("ok");
    }

    const linkToken = text.split(" ")[1]?.trim();
    if (!linkToken) {
      return new Response("ok");
    }

    const { data: link, error: selectError } = await ctx.supabaseAdmin
      .from("telegram_links")
      .select("user_id, chat_id")
      .eq("link_token", linkToken)
      .maybeSingle();

    const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

    if (selectError || !link) {
      await tryNotify(token, String(chatId), "That link isn't valid anymore - generate a new one from the app.");
      return new Response("ok");
    }

    if (link.chat_id === String(chatId)) {
      await tryNotify(token, String(chatId), "This chat is already linked. ✅");
      return new Response("ok");
    }

    const { error: updateError } = await ctx.supabaseAdmin
      .from("telegram_links")
      .update({ chat_id: String(chatId), linked_at: new Date().toISOString() })
      .eq("link_token", linkToken);

    if (updateError) {
      await tryNotify(token, String(chatId), "Something went wrong linking this chat - please try again.");
      return new Response("ok");
    }

    await tryNotify(token, String(chatId), "✅ Linked! Your Kickbase Assistant reports will be sent here.");
    return new Response("ok");
  }),
};
