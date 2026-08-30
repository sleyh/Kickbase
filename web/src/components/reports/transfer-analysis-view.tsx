"use client";

import { useState } from "react";
import { RefreshCw, Target, DollarSign, Flame, Handshake } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compact } from "@/lib/format";
import type { TransferAnalysisReport, SpendingProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ManagerCard } from "@/components/kickbase/manager-card";
import { PlayerCard } from "@/components/kickbase/player-card";
import { PlayerCell, ManagerCell } from "@/components/kickbase/stat-table";
import { ViewToggle } from "@/components/ui/view-toggle";
import { useViewMode } from "@/lib/use-view-mode";
import { toast } from "sonner";

function avgOf(p: SpendingProfile): number {
  return p.computerBuys.length > 0
    ? p.computerBuys.reduce((sum, b) => sum + b.premiumPct, 0) / p.computerBuys.length
    : -Infinity;
}

function SpendingBadge({ avgPct }: { avgPct: number | null }) {
  if (avgPct == null) {
    return <span className="text-xs text-muted-foreground">no computer-market buys yet</span>;
  }
  const [Icon, label, tone] =
    avgPct <= 3
      ? ([Target, "close to asking price", "text-green-600 dark:text-green-400"] as const)
      : avgPct <= 15
        ? ([DollarSign, "moderate premium", "text-amber-600 dark:text-amber-400"] as const)
        : ([Flame, "tends to overspend", "text-destructive"] as const);
  return (
    <span className={`flex items-center gap-1.5 text-xs ${tone}`}>
      <Icon className="size-3" />
      {label} ({avgPct >= 0 ? "+" : ""}
      {avgPct.toFixed(0)}%)
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
  const [spendingView, setSpendingView] = useViewMode("transfer-spending");
  const [tradesView, setTradesView] = useViewMode("transfer-trades", "table");

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
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{data.leagueName}</h1>
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
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Spending behavior</CardTitle>
          <ViewToggle mode={spendingView} onChange={setSpendingView} />
        </CardHeader>
        {spendingView === "cards" ? (
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...data.profiles]
              .sort((a, b) => avgOf(b) - avgOf(a))
              .map((profile) => {
                const buys = profile.computerBuys;
                const avg = buys.length > 0 ? buys.reduce((s, b) => s + b.premiumPct, 0) / buys.length : null;
                return (
                  <ManagerCard
                    key={profile.name}
                    variant="compact"
                    manager={{ name: profile.name, value: buys.length }}
                    statSuffix={` buy${buys.length !== 1 ? "s" : ""}`}
                    badge={<SpendingBadge avgPct={avg} />}
                    href={profile.id ? `/dashboard/manager/${profile.id}` : undefined}
                  />
                );
              })}
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Manager</TableHead>
                  <TableHead className="text-right">Buys</TableHead>
                  <TableHead>Behavior</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.profiles]
                  .sort((a, b) => avgOf(b) - avgOf(a))
                  .map((profile) => {
                    const buys = profile.computerBuys;
                    const avg = buys.length > 0 ? buys.reduce((s, b) => s + b.premiumPct, 0) / buys.length : null;
                    return (
                      <TableRow key={profile.name}>
                        <ManagerCell name={profile.name} href={profile.id ? `/dashboard/manager/${profile.id}` : undefined} />
                        <TableCell className="text-right font-mono tabular-nums">{buys.length}</TableCell>
                        <TableCell>
                          <SpendingBadge avgPct={avg} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {managerTrades.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Handshake className="size-4" /> Manager-to-manager trades
            </CardTitle>
            <ViewToggle mode={tradesView} onChange={setTradesView} />
          </CardHeader>
          {tradesView === "cards" ? (
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {managerTrades.map(({ name, b }, i) => (
                <PlayerCard
                  key={i}
                  variant="compact"
                  player={{ name: b.playerName, value: b.trp }}
                  caption={`bought by ${name}`}
                  href={b.playerId ? `/dashboard/player/${b.playerId}` : undefined}
                  badge={
                    <span
                      className={`text-xs font-mono tabular-nums ${
                        b.premiumPct >= 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
                      }`}
                    >
                      {b.premiumPct >= 0 ? "+" : ""}
                      {b.premiumPct.toFixed(0)}%
                    </span>
                  }
                />
              ))}
            </CardContent>
          ) : (
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Bought from</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Market value</TableHead>
                    <TableHead className="text-right">Premium</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managerTrades.map(({ name, b }, i) => (
                    <TableRow key={i}>
                      <PlayerCell
                        name={b.playerName}
                        subtitle={`bought by ${name}`}
                        href={b.playerId ? `/dashboard/player/${b.playerId}` : undefined}
                      />
                      <TableCell className="text-muted-foreground">{b.othnm}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{compact(b.trp)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {compact(b.mv)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono tabular-nums ${
                          b.premiumPct >= 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
                        }`}
                      >
                        {b.premiumPct >= 0 ? "+" : ""}
                        {b.premiumPct.toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
