"use client";

import { RadialBar, RadialBarChart, PolarAngleAxis } from "recharts";
import { DEBT_CEILING_RATIO } from "@/lib/types";
import { compact } from "@/lib/format";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  used: { label: "Debt ceiling used", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * How much of the 33%-of-squad-value debt ceiling the user's own budget
 * is currently using - 0% whenever budget isn't negative (there's no
 * debt to speak of), scaling toward 100% as a negative budget approaches
 * DEBT_CEILING_RATIO * totalValue (the actual cap Kickbase enforces on
 * selling below - see report.ts's DEBT_CEILING_RATIO usage).
 */
export function DebtCeilingGauge({ budget, totalValue }: { budget: number; totalValue: number }) {
  const ceiling = DEBT_CEILING_RATIO * totalValue;
  const debtUsed = budget < 0 ? -budget : 0;
  const pct = ceiling > 0 ? Math.min(100, (debtUsed / ceiling) * 100) : 0;
  const data = [{ name: "used", value: pct, fill: "var(--color-used)" }];

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-28 w-28">
          <RadialBarChart data={data} startAngle={90} endAngle={-270} innerRadius="72%" outerRadius="100%">
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "var(--muted)" }} />
          </RadialBarChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-semibold tabular-nums">{Math.round(pct)}%</span>
          <span className="text-[10px] text-muted-foreground">debt ceiling</span>
        </div>
      </div>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        {budget < 0 ? `${compact(-budget)} in debt of ${compact(ceiling)} allowed` : "No debt right now"}
      </p>
    </div>
  );
}
