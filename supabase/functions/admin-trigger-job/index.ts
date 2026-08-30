import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { runReportForUser } from "../_shared/run-report-core.ts";

/**
 * Admin-only: runs any report for any user on demand - the manual
 * trigger behind the admin dashboard's "run now" action, and a preview
 * of what a cron dispatcher will eventually do automatically. Notifies
 * via Telegram by default (unlike the dashboard's own silent refresh
 * button) since an admin manually running someone else's report is
 * standing in for that user's own scheduled job.
 *
 * Gated on profiles.is_admin here, checked with the service-role client
 * (bypasses RLS) rather than trusted from the client, since this is the
 * one place in the app that deliberately crosses the
 * "user_id = auth.uid()" boundary every other Edge Function respects.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const { data: profile } = await ctx.supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", ctx.userClaims!.id)
      .single();
    if (!profile?.is_admin) {
      return Response.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId: string | undefined = body?.user_id;
    const reportType: string = body?.report_type ?? "squad_value";
    const notify: boolean = body?.notify !== false;

    if (!targetUserId) {
      return Response.json({ error: "user_id is required." }, { status: 400 });
    }

    const outcome = await runReportForUser(ctx.supabaseAdmin, targetUserId, reportType, notify);
    return Response.json(outcome.ok ? outcome.payload : { error: outcome.error }, { status: outcome.status });
  }),
};
