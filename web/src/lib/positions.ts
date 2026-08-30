/** Kickbase's position codes (1=GK, 2=DEF, 3=MID, 4=FWD) - same convention the formation-legality logic elsewhere in this app's history was built against. */
const POSITION_LABELS: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

// Reuses the chart palette from globals.css so a position ribbon and a
// chart series never fight for meaning on the same page.
const POSITION_COLORS: Record<number, string> = {
  1: "var(--chart-3)",
  2: "var(--chart-2)",
  3: "var(--chart-1)",
  4: "var(--chart-5)",
};

export function positionLabel(pos?: number | null): string {
  return (pos != null && POSITION_LABELS[pos]) || "?";
}

export function positionColor(pos?: number | null): string {
  return (pos != null && POSITION_COLORS[pos]) || "var(--muted-foreground)";
}
