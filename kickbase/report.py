"""Advisory market/squad briefing - summarizes state and recommends
actions without executing anything.

Reuses the exact same decision logic as the bot (strategy.py/predict.py),
so the advice here is what the bot *would* do if it were live - this just
stops short of acting on it.

compute_briefing() does the actual work once; render_text() (terminal +
Telegram fallback) and render_telegram() (photo + HTML + link buttons) are
two views over the same BriefingData, so the rich Telegram format can't
drift from what the plain digest says.
"""
from __future__ import annotations

import html
import urllib.parse
from dataclasses import dataclass, field

from . import predict, strategy, telegram

MOVERS_LIMIT = 5
MIN_SQUAD_SIZE = 11
KEYBOARD_LIMIT = 8  # cap on link buttons so the keyboard stays usable
CDN_BASE = "https://kickbase.b-cdn.net/"
TRANSFERMARKT_SEARCH = "https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query="


@dataclass
class BriefingData:
    league_name: str
    budget: float
    squad_size: int
    max_squad_size: int
    formation: str | None
    starters: list[dict]
    shortfall: dict[int, int]
    instant_sells: list[dict]
    list_sells: list[dict]
    buys: list[dict]
    watchlist: list[dict]
    sell_scores: dict[str, int] = field(default_factory=dict)
    buy_scores: dict[str, int] = field(default_factory=dict)
    watch_scores: dict[str, int] = field(default_factory=dict)


def _name(player: dict) -> str:
    first = player.get("fn", "")
    last = player.get("n") or player.get("ln") or ""
    name = " ".join(p for p in (first, last) if p)
    return name or "?"


def seller_name(player: dict) -> str:
    """The market listing's actual seller. Manager-listed items carry a
    "u" object with the seller's identity ({"i": ..., "n": name, ...});
    computer-generated listings never have that field at all (confirmed
    by listing a real player for sale and diffing its raw JSON against a
    computer listing - "u" was the only field that differed in that
    direction). Buying from a manager and buying from the computer market
    are very different situations, so this is worth surfacing everywhere
    a market item is shown.
    """
    seller = player.get("u")
    return seller.get("n", "?") if seller else "Kickbase"


def _split_by_seller(players: list[dict]) -> tuple[list[dict], list[dict]]:
    """(from_kickbase, from_managers) - same order, just partitioned so
    they can be shown as separate sections instead of interleaved. Doesn't
    change ranking or which players were selected, only how they're
    grouped for display.
    """
    from_kickbase = [p for p in players if not p.get("u")]
    from_managers = [p for p in players if p.get("u")]
    return from_kickbase, from_managers


def _compact(n: float) -> str:
    """Formats a currency-scale number compactly: 5,638,638 -> "5.6m",
    520,628 -> "521k", 850 -> "850"."""
    sign = "-" if n < 0 else ""
    n = abs(n)
    if n >= 1_000_000:
        return f"{sign}{n / 1_000_000:.1f}m"
    if n >= 1_000:
        return f"{sign}{round(n / 1_000)}k"
    return f"{sign}{n:.0f}"


def _signed(n: float) -> str:
    return f"{'+' if n >= 0 else ''}{_compact(n)}"


def _trend_label(player: dict) -> str:
    """Formats a player's real 24h/7d market-value change (see
    predict.history_deltas, attached by cli.py's _enrich_with_history
    before this is ever called) plus the naive next-day projection, or
    explains why none of that is available yet."""
    d1, d7 = player.get("d1"), player.get("d7")
    if d1 is None and d7 is None:
        return "📊 no value history available for this player yet"
    parts = []
    if d1 is not None:
        parts.append(f"24h {_signed(d1)}")
    if d7 is not None:
        parts.append(f"7d {_signed(d7)}")
    trend = "📊 " + " · ".join(parts) if parts else ""
    projection = predict.naive_projection(player)
    if projection is not None:
        trend += f"  🔮 next-day est. {_signed(projection)}"
    return trend


