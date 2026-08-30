import Link from "next/link";
import { PlayerAvatar } from "@/components/kickbase/player-avatar";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Not a new table primitive - web/src/components/ui/table.tsx already
 * has everything a table needs (hover rows, alignment). This is just the
 * one cell shape every new table in the app reuses: an avatar + name (+
 * optional subtitle), for both players (pass pos for the position ring)
 * and managers (omit it).
 */
export function PlayerCell({
  name,
  photo,
  pos,
  subtitle,
  href,
  className,
}: {
  name: string;
  photo?: string | null;
  pos?: number | null;
  subtitle?: string | null;
  /** When set, the name links to this route (e.g. a player/manager detail page). */
  href?: string;
  className?: string;
}) {
  const nameEl = href ? (
    <Link href={href} className="truncate font-medium hover:underline">
      {name}
    </Link>
  ) : (
    <div className="truncate font-medium">{name}</div>
  );

  return (
    <TableCell className={cn("whitespace-nowrap", className)}>
      <div className="flex items-center gap-2">
        <PlayerAvatar name={name} photo={photo} pos={pos} size="sm" />
        <div className="min-w-0">
          {nameEl}
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
    </TableCell>
  );
}

/** Same as PlayerCell, minus the position ring - for manager/competitor tables. */
export function ManagerCell({
  name,
  photo,
  subtitle,
  href,
  className,
}: {
  name: string;
  photo?: string | null;
  subtitle?: string | null;
  href?: string;
  className?: string;
}) {
  return <PlayerCell name={name} photo={photo} subtitle={subtitle} href={href} className={className} />;
}
