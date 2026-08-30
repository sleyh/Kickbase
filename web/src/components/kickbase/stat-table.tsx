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
  className,
}: {
  name: string;
  photo?: string | null;
  pos?: number | null;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <TableCell className={cn("whitespace-nowrap", className)}>
      <div className="flex items-center gap-2">
        <PlayerAvatar name={name} photo={photo} pos={pos} size="sm" />
        <div className="min-w-0">
          <div className="truncate font-medium">{name}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
    </TableCell>
  );
}
