"use client";

import { useState } from "react";
import { RefreshCw, Target, DollarSign, Flame, Handshake } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compact } from "@/lib/format";
import type { TransferAnalysisReport, SpendingProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

function avgOf(p: SpendingProfile): number {
  return p.computerBuys.length > 0
    ? p.computerBuys.reduce((sum, b) => sum + b.premiumPct, 0) / p.computerBuys.length
    : -Infinity;
}

function SpendingBadge({ avgPct }: { avgPct: number | null }) {
  if (avgPct == null) {
    return <span className="text-sm text-muted-foreground">no computer-market buys yet</span>;
  }
  const [Icon, label, tone] =
    avgPct <= 3
      ? ([Target, "pays close to asking price", "text-green-600 dark:text-green-400"] as const)
      : avgPct <= 15
        ? ([DollarSign, "pays a moderate premium", "text-amber-600 dark:text-amber-400"] as const)
        : ([Flame, "tends to overspend", "text-destructive"] as const);
  return (
    <span className={`flex items-center gap-1.5 text-sm ${tone}`}>
      <Icon className="size-3.5" />
      {label} ({avgPct >= 0 ? "+" : ""}
      {avgPct.toFixed(0)}% avg)
    </span>
  );
}

export function TransferAnalysisView({
  initialData,
  generatedAt,
}: {
  initialData: TransferAnalysisReport | null;
  generatedAt: string | null;
}) {
  const supabase = createClient();
  const [data, setData] = useState(initialData);
  const [lastGenerated, setLastGenerated] = useState(generatedAt);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("run-report", {
      body: { report_type: "transfer_analysis" },
    });
    setLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Couldn't refresh.");
      return;
    }
    setData(result);
    setLastGenerated(new Date().toISOString());
  }

  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground">No transfer analysis yet.</p>
          <Button onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Fetch transfer analysis"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const managerTrades = data.profiles
    .flatMap((p) => p.managerBuys.map((b) => ({ name: p.name, b })))
    .sort((x, y) => Math.abs(y.b.premiumPct) - Math.abs(x.b.premiumPct));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.leagueName}</h1>
          <p className="text-sm text-muted-foreground">
            Premium = price paid vs. that player&apos;s current market value
            {lastGenerated && ` · Updated ${new Date(lastGenerated).toLocaleString()}`}
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spending behavior</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[...data.profiles]
            .sort((a, b) => avgOf(b) - avgOf(a))
            .map((profile) => {
              const buys = profile.computerBuys;
              const avg = buys.length > 0 ? buys.reduce((s, b) => s + b.premiumPct, 0) / buys.length : null;
              return (
                <div key={profile.name} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="font-medium">{profile.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {buys.length} computer buy{buys.length !== 1 ? "s" : ""}
                    </span>
                    <SpendingBadge avgPct={avg} />
                  </div>
                </div>
              );
            })}
        </CardContent>
      </Card>

      {managerTrades.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Handshake className="size-4" /> Manager-to-manager trades
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {managerTrades.map(({ name, b }, i) => (
              <div key={i} className="rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{name}</span> paid{" "}
                <span className={b.premiumPct >= 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}>
                  {b.premiumPct >= 0 ? "+" : ""}
                  {b.premiumPct.toFixed(0)}%
                </span>{" "}
                vs. value for <span className="font-medium">{b.playerName}</span> ({compact(b.trp)} vs.{" "}
                {compact(b.mv)}) — bought from {b.othnm}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
