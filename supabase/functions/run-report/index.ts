import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { KickbaseClient, KickbaseError } from "../_shared/kickbase-client.ts";
import { buildSquadValueReport } from "../_shared/squad-value.ts";
import { renderSquadValueTelegram } from "../_shared/report.ts";
import { sendMessage } from "../_shared/telegram.ts";

/**
 * Runs one report for the caller: loads their linked Kickbase account,
 * decrypts the stored password just for this invocation, builds the
 * report, caches it, records a job_runs row either way, and - only when
 * { notify: true } is passed (the cron dispatcher's job, not the
 * dashboard's silent "Refresh" button) - pushes it to Telegram if the
 * user has a confirmed chat link.
 *
 * Only "squad_value" is wired up so far; report_type is still accepted
 * in the body so the remaining report types (Task #4) can slot in here
 * without changing the calling convention.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const reportType: string = body?.report_type ?? "squad_value";
    const notify: boolean = body?.notify === true;

    if (reportType !== "squad_value") {
      return Response.json({ error: `Unknown report_type "${reportType}".` }, { status: 400 });
    }

    const userId = ctx.userClaims!.id;

    const { data: account, error: accountError } = await ctx.supabaseAdmin
      .from("kickbase_accounts")
      .select("kickbase_email, vault_secret_id, league_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (accountError || !account) {
      return Response.json({ error: "No linked Kickbase account. Finish onboarding first." }, { status: 400 });
    }

    const { data: password, error: secretError } = await ctx.supabaseAdmin.rpc("read_kickbase_secret", {
      p_secret_id: account.vault_secret_id,
    });
    if (secretError || !password) {
      return Response.json({ error: "Couldn't read stored credentials." }, { status: 500 });
    }

    const startedAt = new Date().toISOString();

    try {
      const client = new KickbaseClient(account.kickbase_email, password);
      await client.login();

      const league = client.leagues.find((l) => l.id === account.league_id);
      const leagueName = (league?.name as string) ?? account.league_id;

      const report = await buildSquadValueReport(client, account.league_id, leagueName, true);

      await ctx.supabaseAdmin.from("reports_cache").upsert({
        user_id: userId,
        report_type: reportType,
        payload: report,
        generated_at: new Date().toISOString(),
      });

      await ctx.supabaseAdmin.from("job_runs").insert({
        user_id: userId,
        job_type: reportType,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "success",
        output_summary: `Squad value ${report.totalValue.toLocaleString()}, budget ${report.budget.toLocaleString()}`,
      });

      if (notify) {
        const { data: link } = await ctx.supabaseAdmin
          .from("telegram_links")
          .select("chat_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (link?.chat_id) {
          const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
          try {
            await sendMessage(token, link.chat_id, renderSquadValueTelegram(report));
          } catch (err) {
            // A Telegram delivery failure shouldn't fail the whole
            // report run - the report itself succeeded and is cached;
            // log it and move on (same reasoning as telegram-webhook's
            // tryNotify()).
            console.error("Telegram delivery failed:", err);
          }
        }
      }

      return Response.json(report);
    } catch (err) {
      const message = err instanceof KickbaseError ? err.message : String(err);
      await ctx.supabaseAdmin.from("job_runs").insert({
        user_id: userId,
        job_type: reportType,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "failed",
        error_detail: message,
      });
      return Response.json({ error: message }, { status: 502 });
    }
  }),
};
