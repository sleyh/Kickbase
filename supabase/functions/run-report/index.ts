import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { runReportForUser } from "../_shared/run-report-core.ts";

/**
 * Runs one report for the calling user - used by both the dashboard's
 * "refresh" button (notify: false/omitted, silent) and a future cron
 * dispatcher (notify: true, pushes to Telegram). All the actual work
 * lives in _shared/run-report-core.ts, shared with admin-trigger-job.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const reportType: string = body?.report_type ?? "squad_value";
    const notify: boolean = body?.notify === true;

    const outcome = await runReportForUser(ctx.supabaseAdmin, ctx.userClaims!.id, reportType, notify);
    return Response.json(outcome.ok ? outcome.payload : { error: outcome.error }, { status: outcome.status });
  }),
};
