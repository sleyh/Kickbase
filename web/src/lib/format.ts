/** Mirrors supabase/functions/_shared/report.ts's compact()/signed() - same rules, for on-screen display instead of Telegram text. */
export function compact(n: number): string {
  const sign = n < 0 ? "-" : "";
  n = Math.abs(n);
  if (n >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${sign}${Math.round(n / 1_000)}k`;
  return `${sign}${n.toFixed(0)}`;
}

export function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${compact(n)}`;
}
