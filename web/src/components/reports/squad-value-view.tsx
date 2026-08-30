"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { RefreshCw, TrendingUp, TrendingDown, Wallet, PiggyBank, Trophy, Users, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SquadValueReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ValueTrendChart } from "@/components/reports/value-trend-chart";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { PlayerCard } from "@/components/kickbase/player-card";
import { ManagerCard } from "@/components/kickbase/manager-card";
import { celebrate } from "@/lib/celebrate";
import { toast } from "sonner";

const BIG_WIN_THRESHOLD = 500_000;

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

  const topCompetitors = [...(data.competitors ?? [])]
    .sort((a, b) => (b.totalDelta ?? -Infinity) - (a.totalDelta ?? -Infinity))
    .slice(0, 3);

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{data.leagueName}</h1>
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
          value={<AnimatedNumber value={data.totalDelta} format="signed" />}
          tone={data.totalDelta >= 0 ? "positive" : "negative"}
        />
        <StatCard
          icon={Wallet}
          label="Budget"
          value={<AnimatedNumber value={data.budget} format="compact" />}
          tone={data.budget < 0 ? "negative" : undefined}
        />
        <StatCard icon={Trophy} label="Squad value" value={<AnimatedNumber value={data.totalValue} format="compact" />} />
        <StatCard
          icon={PiggyBank}
          label="Total (budget + squad)"
          value={<AnimatedNumber value={data.netWorth} format="compact" />}
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

      <Card>
        <CardHeader>
          <CardTitle>Your players today</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.players.map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <PlayerCard
                  player={{
                    name: p.name,
                    photo: p.photo,
                    pos: p.pos,
                    value: p.value,
                    delta: p.d1,
                    sparkline: p.sparkline,
                  }}
                  href={p.id ? `/dashboard/player/${p.id}` : undefined}
                  caption={p.points != null ? `${p.points} pts` : undefined}
                  badge={
                    !p.attributable && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                        just bought
                      </span>
                    )
                  }
                />
              </motion.div>
            ))}
          </div>
          {data.noHistoryYet.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              No value history yet: {data.noHistoryYet.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      {topCompetitors.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" /> Top movers among competitors
            </CardTitle>
            <Link href="/dashboard/competitors">
              <Button variant="ghost" size="sm">
                View all <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {topCompetitors.map((c) => (
                <ManagerCard
                  key={c.name}
                  manager={{ name: c.name, photo: c.photo, value: c.totalValue, delta: c.totalDelta }}
                  href={c.id ? `/dashboard/manager/${c.id}` : undefined}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
