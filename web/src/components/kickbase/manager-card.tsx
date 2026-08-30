import type { ReactNode } from "react";
import Link from "next/link";
import { PlayerAvatar } from "@/components/kickbase/player-avatar";
import { Sparkline } from "@/components/kickbase/sparkline";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Badge } from "@/components/ui/badge";
import { compact, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ManagerCardData {
  name: string;
  photo?: string | null;
  rank?: number | null;
  value?: number | null;
  delta?: number | null;
  sparkline?: number[];
  isYou?: boolean;
}

/** The manager/competitor equivalent of PlayerCard - same full/compact shape, no position (avatar ring is neutral). */
export function ManagerCard({
  manager,
  variant = "full",
  statSuffix,
  badge,
  extra,
  animateValue = false,
  href,
  className,
}: {
  manager: ManagerCardData;
  variant?: "full" | "compact";
  statSuffix?: string;
  /** Compact variant only - rendered under the name (e.g. a spending-behavior tone label). */
  badge?: ReactNode;
  extra?: ReactNode;
  /** Tween the stat on change instead of snapping - for a value that updates live (e.g. live matchday points). */
  animateValue?: boolean;
  /** When set, the whole card links to this route (e.g. a manager detail page) - omit to keep it non-interactive. */
  href?: string;
  className?: string;
}) {
  const stat =
    manager.value == null ? null : animateValue ? (
      <AnimatedNumber value={manager.value} format="plain" />
    ) : (
      compact(manager.value)
    );

  const body =
    variant === "compact" ? (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50",
          manager.isYou && "border-primary/50 bg-primary/5",
          className
        )}
      >
        {manager.rank != null && <span className="w-5 shrink-0 text-sm text-muted-foreground">{manager.rank}</span>}
        <PlayerAvatar name={manager.name} photo={manager.photo} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{manager.name}</span>
            {manager.isYou && (
              <Badge variant="secondary" className="text-xs">
                you
              </Badge>
            )}
          </div>
          {badge}
        </div>
        {stat != null && (
          <span className="font-mono font-semibold tabular-nums">
            {stat}
            {statSuffix}
          </span>
        )}
      </div>
    ) : (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-transform hover:-translate-y-0.5 hover:shadow-lg",
          manager.isYou && "ring-2 ring-primary/50",
          className
        )}
      >
        <div className="flex flex-col items-center gap-2 px-4 pt-5 pb-4">
          {manager.rank != null && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              #{manager.rank}
            </span>
          )}
          <PlayerAvatar name={manager.name} photo={manager.photo} size="lg" />
          <div className="flex items-center gap-1.5">
            <span className="font-heading font-semibold leading-tight">{manager.name}</span>
            {manager.isYou && (
              <Badge variant="secondary" className="text-xs">
                you
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex flex-col">
            {stat != null && (
              <span className="font-mono text-lg font-semibold tabular-nums">
                {stat}
                {statSuffix}
              </span>
            )}
            {manager.delta != null && (
              <span
                className={cn(
                  "font-mono text-xs tabular-nums",
                  manager.delta > 0
                    ? "text-green-600 dark:text-green-400"
                    : manager.delta < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                )}
              >
                {signed(manager.delta)}
              </span>
            )}
          </div>
          {manager.sparkline && manager.sparkline.length >= 2 && (
            <Sparkline points={manager.sparkline} className="h-8 w-20" />
          )}
        </div>
        {extra}
      </div>
    );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
