"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { compact } from "@/lib/format";
import type { ValueTrendPoint } from "@/lib/types";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  totalValue: { label: "Squad value", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Squad value over the last ~14 days, from SquadValueReport.valueTrend. Shared between the squad-value page and the Overview bento cell. */
export function ValueTrendChart({ data, className }: { data: ValueTrendPoint[]; className?: string }) {
  const gradientId = useId();

  if (data.length < 2) {
    return <p className="text-sm text-muted-foreground">Not enough history yet for a trend line.</p>;
  }

  const chartData = data.map((p) => ({
    label: new Date(p.day * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    totalValue: p.totalValue,
  }));

  return (
    <ChartContainer config={chartConfig} className={className ?? "h-48 w-full"}>
      <AreaChart data={chartData} margin={{ left: 4, right: 4, top: 4 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-totalValue)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-totalValue)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.3} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <YAxis hide domain={["dataMin - 100000", "dataMax + 100000"]} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => compact(Number(v))} />} />
        <Area
          type="monotone"
          dataKey="totalValue"
          stroke="var(--color-totalValue)"
          fill={`url(#${gradientId})`}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
