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


def _delta_label(delta: int | None) -> str:
    """Formats a market-value change for display, or explains why there
    isn't one yet."""
    if delta is None:
        return "Δmv: no trend data yet (first time seen)"
    sign = "+" if delta >= 0 else ""
    return f"Δmv {sign}{delta:,.0f} since last check"


def build_briefing(
    league_id: str,
    league_name: str,
    squad: list[dict],
    budget: float,
    market: list[dict],
    max_squad_size: int,
) -> str:
    lines = [
        f"*{league_name}*",
        f"Budget: {budget:,.0f}  |  Squad: {len(squad)}/{max_squad_size}",
        "ℹ️ Score = momentum ranking (value trend × points production, higher = stronger signal). "
        "Δmv = observed market value change since the last time this ran - builds up over the "
        "first few days as history accumulates, and only moves when Kickbase updates values "
        "(roughly once daily).",
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
        for p in instant_sells:
            # Squad items carry sdmvt (the API's own recent-delta figure) directly.
            delta = _delta_label(p.get("sdmvt"))
            lines.append(f"  • {_name(p)} — instant-sell to Kickbase, ~{p.get('mv', 0):,.0f} (0 pts, {delta})")
        for p in list_sells:
            delta = _delta_label(p.get("sdmvt"))
            lines.append(f"  • {_name(p)} — list on market at ~{p.get('mv', 0):,.0f} ({delta})")
    else:
        lines.append("📉 Sell advice: nothing worth selling right now.")
    lines.append("")

    buys = strategy.buy_candidates(market, budget, len(squad), max_squad_size)
    if buys:
        lines.append("📈 Buy advice (affordable, within squad room):")
        for p in buys:
            score = predict.momentum_score(p)
            # Market listings never carry sdmvt (see momentum_score) - this
            # is our own history-based substitute instead.
            delta = _delta_label(predict.observed_delta(league_id, p.get("i"), p.get("mv")))
            lines.append(f"  • {_name(p)} — bid {p.get('prc', 0):,.0f} (score {score:.0f}, {delta})")
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
        for p in rising:
            lines.append(f"  • {_name(p)} — {p.get('prc', 0):,.0f} ({p.get('ap', 0)} avg pts)")

    return "\n".join(lines)
