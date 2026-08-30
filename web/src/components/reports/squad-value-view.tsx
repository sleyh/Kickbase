"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, TrendingUp, TrendingDown, Wallet, PiggyBank, Trophy } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { compact, signed } from "@/lib/format";
import { DEBT_CEILING_RATIO, type SquadValueReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ValueTrendChart } from "@/components/reports/value-trend-chart";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { celebrate } from "@/lib/celebrate";
import { toast } from "sonner";

const BIG_WIN_THRESHOLD = 500_000;

const chartConfig = {
  value: { label: "Squad value", color: "var(--chart-1)" },
} satisfies ChartConfig;

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  tone?: "positive" | "negative";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="rounded-full bg-muted p-2">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p
            className={
              tone === "positive"
                ? "text-lg font-semibold text-green-600 dark:text-green-400"
                : tone === "negative"
                  ? "text-lg font-semibold text-destructive"
                  : "text-lg font-semibold"
            }
          >
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SquadValueView({
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
    // Only a client-triggered refresh that reveals a real jump earns
    // confetti - never the initial server-rendered load, and never a
    // negative or merely-positive delta.
    if (data && result.totalDelta > data.totalDelta && result.totalDelta >= BIG_WIN_THRESHOLD) {
      celebrate("big");
    }
    setData(result);
    setLastGenerated(new Date().toISOString());
  }

  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground">No squad value data yet.</p>
          <Button onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Fetch squad value"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const chartData = [
    { name: "You", value: data.totalValue },
    ...(data.competitors ?? []).map((c) => ({ name: c.name, value: c.totalValue })),
  ].sort((a, b) => b.value - a.value);

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.leagueName}</h1>
          {lastGenerated && (
            <p className="text-sm text-muted-foreground">
              Updated {new Date(lastGenerated).toLocaleString()}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={data.totalDelta >= 0 ? TrendingUp : TrendingDown}
          label="Squad total today"
          value={<AnimatedNumber value={data.totalDelta} formatter={signed} />}
          tone={data.totalDelta >= 0 ? "positive" : "negative"}
        />
        <StatCard
          icon={Wallet}
          label="Budget"
          value={<AnimatedNumber value={data.budget} formatter={compact} />}
          tone={data.budget < 0 ? "negative" : undefined}
        />
        <StatCard icon={Trophy} label="Squad value" value={<AnimatedNumber value={data.totalValue} formatter={compact} />} />
        <StatCard
          icon={PiggyBank}
          label="Total (budget + squad)"
          value={<AnimatedNumber value={data.netWorth} formatter={compact} />}
        />
      </div>

      {data.valueTrend.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Squad value, last {data.valueTrend.length} days</CardTitle>
          </CardHeader>
          <CardContent>
            <ValueTrendChart data={data.valueTrend} />
          </CardContent>
        </Card>
      )}

      {data.competitors && data.competitors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Squad value vs. competitors</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
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
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your players today</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {data.players.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <span className="font-medium">{p.name}</span>
              <div className="flex items-center gap-2">
                {!p.attributable && (
                  <Badge variant="secondary" className="text-xs">
                    just bought
                  </Badge>
                )}
                <span
                  className={
                    p.d1 > 0
                      ? "text-green-600 dark:text-green-400"
                      : p.d1 < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {signed(p.d1)}
                </span>
              </div>
            </motion.div>
          ))}
          {data.noHistoryYet.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              No value history yet: {data.noHistoryYet.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      {data.competitors && (
        <Card>
          <CardHeader>
            <CardTitle>Competitors</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[...data.competitors]
              .sort((a, b) => (b.totalDelta ?? -Infinity) - (a.totalDelta ?? -Infinity))
              .map((c) => (
                <div key={c.name} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.name}</span>
                    <span
                      className={
                        c.totalDelta == null
                          ? "text-muted-foreground"
                          : c.totalDelta > 0
                            ? "text-green-600 dark:text-green-400"
                            : c.totalDelta < 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                      }
                    >
                      {c.totalDelta == null ? "no data yet" : signed(c.totalDelta)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">squad {compact(c.totalValue)}</p>
                  {c.estimatedBudget != null && (
                    <p className="text-sm text-muted-foreground">
                      budget ≈{compact(c.estimatedBudget)} · can spend up to ≈
                      {compact(c.estimatedBudget + DEBT_CEILING_RATIO * c.totalValue)}
                    </p>
                  )}
                </div>
              ))}
            <p className="text-xs text-muted-foreground">
              ≈ = reconstructed estimate, likely a lower bound (private bonuses/rewards aren&apos;t counted)
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