def _format_duration(seconds: float) -> str:
    seconds = int(seconds)
    if seconds <= 0:
        return "closing now"
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days > 0:
        return f"{days}d {hours}h"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def _deadline_label(player: dict) -> str:
    """When a listing closes. `exs` (seconds remaining) is only ever
    present on computer-generated listings - manager-listed items never
    carry it (confirmed the same way seller_name() was: diffed a fresh
    manager listing's raw JSON against a computer one), which matches
    manager listings staying up until bought or withdrawn rather than
    closing on a timer.
    """
    exs = player.get("exs")
    if exs is None:
        return "⏳ no deadline - stays listed until bought"
    return f"⏰ {_format_duration(exs)} left"


def _normalized_scores(players: list[dict], score_fn) -> dict[str, int]:
    """Min-max normalizes score_fn(player) to 0-100 across this specific
    list, for display only - doesn't touch the actual ranking, which
    strategy.py already computed on the raw score before this runs.
    """
    raw = {p["i"]: score_fn(p) for p in players if p.get("i")}
    if not raw:
        return {}
    lo, hi = min(raw.values()), max(raw.values())
    if hi == lo:
        return {pid: 100 for pid in raw}
    return {pid: round((v - lo) / (hi - lo) * 100) for pid, v in raw.items()}


def _player_photo_url(player: dict) -> str | None:
    """Kickbase's own CDN, per their doc: 'fetch images using this cdn
    url https://kickbase.b-cdn.net' + the relative 'pim' path."""
    path = player.get("pim")
    return f"{CDN_BASE}{path}" if path else None


def _transfermarkt_url(player: dict) -> str:
    return TRANSFERMARKT_SEARCH + urllib.parse.quote(_name(player))


def compute_briefing(squad: list[dict], budget: float, market: list[dict], max_squad_size: int) -> BriefingData:
    lineup_result = strategy.best_lineup(squad)
    if lineup_result is None:
        formation, starters, bench = None, [], squad
        shortfall = strategy.position_shortfall(squad)
    else:
        formation, starter_ids, bench = lineup_result
        by_id = {p["i"]: p for p in squad}
        starters = [by_id[pid] for pid in starter_ids]
        shortfall = {}

    instant_sells, list_sells = strategy.sell_candidates(bench, MIN_SQUAD_SIZE, len(squad))
    buys = strategy.buy_candidates(market, budget, len(squad), max_squad_size)
    bought_ids = {p.get("i") for p in buys}
    watchlist = sorted(
        (m for m in market if m.get("mvt") == strategy.RISING and m.get("i") not in bought_ids),
        key=predict.momentum_score,
        reverse=True,
    )[:MOVERS_LIMIT]

    return BriefingData(
        league_name="",
        budget=budget,
        squad_size=len(squad),
        max_squad_size=max_squad_size,
        formation=formation,
        starters=starters,
        shortfall=shortfall,
        instant_sells=instant_sells,
        list_sells=list_sells,
        buys=buys,
        watchlist=watchlist,
        sell_scores=_normalized_scores(instant_sells + list_sells, predict.decline_urgency),
        buy_scores=_normalized_scores(buys, predict.momentum_score),
        watch_scores=_normalized_scores(watchlist, predict.momentum_score),
    )


