"use client";

import { useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { compact, signed } from "@/lib/format";
import { DEBT_CEILING_RATIO, type SquadValueReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ManagerCard } from "@/components/kickbase/manager-card";
import { ManagerCell } from "@/components/kickbase/stat-table";
import { ViewToggle } from "@/components/ui/view-toggle";
import { useViewMode } from "@/lib/use-view-mode";
import { toast } from "sonner";

function deltaClass(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-green-600 dark:text-green-400" : n < 0 ? "text-destructive" : "text-muted-foreground";
}

const chartConfig = {
  value: { label: "Squad value", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function CompetitorsView({
  initialData,
  generatedAt,
}: {
  initialData: SquadValueReport | null;
  generatedAt: string | null;
}) {
  const supabase = createClient();
  const [data, setData] = useState(initialData);
  const [lastGenerated, setLastGenerated] = useState(generatedAt);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useViewMode("competitors");

  async function refresh() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("run-report", {
      body: { report_type: "squad_value" },
    });
    setLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Couldn't refresh.");
      return;
    }
    setData(result);
    setLastGenerated(new Date().toISOString());
  }

  if (!data || !data.competitors || data.competitors.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground">No competitor data yet.</p>
          <Button onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Fetch competitors"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...data.competitors].sort((a, b) => (b.totalDelta ?? -Infinity) - (a.totalDelta ?? -Infinity));
  const chartData = [
    { name: "You", value: data.totalValue },
    ...data.competitors.map((c) => ({ name: c.name, value: c.totalValue })),
  ].sort((a, b) => b.value - a.value);

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
            <Users className="size-5" /> Competitors
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.leagueName}
            {lastGenerated && ` · Updated ${new Date(lastGenerated).toLocaleString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Squad value vs. everyone</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-72 w-full">
            <BarChart data={chartData} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => compact(v)} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v) => compact(Number(v))} />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c) => (
            <ManagerCard
              key={c.name}
              manager={{ name: c.name, photo: c.photo, value: c.totalValue, delta: c.totalDelta }}
              href={c.id ? `/dashboard/manager/${c.id}` : undefined}
              extra={
                c.estimatedBudget != null ? (
                  <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                    budget ≈{compact(c.estimatedBudget)} · can spend up to ≈
                    {compact(c.estimatedBudget + DEBT_CEILING_RATIO * c.totalValue)}
                  </div>
                ) : null
              }
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Manager</TableHead>
                  <TableHead className="text-right">Squad value</TableHead>
                  <TableHead className="text-right">24h</TableHead>
                  <TableHead className="text-right">Budget ≈</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => (
                  <TableRow key={c.name}>
                    <ManagerCell name={c.name} photo={c.photo} href={c.id ? `/dashboard/manager/${c.id}` : undefined} />
                    <TableCell className="text-right font-mono tabular-nums">{compact(c.totalValue)}</TableCell>
                    <TableCell className={`text-right font-mono tabular-nums ${deltaClass(c.totalDelta)}`}>
                      {c.totalDelta != null ? signed(c.totalDelta) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {c.estimatedBudget != null ? compact(c.estimatedBudget) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        ≈ = reconstructed estimate, likely a lower bound (private bonuses/rewards aren&apos;t counted)
      </p>
    </div>
  );
}
