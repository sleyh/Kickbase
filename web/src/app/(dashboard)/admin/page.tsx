import { createClient } from "@/lib/supabase/server";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import type { AdminUserRow, JobRunRow, ScheduledJobRow } from "@/lib/types";

/**
 * All five queries below read across every user, not just the caller -
 * that only works because the caller is an admin and every table has an
 * explicit "admin selects all" RLS policy (0001_init.sql). No
 * service-role key or Edge Function is involved in reading this data.
 */
export default async function AdminPage() {
  const supabase = await createClient();

  const [{ data: profiles }, { data: accounts }, { data: telegramLinks }, { data: scheduledJobs }, { data: jobRuns }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, is_admin, created_at")
        .order("created_at", { ascending: true }),
      supabase.from("kickbase_accounts").select("user_id, kickbase_email, league_id, last_verified_at"),
      supabase.from("telegram_links").select("user_id, chat_id, linked_at"),
      supabase
        .from("scheduled_jobs")
        .select("id, user_id, job_type, cron_expression, enabled, last_run_at, last_status"),
      supabase
        .from("job_runs")
        .select("id, user_id, job_type, started_at, finished_at, status, output_summary, error_detail")
        .order("started_at", { ascending: false })
        .limit(200),
    ]);

  const accountByUser = new Map((accounts ?? []).map((a) => [a.user_id, a]));
  const telegramByUser = new Map((telegramLinks ?? []).map((t) => [t.user_id, t]));

  const users: AdminUserRow[] = (profiles ?? []).map((p) => {
    const account = accountByUser.get(p.id);
    const telegram = telegramByUser.get(p.id);
    return {
      userId: p.id,
      displayName: p.display_name,
      isAdmin: p.is_admin,
      createdAt: p.created_at,
      kickbaseEmail: account?.kickbase_email ?? null,
      leagueId: account?.league_id ?? null,
      lastVerifiedAt: account?.last_verified_at ?? null,
      telegramLinked: !!telegram?.chat_id,
      telegramLinkedAt: telegram?.linked_at ?? null,
    };
  });

  const runs: JobRunRow[] = (jobRuns ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    jobType: r.job_type,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status as JobRunRow["status"],
    outputSummary: r.output_summary,
    errorDetail: r.error_detail,
  }));

  const jobs: ScheduledJobRow[] = (scheduledJobs ?? []).map((j) => ({
    id: j.id,
    userId: j.user_id,
    jobType: j.job_type,
    cronExpression: j.cron_expression,
    enabled: j.enabled,
    lastRunAt: j.last_run_at,
    lastStatus: j.last_status,
  }));

  return (
    <>
      {/* No filterUserId: an admin is allowed (via RLS) to see every
          user's job_runs, so this refreshes on anyone's job finishing. */}
      <RealtimeRefresher tables={["job_runs", "reports_cache"]} />
      <AdminDashboard users={users} jobRuns={runs} scheduledJobs={jobs} />
    </>
  );
}