def render_text(league_name: str, data: BriefingData) -> str:
    lines = [
        f"*{league_name}*",
        f"Budget: {_compact(data.budget)}  |  Squad: {data.squad_size}/{data.max_squad_size}",
        "ℹ️ Score = relative ranking 0-100 within each list below (not a currency amount or a "
        "prediction) from 7-day trend × points production. 24h/7d = actual observed market value "
        "change, from Kickbase's own history. next-day est. = naive extrapolation of the 7d trend, "
        "not a real forecast.",
        "",
    ]

    if data.formation is None:
        if data.shortfall:
            def _label(pos: int, n: int) -> str:
                name = strategy.POSITION_NAMES[pos]
                return f"{n} more fit {name if n != 1 else name[:-1]}"
            gaps = ", ".join(_label(pos, n) for pos, n in data.shortfall.items())
            lines.append(f"⚠️ Can't fill a lineup: need {gaps} (injured/suspended players don't count).")
        else:
            lines.append("⚠️ Not enough fit players to fill a legal lineup right now.")
    else:
        lines.append(f"🔄 Recommended lineup: {data.formation}")
        lines.append("  " + ", ".join(_name(p) for p in data.starters))
    lines.append("")

    def _plain_entry(p: dict, headline: str, with_deadline: bool = False) -> str:
        block = f"  • {_name(p)} — {headline}\n     {_trend_label(p)}"
        if with_deadline:
            block += f"\n     {_deadline_label(p)}"
        return block

    if data.instant_sells or data.list_sells:
        lines.append("📉 Sell advice:")
        for p in data.instant_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            lines.append(_plain_entry(p, f"instant-sell to Kickbase, ~💰{_compact(p.get('mv', 0))} (🎯{urgency}, 0 pts)"))
        for p in data.list_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            lines.append(_plain_entry(p, f"list on market at ~💰{_compact(p.get('mv', 0))} (🎯{urgency})"))
    else:
        lines.append("📉 Sell advice: nothing worth selling right now.")
    lines.append("")

    if data.buys:
        buys_kb, buys_mgr = _split_by_seller(data.buys)
        if buys_kb:
            lines.append("📈 Buy advice - from Kickbase (affordable, within squad room):")
            for p in buys_kb:
                score = data.buy_scores.get(p["i"], 0)
                lines.append(_plain_entry(p, f"bid 💰{_compact(p.get('prc', 0))} (🎯{score})", with_deadline=True))
            lines.append("")
        if buys_mgr:
            lines.append("🧑 Buy advice - from other managers (affordable, within squad room):")
            for p in buys_mgr:
                score = data.buy_scores.get(p["i"], 0)
                headline = f"bid 💰{_compact(p.get('prc', 0))} from 👤{seller_name(p)} (🎯{score})"
                lines.append(_plain_entry(p, headline, with_deadline=True))
            lines.append("")
    else:
        lines.append("📈 Buy advice: nothing affordable stands out right now.")
        lines.append("")

    if data.watchlist:
        watch_kb, watch_mgr = _split_by_seller(data.watchlist)
        if watch_kb:
            lines.append("🔥 Also rising from Kickbase, but out of budget/squad room right now:")
            for p in watch_kb:
                score = data.watch_scores.get(p["i"], 0)
                headline = f"💰{_compact(p.get('prc', 0))} (🎯{score}, ⚽{p.get('ap', 0)} pts)"
                lines.append(_plain_entry(p, headline, with_deadline=True))
            lines.append("")
        if watch_mgr:
            lines.append("🔥🧑 Also rising from other managers, but out of budget/squad room right now:")
            for p in watch_mgr:
                score = data.watch_scores.get(p["i"], 0)
                headline = f"💰{_compact(p.get('prc', 0))} from 👤{seller_name(p)} (🎯{score}, ⚽{p.get('ap', 0)} pts)"
                lines.append(_plain_entry(p, headline, with_deadline=True))

    return "\n".join(lines)


