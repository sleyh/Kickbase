import Link from "next/link";
import { TrendingUp, Users, Repeat, Radio, ArrowRight, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { compact, signed } from "@/lib/format";
import type { SquadValueReport, BonusReport } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BonusCard } from "@/components/reports/bonus-card";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { ValueTrendChart } from "@/components/reports/value-trend-chart";
import { DebtCeilingGauge } from "@/components/reports/debt-ceiling-gauge";
import { AnimatedNumber } from "@/components/motion/animated-number";

const SHORTCUTS = [
  { href: "/dashboard/squad-value", label: "Squad Value", icon: TrendingUp },
  { href: "/dashboard/transfer-analysis", label: "Transfer Analysis", icon: Repeat },
  { href: "/dashboard/live", label: "Live Matchday", icon: Radio },
  { href: "/dashboard/alerts", label: "Market Alerts", icon: Users },
] as const;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: squadValueCache }, { data: bonusCache }] = await Promise.all([
    supabase
      .from("reports_cache")
      .select("payload, generated_at")
      .eq("user_id", user!.id)
      .eq("report_type", "squad_value")
      .maybeSingle(),
    supabase
      .from("reports_cache")
      .select("payload")
      .eq("user_id", user!.id)
      .eq("report_type", "collect_bonus")
      .maybeSingle(),
  ]);

  const squadValue = squadValueCache?.payload as SquadValueReport | undefined;

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresher tables={["reports_cache"]} filterUserId={user!.id} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">
          {squadValue ? squadValue.leagueName : "Everything from your Kickbase league, in one place."}
        </p>
      </div>

      {squadValue && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <Card className="col-span-2 md:col-span-4 md:row-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="size-4" /> Squad value
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <AnimatedNumber
                  value={squadValue.totalValue}
                  formatter={compact}
                  className="text-3xl font-semibold"
                />
                <span
                  className={
                    squadValue.totalDelta >= 0
                      ? "text-sm font-medium text-green-600 dark:text-green-400"
                      : "text-sm font-medium text-destructive"
                  }
                >
                  <AnimatedNumber value={squadValue.totalDelta} formatter={signed} /> today
                </span>
              </div>
              {squadValue.valueTrend.length >= 2 ? (
                <ValueTrendChart data={squadValue.valueTrend} className="h-40 w-full" />
              ) : (
                <p className="text-sm text-muted-foreground">Not enough history yet for a trend line.</p>
              )}
            </CardContent>
          </Card>

          <Card className="col-span-2 md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Debt ceiling</CardTitle>
            </CardHeader>
            <CardContent>
              <DebtCeilingGauge budget={squadValue.budget} totalValue={squadValue.totalValue} />
            </CardContent>
          </Card>

          <div className="col-span-2 md:col-span-2">
            <BonusCard initialData={(bonusCache?.payload as BonusReport) ?? null} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {SHORTCUTS.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="transition-colors hover:bg-muted/50 hover:shadow-[0_0_24px_var(--glow-primary)]">
              <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
                <div className="rounded-full bg-accent p-2.5">
                  <s.icon className="size-4 text-accent-foreground" />
                </div>
                <span className="flex items-center gap-1 text-sm font-medium">
                  {s.label}
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {!squadValue && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Trophy className="size-6" />
            No squad value data cached yet - open Squad Value to fetch it.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
