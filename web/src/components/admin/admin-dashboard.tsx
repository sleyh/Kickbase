"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, ShieldCheck, Users as UsersIcon, ListChecks, Activity } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  ADMIN_TRIGGERABLE_REPORT_TYPES,
  type AdminUserRow,
  type JobRunRow,
  type ReportType,
  type ScheduledJobRow,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HealthTile } from "@/components/admin/health-tile";
import { toast } from "sonner";

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  squad_value: "Squad Value",
  transfer_analysis: "Transfer Analysis",
  collect_bonus: "Collect Bonus",
  market_alert: "Market Alert",
};

// Placeholder cadences - nothing reads scheduled_jobs yet (no cron
// dispatcher is built), so a toggle here only stores intent for when one
// ships. Picked to roughly match what each report type needs: a daily
// snapshot for squad/bonus, a weekly one for spending analysis, and a
// tighter poll for market listings.
const DEFAULT_CRON: Record<ReportType, string> = {
  squad_value: "0 6 * * *",
  transfer_analysis: "0 7 * * 1",
  collect_bonus: "0 3 * * *",
  market_alert: "*/30 * * * *",
};

function userLabel(u: AdminUserRow): string {
  return u.kickbaseEmail ?? u.displayName ?? u.userId.slice(0, 8);
}

function StatusBadge({ status }: { status: JobRunRow["status"] }) {
  if (status === "success") return <Badge className="bg-green-600 text-white">success</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="secondary">running</Badge>;
}

export function AdminDashboard({
  users,
  jobRuns,
  scheduledJobs,
}: {
  users: AdminUserRow[];
  jobRuns: JobRunRow[];
  scheduledJobs: ScheduledJobRow[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [triggering, setTriggering] = useState<string | null>(null);
  const [reportChoice, setReportChoice] = useState<Record<string, ReportType>>({});
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const [runUserFilter, setRunUserFilter] = useState<string>("all");
  const [runTypeFilter, setRunTypeFilter] = useState<string>("all");
  const [runStatusFilter, setRunStatusFilter] = useState<string>("all");

  const usersById = useMemo(() => new Map(users.map((u) => [u.userId, u])), [users]);

  const jobByKey = useMemo(() => {
    const m = new Map<string, ScheduledJobRow>();
    for (const j of scheduledJobs) m.set(`${j.userId}:${j.jobType}`, j);
    return m;
  }, [scheduledJobs]);

  const filteredRuns = useMemo(() => {
    return jobRuns.filter((r) => {
      if (runUserFilter !== "all" && r.userId !== runUserFilter) return false;
      if (runTypeFilter !== "all" && r.jobType !== runTypeFilter) return false;
      if (runStatusFilter !== "all" && r.status !== runStatusFilter) return false;
      return true;
    });
  }, [jobRuns, runUserFilter, runTypeFilter, runStatusFilter]);

  async function triggerReport(userId: string) {
    const reportType = reportChoice[userId] ?? "squad_value";
    setTriggering(userId);
    const { data, error } = await supabase.functions.invoke("admin-trigger-job", {
      body: { user_id: userId, report_type: reportType },
    });
    setTriggering(null);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Job failed.");
      return;
    }
    toast.success(`${REPORT_TYPE_LABELS[reportType]} ran for ${userLabel(usersById.get(userId)!)}.`);
    router.refresh();
  }

  async function toggleSchedule(userId: string, jobType: ReportType, enabled: boolean) {
    const key = `${userId}:${jobType}`;
    setTogglingKey(key);
    const existing = jobByKey.get(key);
    const { error } = await supabase.from("scheduled_jobs").upsert(
      {
        user_id: userId,
        job_type: jobType,
        cron_expression: existing?.cronExpression ?? DEFAULT_CRON[jobType],
        enabled,
      },
      { onConflict: "user_id,job_type" }
    );
    setTogglingKey(null);
    if (error) {
      toast.error(`Couldn't update schedule: ${error.message}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="size-5" /> Admin
        </h1>
        <p className="text-sm text-muted-foreground">{users.length} user{users.length === 1 ? "" : "s"} · manage accounts, run jobs on demand, watch the logs.</p>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            <UsersIcon /> Users
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <ListChecks /> Jobs &amp; Schedule
          </TabsTrigger>
          <TabsTrigger value="runs">
            <Activity /> Job Runs
          </TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>League</TableHead>
                    <TableHead>Telegram</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Run a report</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.userId}>
                      <TableCell className="font-medium">
                        {userLabel(u)}
                        {u.isAdmin && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            admin
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.leagueId ?? "—"}</TableCell>
                      <TableCell>
                        {u.telegramLinked ? (
                          <Badge className="bg-green-600 text-white">linked</Badge>
                        ) : (
                          <Badge variant="outline">not linked</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <select
                            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            value={reportChoice[u.userId] ?? "squad_value"}
                            onChange={(e) =>
                              setReportChoice((prev) => ({ ...prev, [u.userId]: e.target.value as ReportType }))
                            }
                            disabled={!u.kickbaseEmail}
                          >
                            {ADMIN_TRIGGERABLE_REPORT_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {REPORT_TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!u.kickbaseEmail || triggering === u.userId}
                            onClick={() => triggerReport(u.userId)}
                          >
                            {triggering === u.userId ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Play />
                            )}
                            Run
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-normal text-muted-foreground">
                Toggles what each user&apos;s automated schedule would run. No cron dispatcher reads these yet -
                this is the control surface waiting for one.
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    {ADMIN_TRIGGERABLE_REPORT_TYPES.map((t) => (
                      <TableHead key={t} className="text-center">
                        {REPORT_TYPE_LABELS[t]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users
                    .filter((u) => u.kickbaseEmail)
                    .map((u) => (
                      <TableRow key={u.userId}>
                        <TableCell className="font-medium">{userLabel(u)}</TableCell>
                        {ADMIN_TRIGGERABLE_REPORT_TYPES.map((t) => {
                          const key = `${u.userId}:${t}`;
                          const job = jobByKey.get(key);
                          return (
                            <TableCell key={t} className="text-center">
                              <Switch
                                checked={job?.enabled ?? false}
                                disabled={togglingKey === key}
                                onCheckedChange={(checked) => toggleSchedule(u.userId, t, checked)}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0">
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none"
                value={runUserFilter}
                onChange={(e) => setRunUserFilter(e.target.value)}
              >
                <option value="all">All users</option>
                {users.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none"
                value={runTypeFilter}
                onChange={(e) => setRunTypeFilter(e.target.value)}
              >
                <option value="all">All job types</option>
                {ADMIN_TRIGGERABLE_REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REPORT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none"
                value={runStatusFilter}
                onChange={(e) => setRunStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="running">Running</option>
              </select>
              <span className="ml-auto text-sm text-muted-foreground">{filteredRuns.length} runs</span>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRuns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No runs match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRuns.map((r) => {
                      const u = usersById.get(r.userId);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{u ? userLabel(u) : r.userId.slice(0, 8)}</TableCell>
                          <TableCell className="text-muted-foreground">{r.jobType}</TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(r.startedAt).toLocaleString()}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "max-w-xs truncate text-sm",
                              r.status === "failed" ? "text-destructive" : "text-muted-foreground"
                            )}
                            title={r.errorDetail ?? r.outputSummary ?? undefined}
                          >
                            {r.errorDetail ?? r.outputSummary ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health">
          <HealthTile />
        </TabsContent>
      </Tabs>
    </div>
  );
}
