"use client";

import type { ReactNode, MouseEvent } from "react";
import Link from "next/link";
import { PlayerAvatar } from "@/components/kickbase/player-avatar";
import { Sparkline } from "@/components/kickbase/sparkline";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { compact, signed } from "@/lib/format";
import { positionColor, positionLabel } from "@/lib/positions";
import { cn } from "@/lib/utils";

export interface PlayerCardData {
  name: string;
  photo?: string | null;
  pos?: number | null;
  team?: string | null;
  value?: number | null;
  delta?: number | null;
  points?: number | null;
  sparkline?: number[];
}

/**
 * The FIFA-style player card. `full` is a tall grid tile (photo, position
 * ribbon, name, big stat, delta, sparkline); `compact` is a single dense
 * row (small avatar, name, right-aligned stat) for lists like live-matchday
 * rosters or market own-bids where a full grid would be too much.
 */
export function PlayerCard({
  player,
  variant = "full",
  badge,
  caption,
  animateValue = false,
  href,
  menu,
  extra,
  owner,
  className,
}: {
  player: PlayerCardData;
  variant?: "full" | "compact";
  badge?: ReactNode;
  /** Small secondary line under the primary stat (full variant only) - e.g. "140 avg pts" on a market listing. */
  caption?: ReactNode;
  /** Tween the primary stat on change instead of snapping - for a value that updates live (e.g. live matchday points). */
  animateValue?: boolean;
  /** When set, the whole card links to this route (e.g. a player detail page) - omit to keep it non-interactive. */
  href?: string;
  /** An action-menu trigger (e.g. PlayerActionsMenu) rendered in a corner. Clicks on it never trigger href navigation. */
  menu?: ReactNode;
  /** Full variant only - a footer block below the value/delta/sparkline row, for page-specific extra stats (mirrors ManagerCard's `extra`). */
  extra?: ReactNode;
  /** Full variant only - the manager currently holding/selling this player. Renders a small avatar in the top-left corner; omit or pass null/undefined to show nothing (e.g. a computer-market listing with no manager owner). */
  owner?: { name: string; photo?: string | null } | null;
  className?: string;
}) {
  const stopNavigation = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const primaryStat =
    player.points != null ? (
      animateValue ? <AnimatedNumber value={player.points} format="plain" /> : player.points
    ) : player.value != null ? (
      compact(player.value)
    ) : null;

  const body =
    variant === "compact" ? (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50",
          className
        )}
      >
        <PlayerAvatar name={player.name} photo={player.photo} pos={player.pos} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{player.name}</span>
            {badge}
          </div>
          {player.team && <p className="truncate text-xs text-muted-foreground">{player.team}</p>}
        </div>
        <div className="flex flex-col items-end">
          {primaryStat != null && <span className="font-mono font-semibold tabular-nums">{primaryStat}</span>}
          {player.delta != null && (
            <span
              className={cn(
                "font-mono text-xs tabular-nums",
                player.delta > 0
                  ? "text-green-600 dark:text-green-400"
                  : player.delta < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
              )}
            >
              {signed(player.delta)}
            </span>
          )}
        </div>
        {menu && (
          <div onClick={stopNavigation} className="shrink-0">
            {menu}
          </div>
        )}
      </div>
    ) : (
      <div
        className={cn(
          "group/player-card relative flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-transform hover:-translate-y-0.5 hover:shadow-lg",
          className
        )}
      >
        <div
          className="flex flex-col items-center gap-2 px-4 pt-5 pb-4"
          style={{
            background: `linear-gradient(180deg, color-mix(in oklch, ${positionColor(player.pos)} 18%, transparent), transparent)`,
          }}
        >
          {menu && (
            <div onClick={stopNavigation} className="absolute top-2 right-2 z-10">
              {menu}
            </div>
          )}
          {owner && (
            <div className="absolute top-2 left-2 z-10" title={`Listed by ${owner.name}`}>
              <PlayerAvatar name={owner.name} photo={owner.photo} size="sm" className="size-5 border" />
            </div>
          )}
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase"
            style={{ backgroundColor: positionColor(player.pos) }}
          >
            {positionLabel(player.pos)}
          </span>
          <PlayerAvatar name={player.name} photo={player.photo} pos={player.pos} size="lg" />
          <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="font-heading font-semibold leading-tight">{player.name}</span>
            {player.team && <span className="text-xs text-muted-foreground">{player.team}</span>}
          </div>
          {badge}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex flex-col">
            {primaryStat != null && (
              <span className="font-mono text-lg font-semibold tabular-nums">{primaryStat}</span>
            )}
            {player.delta != null && (
              <span
                className={cn(
                  "font-mono text-xs tabular-nums",
                  player.delta > 0
                    ? "text-green-600 dark:text-green-400"
                    : player.delta < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                )}
              >
                {signed(player.delta)} today
              </span>
            )}
            {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
          </div>
          {player.sparkline && player.sparkline.length >= 2 && (
            <Sparkline points={player.sparkline} className="h-8 w-20" />
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
