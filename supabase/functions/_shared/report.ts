/**
 * TypeScript port of the parts of kickbase/report.py needed for the
 * squad-value report's Telegram delivery. The dashboard UI renders
 * SquadValueReport (squad-value.ts) directly as React components instead
 * of parsing this text back out - this exists purely for the Telegram
 * message, same numbers, formatted the same way as the Python original.
 */

import type { SquadValueReport } from "./squad-value.ts";

// Kickbase lets a bid push your budget negative, up to a debt ceiling of
// 33% of your total squad value - confirmed live via binary search on
// two real listings (see kickbase/report.py's DEBT_CEILING_RATIO for the
// full derivation).
export const DEBT_CEILING_RATIO = 0.33;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 5,638,638 -> "5.6m", 520,628 -> "521k", 850 -> "850". */
function compact(n: number): string {
  const sign = n < 0 ? "-" : "";
  n = Math.abs(n);
  if (n >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${sign}${Math.round(n / 1_000)}k`;
  return `${sign}${n.toFixed(0)}`;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${compact(n)}`;
}

/**
 * Renders SquadValueReport to the exact Telegram HTML layout as the
 * Python CLI's render_squad_value_update() - budget/net-worth summary,
 * per-player d1 sorted best-first, then a competitors board with the 33%
 * debt-ceiling spending power line.
 */
export function renderSquadValueTelegram(data: SquadValueReport): string {
  const e = escapeHtml;
  const lines: string[] = [
    `📊 <b>Daily Value Update — ${e(data.leagueName)}</b>`,
    "",
    `${data.totalDelta >= 0 ? "📈" : "📉"} <b>Squad total: ${e(signed(data.totalDelta))} today</b>`,
    `💰 Budget: ${e(compact(data.budget))}`,
    `👥 Squad value: ${e(compact(data.totalValue))}`,
    `🏦 Total value (budget + squad): ${e(compact(data.netWorth))}`,
    "",
  ];

  for (const p of data.players) {
    const icon = p.d1 > 0 ? "🟢" : p.d1 < 0 ? "🔴" : "⚪";
    const note = p.attributable ? "" : " (just bought - not in total)";
    lines.push(`${icon} <b>${e(p.name)}</b>  ${e(signed(p.d1))}${e(note)}`);
  }

  if (data.noHistoryYet.length > 0) {
    lines.push("");
    lines.push("ℹ️ No value history yet: " + data.noHistoryYet.map(e).join(", "));
  }

  if (data.competitors) {
    lines.push("");
    lines.push("🏆 <b>Competitors (squad value today)</b>");
    const ranked = [...data.competitors].sort(
      (a, b) => (b.totalDelta ?? -Infinity) - (a.totalDelta ?? -Infinity)
    );
    for (const comp of ranked) {
      const icon = comp.totalDelta == null ? "⚪" : comp.totalDelta > 0 ? "🟢" : comp.totalDelta < 0 ? "🔴" : "⚪";
      const deltaStr = comp.totalDelta == null ? "no data yet" : e(signed(comp.totalDelta));
      lines.push(`${icon} <b>${e(comp.name)}</b>`);
      lines.push(`   👥 squad ${e(compact(comp.totalValue))} (${deltaStr})`);
      if (comp.estimatedBudget != null) {
        const total = comp.estimatedBudget + comp.totalValue;
        const spendingPower = comp.estimatedBudget + DEBT_CEILING_RATIO * comp.totalValue;
        lines.push(`   💰 budget ≈${e(compact(comp.estimatedBudget))}`);
        lines.push(`   🏦 total ≈${e(compact(total))}`);
        lines.push(`   💪 can spend up to ≈${e(compact(spendingPower))} (33% debt rule)`);
      }
    }
    lines.push("");
    lines.push("<i>ℹ️ ≈ = reconstructed estimate, not their real number</i>");
    lines.push("<i>(likely a lower bound - private bonuses/rewards aren't counted)</i>");
    lines.push("<i>💪 = max bid Kickbase allows: budget + 33% of squad value</i>");
  }

  return lines.join("\n");
}
