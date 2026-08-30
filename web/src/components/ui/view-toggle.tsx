"use client";

import { LayoutGrid, Table2 } from "lucide-react";
import type { ViewMode } from "@/lib/use-view-mode";
import { cn } from "@/lib/utils";

/** Same segmented-control visual language as market-view.tsx's tab bar. */
export function ViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 rounded-lg border p-1", className)}>
      {(
        [
          { key: "cards", label: "Cards", icon: LayoutGrid },
          { key: "table", label: "Table", icon: Table2 },
        ] as const
      ).map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          aria-label={`${opt.label} view`}
          aria-pressed={mode === opt.key}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
            mode === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <opt.icon className="size-3.5" />
          <span className="hidden sm:inline">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
