import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * No confirmed club-crest image field exists anywhere in this codebase's
 * API research (unlike player/manager photos, which were verified live) -
 * this always renders the deterministic-color initials fallback rather
 * than guess at a field name. Same team id always gets the same color.
 */
function hashColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `oklch(0.55 0.15 ${hash % 360})`;
}

export function TeamBadge({
  teamId,
  teamName,
  size = "md",
  className,
}: {
  teamId: string;
  teamName: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const color = hashColor(teamId || teamName);
  const sizeClass = size === "sm" ? "size-6 text-[9px]" : "size-8 text-[10px]";

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
