"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ArrowLeft, TrendingUp, Repeat } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { compact } from "@/lib/format";
import type { ManagerDetailReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlayerAvatar } from "@/components/kickbase/player-avatar";
import { PlayerCard } from "@/components/kickbase/player-card";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { toast } from "sonner";

const chartConfig = {
  points: { label: "Matchday points", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ManagerDetailView({ id }: { id: string }) {
  const supabase = createClient();
  const [data, setData] = useState<ManagerDetailReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  async function load() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("manager-detail", { body: { id } });
    setLoading(false);
    if (error || result?.error) {
      setNotFound(true);
      toast.error(result?.error ?? error?.message ?? "Couldn't load this manager.");
      return;
    }
    setData(result);
  }

  useEffect(() => {
    // Fetch-on-mount, same reasoning/justification as live-matchday-view.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <RefreshCw className="mr-2 size-4 animate-spin" /> Loading manager...
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center text-muted-foreground">
          Couldn&apos;t load this manager.
          <Link href="/dashboard/competitors">
            <Button variant="outline" size="sm">
              <ArrowLeft className="size-3.5" /> Back to Competitors
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const performanceData = data.performance.map((p) => ({ label: `MD ${p.day}`, points: p.points }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/competitors"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <PlayerAvatar name={data.name} photo={data.photo} size="lg" />
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
            {data.name}
            {data.isYou && <Badge variant="secondary">you</Badge>}
          </h1>
          {data.rank != null && <p className="text-sm text-muted-foreground">Rank #{data.rank} in the league</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Squad value</p>
            <AnimatedNumber value={data.squadValue} format="compact" className="text-lg font-semibold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Est. budget</p>
            <p className="text-lg font-semibold">{data.estimatedBudget != null ? compact(data.estimatedBudget) : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Season points</p>
            <p className="font-mono text-lg font-semibold tabular-nums">{data.seasonTotalPoints ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Matchday wins</p>
            <p className="font-mono text-lg font-semibold tabular-nums">{data.dashboard?.matchdayWins ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      {performanceData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4" /> Points by matchday
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-56 w-full">
              <BarChart data={performanceData} margin={{ left: 4, right: 4 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.3} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="points" fill="var(--color-points)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {data.squad.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Squad</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.squad.map((p) => (
                <PlayerCard
                  key={p.id}
                  player={{ name: p.name, photo: p.photo, pos: p.pos, value: p.value, delta: p.d1 }}
                  href={`/dashboard/player/${p.id}`}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.transfers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Repeat className="size-4" /> Transfer history
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.transfers.slice(0, 20).map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>
                  <span className={t.type === "buy" ? "text-destructive" : "text-green-600 dark:text-green-400"}>
                    {t.type === "buy" ? "Bought" : "Sold"}
                  </span>{" "}
                  <span className="font-medium">{t.playerName}</span>
                  {t.counterparty && <span className="text-muted-foreground"> · vs {t.counterparty}</span>}
                </span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  {new Date(t.date).toLocaleDateString()}
                  <span className="font-mono tabular-nums text-foreground">{compact(t.amount)}</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
