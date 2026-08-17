"""Advisory market/squad briefing - summarizes state and recommends
actions without executing anything.

Reuses the exact same decision logic as the bot (strategy.py/predict.py),
so the advice here is what the bot *would* do if it were live - this just
stops short of acting on it. Kept separate from cli.py's bot command so
the two can diverge later (e.g. a more conversational tone for Telegram)
without touching execution code.
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import predict, strategy

MOVERS_LIMIT = 5
MIN_SQUAD_SIZE = 11


def _name(player: dict) -> str:
    first = player.get("fn", "")
    last = player.get("n") or player.get("ln") or ""
    name = " ".join(p for p in (first, last) if p)
    return name or "?"


def _signed(n: float) -> str:
    return f"{'+' if n >= 0 else ''}{n:,.0f}"


def _trend_label(player: dict) -> str:
    """Formats a player's real 24h/7d market-value change (see
    predict.history_deltas, attached by cli.py's _enrich_with_history
    before this is ever called) plus the naive next-day projection, or
    explains why none of that is available yet."""
    d1, d7 = player.get("d1"), player.get("d7")
    if d1 is None and d7 is None:
        return "no value history available for this player yet"
    parts = []
    if d1 is not None:
        parts.append(f"24h {_signed(d1)}")
    if d7 is not None:
        parts.append(f"7d {_signed(d7)}")
    projection = predict.naive_projection(player)
    if projection is not None:
        parts.append(f"next-day est. {_signed(projection)}")
    return ", ".join(parts)


def _normalized_scores(players: list[dict], score_fn) -> dict[str, int]:
    """Min-max normalizes score_fn(player) to 0-100 across this specific
    list, for display only - doesn't touch the actual ranking, which
    strategy.py already computed on the raw score before this runs. Keeps
    "score" from looking like a currency amount (which it isn't) or
    confusingly retaining the sign/scale of whatever the raw formula
    happened to produce.
    """
    raw = {p["i"]: score_fn(p) for p in players if p.get("i")}
    if not raw:
        return {}
    lo, hi = min(raw.values()), max(raw.values())
    if hi == lo:
        return {pid: 100 for pid in raw}
    return {pid: round((v - lo) / (hi - lo) * 100) for pid, v in raw.items()}


def build_briefing(
    league_name: str,
    squad: list[dict],
    budget: float,
    market: list[dict],
    max_squad_size: int,
) -> str:
    lines = [
        f"*{league_name}*",
        f"Budget: {budget:,.0f}  |  Squad: {len(squad)}/{max_squad_size}",
        "ℹ️ Score = relative ranking 0-100 within each list below (not a currency amount or a "
        "prediction) from 7-day trend × points production. 24h/7d = actual observed market value "
        "change, from Kickbase's own history. next-day est. = naive extrapolation of the 7d trend, "
        "not a real forecast.",
        "",
    ]

    lineup_result = strategy.best_lineup(squad)
    if lineup_result is None:
        shortfall = strategy.position_shortfall(squad)
        if shortfall:
            def _label(pos: int, n: int) -> str:
                name = strategy.POSITION_NAMES[pos]
                return f"{n} more fit {name if n != 1 else name[:-1]}"
            gaps = ", ".join(_label(pos, n) for pos, n in shortfall.items())
            lines.append(f"⚠️ Can't fill a lineup: need {gaps} (injured/suspended players don't count).")
        else:
            lines.append("⚠️ Not enough fit players to fill a legal lineup right now.")
        bench = squad
    else:
        formation, starter_ids, bench = lineup_result
        by_id = {p["i"]: p for p in squad}
        lines.append(f"🔄 Recommended lineup: {formation}")
        lines.append("  " + ", ".join(_name(by_id[pid]) for pid in starter_ids))
    lines.append("")

    instant_sells, list_sells = strategy.sell_candidates(bench, MIN_SQUAD_SIZE, len(squad))
    if instant_sells or list_sells:
        lines.append("📉 Sell advice:")
        sell_scores = _normalized_scores(instant_sells + list_sells, predict.decline_urgency)
        for p in instant_sells:
            lines.append(
                f"  • {_name(p)} — instant-sell to Kickbase, ~{p.get('mv', 0):,.0f} "
                f"(urgency {sell_scores.get(p['i'], 0)}, 0 pts, {_trend_label(p)})"
            )
        for p in list_sells:
            lines.append(
                f"  • {_name(p)} — list on market at ~{p.get('mv', 0):,.0f} "
                f"(urgency {sell_scores.get(p['i'], 0)}, {_trend_label(p)})"
            )
    else:
        lines.append("📉 Sell advice: nothing worth selling right now.")
    lines.append("")

    buys = strategy.buy_candidates(market, budget, len(squad), max_squad_size)
    if buys:
        lines.append("📈 Buy advice (affordable, within squad room):")
        buy_scores = _normalized_scores(buys, predict.momentum_score)
        for p in buys:
            lines.append(
                f"  • {_name(p)} — bid {p.get('prc', 0):,.0f} (score {buy_scores.get(p['i'], 0)}, {_trend_label(p)})"
            )
    else:
        lines.append("📈 Buy advice: nothing affordable stands out right now.")
    lines.append("")

    bought_ids = {p.get("i") for p in buys}
    rising = sorted(
        (m for m in market if m.get("mvt") == strategy.RISING and m.get("i") not in bought_ids),
        key=predict.momentum_score,
        reverse=True,
    )[:MOVERS_LIMIT]
    if rising:
        lines.append("🔥 Also rising, but out of budget/squad room right now:")
        watch_scores = _normalized_scores(rising, predict.momentum_score)
        for p in rising:
            lines.append(
                f"  • {_name(p)} — {p.get('prc', 0):,.0f} "
                f"(score {watch_scores.get(p['i'], 0)}, {p.get('ap', 0)} avg pts, {_trend_label(p)})"
            )

    return "\n".join(lines)
