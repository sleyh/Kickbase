import Link from "next/link";
import { TrendingUp, Users, Repeat, Radio, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { compact, signed } from "@/lib/format";
import type { SquadValueReport, BonusReport } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BonusCard } from "@/components/reports/bonus-card";

const SHORTCUTS = [
  { href: "/dashboard/squad-value", label: "Squad Value", icon: TrendingUp, description: "Daily value + competitors" },
  { href: "/dashboard/transfer-analysis", label: "Transfer Analysis", icon: Repeat, description: "Who overspends" },
  { href: "/dashboard/live", label: "Live Matchday", icon: Radio, description: "Live points, by match" },
  { href: "/dashboard/alerts", label: "Market Alerts", icon: Users, description: "Notable new listings" },
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">
          {squadValue ? squadValue.leagueName : "Everything from your Kickbase league, in one place."}
        </p>
      </div>

      {squadValue && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Squad total today</p>
              <p
                className={
                  squadValue.totalDelta >= 0
                    ? "text-lg font-semibold text-green-600 dark:text-green-400"
                    : "text-lg font-semibold text-destructive"
                }
              >
                {signed(squadValue.totalDelta)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Budget</p>
              <p className="text-lg font-semibold">{compact(squadValue.budget)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Squad value</p>
              <p className="text-lg font-semibold">{compact(squadValue.totalValue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Total value</p>
              <p className="text-lg font-semibold">{compact(squadValue.netWorth)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {SHORTCUTS.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-muted p-2">
                    <s.icon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{s.label}</CardTitle>
                    <CardDescription>{s.description}</CardDescription>
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground" />
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <BonusCard initialData={(bonusCache?.payload as BonusReport) ?? null} />
    </div>
  );
}
