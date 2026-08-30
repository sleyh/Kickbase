"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { kickbaseImageUrl } from "@/lib/kickbase-image";
import { cn } from "@/lib/utils";

/**
 * Confirmed live (team-detail's raw competition-table response carries a
 * "tim" field, same relative-path convention as player/manager photos) -
 * tries the real crest first, falls back to deterministic-color initials
 * on a missing field or a failed image load, same reasoning as
 * PlayerAvatar. Same team id always gets the same fallback color.
 */
function hashColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `oklch(0.55 0.15 ${hash % 360})`;
}

const SIZE_PX = { sm: 24, md: 32 } as const;

export function TeamBadge({
  teamId,
  teamName,
  crest,
  size = "md",
  className,
}: {
  teamId: string;
  teamName: string;
  crest?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const url = kickbaseImageUrl(crest);
  const [failed, setFailed] = useState(false);
  const color = hashColor(teamId || teamName);
  const sizeClass = size === "sm" ? "size-6 text-[9px]" : "size-8 text-[10px]";

  if (!url || failed) {
    return (
      <Link
        href={`/dashboard/team/${teamId}`}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white transition-transform hover:scale-105",
          sizeClass,
          className
        )}
        style={{ backgroundColor: color }}
        title={teamName}
      >
        {teamName.slice(0, 3).toUpperCase()}
      </Link>
    );
  }

  return (
    <Link
      href={`/dashboard/team/${teamId}`}
      className={cn("inline-flex shrink-0 items-center justify-center transition-transform hover:scale-105", className)}
      title={teamName}
    >
      <Image
        src={url}
        alt={teamName}
        width={SIZE_PX[size]}
        height={SIZE_PX[size]}
        className={cn("object-contain", sizeClass)}
        onError={() => setFailed(true)}
      />
    </Link>
  );
}
