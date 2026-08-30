import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { getMe } from "../_shared/telegram.ts";

const KICKBASE_BASE_URL = "https://api.kickbase.com";

interface HealthCheck {
  ok: boolean;
  detail: string;
}

/**
 * The login endpoint answers even with an empty/invalid body (a 4xx, not
 * a hang or a 5xx), so it's a fine reachability probe without needing a
 * real account - a 5xx or a network failure is the only "down" signal
 * that actually matters here.
 */
async function checkKickbase(): Promise<HealthCheck> {
  try {
    const resp = await fetch(`${KICKBASE_BASE_URL}/v4/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return { ok: resp.status < 500, detail: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

async function checkTelegram(): Promise<HealthCheck> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, detail: "TELEGRAM_BOT_TOKEN not configured" };
  try {
    const me = await getMe(token);
    return { ok: true, detail: `@${me.username}` };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

/** Admin-only: three independent reachability probes for the app's external dependencies. */
export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const { data: profile } = await ctx.supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", ctx.userClaims!.id)
      .single();
    if (!profile?.is_admin) {
      return Response.json({ error: "Admin access required." }, { status: 403 });
    }

    const [kickbase, telegram, database] = await Promise.all([
      checkKickbase(),
      checkTelegram(),
      (async (): Promise<HealthCheck> => {
        try {
          const { error } = await ctx.supabaseAdmin
            .from("profiles")
            .select("id", { count: "exact", head: true });
          return error ? { ok: false, detail: error.message } : { ok: true, detail: "reachable" };
        } catch (err) {
          return { ok: false, detail: String(err) };
        }
      })(),
    ]);

    return Response.json({ kickbase, telegram, database, checkedAt: new Date().toISOString() });
  }),
};