def render_telegram(league_name: str, data: BriefingData) -> dict:
    """Rich Telegram content: a featured player photo (the strongest buy
    candidate, or a sell candidate if there's nothing to buy) with an HTML
    caption, the full digest as HTML text, and a link-button keyboard
    (Transfermarkt profile search) for the players mentioned - see
    telegram.py for why these are link buttons, not action buttons.

    Returns {"photo_url": str|None, "caption": str, "text": str, "keyboard": dict}.
    """
    e = html.escape

    featured = (data.buys or data.list_sells or data.instant_sells or [None])[0]
    photo_url = _player_photo_url(featured) if featured else None
    if featured:
        kind = "📈 Top buy signal" if featured in data.buys else "📉 Top sell signal"
        score = data.buy_scores.get(featured["i"]) if featured in data.buys else data.sell_scores.get(featured["i"])
        is_buy = featured in data.buys
        seller_line = f"👤 Seller: {e(seller_name(featured))}\n" if is_buy else ""
        deadline_line = f"{e(_deadline_label(featured))}\n" if is_buy else ""
        caption = (
            f"<b>{kind}: {e(_name(featured))}</b>\n{seller_line}{deadline_line}"
            f"{e(_trend_label(featured))}\n🎯 Score {score}"
        )
    else:
        caption = f"<b>{e(league_name)}</b>\nNo standout buy or sell signal right now."

    lines = [
        f"<b>{e(league_name)}</b>",
        f"💰 {e(_compact(data.budget))}   👥 {data.squad_size}/{data.max_squad_size}",
        "",
    ]

    if data.formation is None:
        if data.shortfall:
            def _label(pos: int, n: int) -> str:
                name = strategy.POSITION_NAMES[pos]
                return f"{n} more fit {name if n != 1 else name[:-1]}"
            gaps = ", ".join(_label(pos, n) for pos, n in data.shortfall.items())
            lines.append(f"⚠️ <b>Can't fill a lineup</b> — need {e(gaps)}")
        else:
            lines.append("⚠️ <b>Not enough fit players</b> for a legal lineup right now.")
    else:
        lines.append(f"🔄 <b>Lineup: {e(data.formation)}</b>")
        lines.append(e(", ".join(_name(p) for p in data.starters)))
    lines.append("")

    def _entry(p: dict, headline: str, with_deadline: bool = False) -> str:
        block = f"• <b>{e(_name(p))}</b> — {headline}\n   {e(_trend_label(p))}"
        if with_deadline:
            block += f"\n   {e(_deadline_label(p))}"
        return block

    if data.instant_sells or data.list_sells:
        lines.append("📉 <b>Sell advice</b>")
        for p in data.instant_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            lines.append(_entry(p, f"instant-sell ~💰{_compact(p.get('mv', 0))} (🎯{urgency}, 0 pts)"))
        for p in data.list_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            lines.append(_entry(p, f"list at ~💰{_compact(p.get('mv', 0))} (🎯{urgency})"))
    else:
        lines.append("📉 <b>Sell advice</b> — nothing worth selling right now.")
    lines.append("")

    if data.buys:
        buys_kb, buys_mgr = _split_by_seller(data.buys)
        if buys_kb:
            lines.append("📈 <b>Buy advice — from Kickbase</b>")
            for p in buys_kb:
                score = data.buy_scores.get(p["i"], 0)
                lines.append(_entry(p, f"bid 💰{_compact(p.get('prc', 0))} (🎯{score})", with_deadline=True))
            lines.append("")
        if buys_mgr:
            lines.append("🧑 <b>Buy advice — from other managers</b>")
            for p in buys_mgr:
                score = data.buy_scores.get(p["i"], 0)
                headline = f"bid 💰{_compact(p.get('prc', 0))} from 👤{e(seller_name(p))} (🎯{score})"
                lines.append(_entry(p, headline, with_deadline=True))
            lines.append("")
    else:
        lines.append("📈 <b>Buy advice</b> — nothing affordable stands out right now.")
        lines.append("")

    if data.watchlist:
        watch_kb, watch_mgr = _split_by_seller(data.watchlist)
        if watch_kb:
            lines.append("🔥 <b>Also rising — from Kickbase</b> (out of budget/room)")
            for p in watch_kb:
                score = data.watch_scores.get(p["i"], 0)
                headline = f"💰{_compact(p.get('prc', 0))} (🎯{score}, ⚽{p.get('ap', 0)} pts)"
                lines.append(_entry(p, headline, with_deadline=True))
            lines.append("")
        if watch_mgr:
            lines.append("🔥🧑 <b>Also rising — from other managers</b> (out of budget/room)")
            for p in watch_mgr:
                score = data.watch_scores.get(p["i"], 0)
                headline = f"💰{_compact(p.get('prc', 0))} from 👤{e(seller_name(p))} (🎯{score}, ⚽{p.get('ap', 0)} pts)"
                lines.append(_entry(p, headline, with_deadline=True))
            lines.append("")

    lines.append(
        "<i>Score = 0-100 relative ranking (7d trend × points), not a currency amount. "
        "24h/7d = real observed value change. next-day est. = naive trend extrapolation, "
        "not a forecast.</i>"
    )
    text = "\n".join(lines)

    button_players = (data.buys + data.list_sells + data.instant_sells)[:KEYBOARD_LIMIT]
    keyboard_rows = [[(f"🔍 {_name(p)}", _transfermarkt_url(p))] for p in button_players]

    return {
        "photo_url": photo_url,
        "caption": caption,
        "text": text,
        "keyboard": telegram.inline_keyboard(keyboard_rows) if button_players else None,
    }
