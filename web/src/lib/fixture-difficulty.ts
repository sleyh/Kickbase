/** Shared between player-detail-view and team-detail-view - both show a fixture list with a difficulty tag derived from the same 0-1 opponent-strength score fixtures.ts computes server-side. */
export function fixtureDifficultyLabel(strength: number): { label: string; tone: string } {
  if (strength >= 0.66) return { label: "tough", tone: "bg-destructive text-destructive-foreground" };
  if (strength >= 0.4) return { label: "moderate", tone: "bg-amber-500 text-white" };
  return { label: "easy", tone: "bg-green-600 text-white" };
}
