/**
 * TypeScript port of the parts of kickbase/report.py needed for the
 * squad-value report's Telegram delivery. The dashboard UI renders
 * SquadValueReport (squad-value.ts) directly as React components instead
 * of parsing this text back out - this exists purely for the Telegram
 * message, same numbers, formatted the same way as the Python original.
 */

import type { SquadValueReport } from "./squad-value.ts";
import type { SpendingProfile } from "./transfer-analysis.ts";
import type { MarketSnapshot } from "./market.ts";

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

function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
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

/**
 * Qualitative read on a manager's average premium over current market
 * value across their computer-market buys. Same 3%/15% thresholds as the
 * Python original.
 */
function spendingLabel(avgPct: number | null): string {
  if (avgPct == null) return "ℹ️ no computer-market buys yet";
  if (avgPct <= 3) return `🎯 pays close to asking price (${signedPct(avgPct)} avg)`;
  if (avgPct <= 15) return `💵 pays a moderate premium (${signedPct(avgPct)} avg)`;
  return `🔥 tends to overspend (${signedPct(avgPct)} avg)`;
}

/**
 * TS port of render_spending_analysis() - compares what each league
 * member actually paid for a player against that player's current market
 * value, the only way to see anything about Kickbase's otherwise-hidden
 * sealed-bid market, retroactively once a transfer has completed.
 */
export function renderTransferAnalysisTelegram(leagueName: string, profiles: SpendingProfile[]): string {
  const e = escapeHtml;
  const lines: string[] = [
    `💸 <b>Transfer Spending Analysis — ${e(leagueName)}</b>`,
    "ℹ️ Premium = price paid vs. that player's current market value",
    "",
  ];

  const avgOf = (p: SpendingProfile) =>
    p.computerBuys.length > 0
      ? p.computerBuys.reduce((sum, b) => sum + b.premiumPct, 0) / p.computerBuys.length
      : -Infinity;

  for (const profile of [...profiles].sort((a, b) => avgOf(b) - avgOf(a))) {
    const buys = profile.computerBuys;
    const avg = buys.length > 0 ? buys.reduce((sum, b) => sum + b.premiumPct, 0) / buys.length : null;
    const count = `${buys.length} computer buy${buys.length !== 1 ? "s" : ""}`;
    lines.push(`${spendingLabel(avg)} — <b>${e(profile.name)}</b> (${count})`);
  }

  const managerTrades = profiles.flatMap((p) => p.managerBuys.map((b) => ({ name: p.name, b })));
  if (managerTrades.length > 0) {
    lines.push("");
    lines.push("🤝 <b>Manager-to-manager trades</b>");
    for (const { name, b } of managerTrades.sort((x, y) => Math.abs(y.b.premiumPct) - Math.abs(x.b.premiumPct))) {
      lines.push(
        `${e(name)} paid ${e(signedPct(b.premiumPct))} vs. value for ${e(b.playerName)} ` +
          `(${e(compact(b.trp))} vs. ${e(compact(b.mv))}) — bought from ${e(b.othnm!)}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * TS port of render_bonus_collected() - a one-line Telegram message, only
 * ever sent when something was actually collected.
 */
export function renderBonusCollectedTelegram(leagueName: string, amount: number, streakDay: number): string {
  const e = escapeHtml;
  return `💰 <b>Daily bonus collected</b> — ${e(leagueName)}\n${e(compact(amount))} (day ${streakDay} streak)`;
}

/**
 * A market snapshot digest: notable listings (rising or already scoring)
 * plus your own active bids. Not a diff against the previous poll (see
 * market.ts's module docstring) - "what's notable right now."
 */
export function renderMarketSnapshotTelegram(data: MarketSnapshot): string {
  const e = escapeHtml;
  const lines: string[] = [`🛒 <b>Market Snapshot — ${e(data.leagueName)}</b>`, ""];

  if (data.notable.length === 0) {
    lines.push("Nothing notable on the market right now.");
  } else {
    lines.push("<b>Notable listings</b> (rising or already scoring)");
    for (const p of data.notable.slice(0, 15)) {
      const trend = p.rising ? "📈" : "⚪";
      lines.push(`${trend} <b>${e(p.name)}</b>  ${e(compact(p.price))}  (${p.avgPoints} avg pts)`);
    }
  }

  if (data.ownBids.length > 0) {
    lines.push("");
    lines.push("<b>Your active bids</b>");
    for (const p of data.ownBids) {
      lines.push(`📤 <b>${e(p.name)}</b>  ${e(compact(p.ownBidAmount ?? 0))}`);
    }
  }

  return lines.join("\n");
}
