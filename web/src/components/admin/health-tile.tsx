"use client";

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle, Server, Send, Database } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AdminHealthReport, HealthCheckResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const PROBES = [
  { key: "kickbase" as const, label: "Kickbase API", icon: Server },
  { key: "telegram" as const, label: "Telegram Bot", icon: Send },
  { key: "database" as const, label: "Database", icon: Database },
];

function StatusRow({ label, icon: Icon, check }: { label: string; icon: typeof Server; check?: HealthCheckResult }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
      <span className="flex items-center gap-2 font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {label}
      </span>
      {check ? (
        <span
          className={`flex items-center gap-1.5 text-sm ${
            check.ok ? "text-green-600 dark:text-green-400" : "text-destructive"
          }`}
        >
          {check.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {check.detail}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">checking...</span>
      )}
    </div>
  );
}

export function HealthTile() {
  const supabase = createClient();
  const [data, setData] = useState<AdminHealthReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("admin-health", { body: {} });
    setLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Health check failed.");
      return;
    }
    setData(result);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>API health</CardTitle>
        <Button variant="outline" size="sm" onClick={check} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Recheck
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {PROBES.map((p) => (
          <StatusRow key={p.key} label={p.label} icon={p.icon} check={data?.[p.key]} />
        ))}
        {data && (
          <p className="pt-1 text-xs text-muted-foreground">
            Last checked {new Date(data.checkedAt).toLocaleTimeString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
