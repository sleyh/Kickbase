"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

/** A tiny axis-less trend line - green if the series net-rises, red if it net-falls. Renders nothing for fewer than 2 points. */
export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;

  const data = points.map((v, i) => ({ i, v }));
  const rising = points[points.length - 1] >= points[0];
  const color = rising ? "var(--chart-1)" : "var(--destructive)";

  return (
    <div className={className ?? "h-8 w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
