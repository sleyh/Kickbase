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


_POSITION_ICONS = {
    strategy.GOALKEEPER: "🧤",
    strategy.DEFENDER: "🛡️",
    strategy.MIDFIELDER: "⚙️",
    strategy.FORWARD: "⚡",
}


def _lineup_lines(starters: list[dict]) -> list[str]:
    """Starters grouped by position, one short line per position, instead
    of one long comma-joined line - an 11-name line reliably wraps
    mid-name on a phone."""
    by_pos: dict[int, list[str]] = {}
    for p in starters:
        by_pos.setdefault(p.get("pos"), []).append(_name(p))
    return [f"{_POSITION_ICONS.get(pos, '•')} {', '.join(names)}" for pos, names in by_pos.items()]


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


def _trend_lines(player: dict) -> list[str]:
    """Each observed/predicted market-value figure (see
    predict.history_deltas, attached by cli.py's _enrich_with_history
    before this is ever called) as its own short line, rather than one
    long combined line - Telegram word-wraps a long line wherever it
    happens to run out of width, which can land mid-phrase; keeping each
    stat on its own short line means there's nothing left for it to wrap.
    """
    d1, d7 = player.get("d1"), player.get("d7")
    if d1 is None and d7 is None:
        return ["📊 no value history yet"]
    lines = []
    if d1 is not None:
        lines.append(f"📊 24h {_signed(d1)}")
    if d7 is not None:
        lines.append(f"📊 7d {_signed(d7)}")
    projection = predict.naive_projection(player)
    if projection is not None:
        lines.append(f"🔮 next-day est. {_signed(projection)}")
    return lines


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


LEGEND_LINES = [
    "ℹ️ 🎯 score = 0-100 rank, not a currency amount",
    "📊 24h/7d = real observed value change",
    "🔮 next-day est. = naive guess, not a forecast",
]


def render_text(league_name: str, data: BriefingData) -> str:
    lines = [
        f"*{league_name}*",
        f"Budget: {_compact(data.budget)}  |  Squad: {data.squad_size}/{data.max_squad_size}",
        *LEGEND_LINES,
        "",
    ]

    if data.formation is None:
        if data.shortfall:
            def _label(pos: int, n: int) -> str:
                name = strategy.POSITION_NAMES[pos]
                return f"{n} more fit {name if n != 1 else name[:-1]}"
            gaps = ", ".join(_label(pos, n) for pos, n in data.shortfall.items())
            lines.append("⚠️ Can't fill a lineup - injured/suspended don't count. Need:")
            lines.append(f"   {gaps}")
        else:
            lines.append("⚠️ Not enough fit players to fill a legal lineup right now.")
    else:
        lines.append(f"🔄 Recommended lineup: {data.formation}")
        lines.extend(f"  {ln}" for ln in _lineup_lines(data.starters))
    lines.append("")

    def _plain_entry(p: dict, stat_lines: list[str], with_deadline: bool = False) -> str:
        """One player as a bullet with every stat on its own short,
        deliberate line - see _trend_lines() for why."""
        body_lines = stat_lines + _trend_lines(p)
        if with_deadline:
            body_lines.append(_deadline_label(p))
        indented = "\n".join(f"     {ln}" for ln in body_lines)
        return f"  • {_name(p)}\n{indented}"

    if data.instant_sells or data.list_sells:
        lines.append("📉 Sell advice:")
        for p in data.instant_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            stats = [f"💰 instant-sell to Kickbase ~{_compact(p.get('mv', 0))} (0 pts)", f"🎯 urgency {urgency}"]
            lines.append(_plain_entry(p, stats))
        for p in data.list_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            stats = [f"💰 list on market ~{_compact(p.get('mv', 0))}", f"🎯 urgency {urgency}"]
            lines.append(_plain_entry(p, stats))
    else:
        lines.append("📉 Sell advice: nothing worth selling right now.")
    lines.append("")

    if data.buys:
        buys_kb, buys_mgr = _split_by_seller(data.buys)
        if buys_kb:
            lines.append("📈 Buy advice — Kickbase (affordable):")
            for p in buys_kb:
                score = data.buy_scores.get(p["i"], 0)
                stats = [f"💰 bid {_compact(p.get('prc', 0))}", f"🎯 score {score}"]
                lines.append(_plain_entry(p, stats, with_deadline=True))
            lines.append("")
        if buys_mgr:
            lines.append("🧑 Buy advice — other managers (affordable):")
            for p in buys_mgr:
                score = data.buy_scores.get(p["i"], 0)
                stats = [f"💰 bid {_compact(p.get('prc', 0))}", f"🎯 score {score}", f"👤 {seller_name(p)}"]
                lines.append(_plain_entry(p, stats, with_deadline=True))
            lines.append("")
    else:
        lines.append("📈 Buy advice: nothing affordable stands out right now.")
        lines.append("")

    if data.watchlist:
        watch_kb, watch_mgr = _split_by_seller(data.watchlist)
        if watch_kb:
            lines.append("🔥 Rising, unaffordable — Kickbase:")
            for p in watch_kb:
                score = data.watch_scores.get(p["i"], 0)
                stats = [f"💰 {_compact(p.get('prc', 0))}", f"🎯 score {score}", f"⚽ {p.get('ap', 0)} pts"]
                lines.append(_plain_entry(p, stats, with_deadline=True))
            lines.append("")
        if watch_mgr:
            lines.append("🔥🧑 Rising, unaffordable — other managers:")
            for p in watch_mgr:
                score = data.watch_scores.get(p["i"], 0)
                stats = [
                    f"💰 {_compact(p.get('prc', 0))}", f"🎯 score {score}",
                    f"⚽ {p.get('ap', 0)} pts", f"👤 {seller_name(p)}",
                ]
                lines.append(_plain_entry(p, stats, with_deadline=True))

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
        caption_lines = [f"<b>{kind}: {e(_name(featured))}</b>"]
        if is_buy:
            caption_lines.append(f"👤 {e(seller_name(featured))}")
            caption_lines.append(e(_deadline_label(featured)))
        caption_lines.extend(e(ln) for ln in _trend_lines(featured))
        caption_lines.append(f"🎯 Score {score}")
        caption = "\n".join(caption_lines)
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
            lines.append("⚠️ <b>Can't fill a lineup</b>")
            lines.append(f"   need {e(gaps)}")
        else:
            lines.append("⚠️ <b>Not enough fit players</b> for a legal lineup right now.")
    else:
        lines.append(f"🔄 <b>Lineup: {e(data.formation)}</b>")
        lines.extend(e(ln) for ln in _lineup_lines(data.starters))
    lines.append("")

    def _entry(p: dict, stat_lines: list[str], with_deadline: bool = False) -> str:
        """One player as a bold-name bullet with every stat on its own
        short, deliberate line - see _trend_lines() for why."""
        body_lines = stat_lines + [e(ln) for ln in _trend_lines(p)]
        if with_deadline:
            body_lines.append(e(_deadline_label(p)))
        indented = "\n".join(f"   {ln}" for ln in body_lines)
        return f"• <b>{e(_name(p))}</b>\n{indented}"

    if data.instant_sells or data.list_sells:
        lines.append("📉 <b>Sell advice</b>")
        for p in data.instant_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            stats = [f"💰 instant-sell ~{_compact(p.get('mv', 0))} (0 pts)", f"🎯 urgency {urgency}"]
            lines.append(_entry(p, stats))
        for p in data.list_sells:
            urgency = data.sell_scores.get(p["i"], 0)
            stats = [f"💰 list at ~{_compact(p.get('mv', 0))}", f"🎯 urgency {urgency}"]
            lines.append(_entry(p, stats))
    else:
        lines.append("📉 <b>Sell advice</b> — nothing worth selling right now.")
    lines.append("")

    if data.buys:
        buys_kb, buys_mgr = _split_by_seller(data.buys)
        if buys_kb:
            lines.append("📈 <b>Buy advice — Kickbase</b> (affordable)")
            for p in buys_kb:
                score = data.buy_scores.get(p["i"], 0)
                stats = [f"💰 bid {_compact(p.get('prc', 0))}", f"🎯 score {score}"]
                lines.append(_entry(p, stats, with_deadline=True))
            lines.append("")
        if buys_mgr:
            lines.append("🧑 <b>Buy advice — other managers</b> (affordable)")
            for p in buys_mgr:
                score = data.buy_scores.get(p["i"], 0)
                stats = [f"💰 bid {_compact(p.get('prc', 0))}", f"🎯 score {score}", f"👤 {e(seller_name(p))}"]
                lines.append(_entry(p, stats, with_deadline=True))
            lines.append("")
    else:
        lines.append("📈 <b>Buy advice</b> — nothing affordable stands out right now.")
        lines.append("")

    if data.watchlist:
        watch_kb, watch_mgr = _split_by_seller(data.watchlist)
        if watch_kb:
            lines.append("🔥 <b>Rising, unaffordable — Kickbase</b>")
            for p in watch_kb:
                score = data.watch_scores.get(p["i"], 0)
                stats = [f"💰 {_compact(p.get('prc', 0))}", f"🎯 score {score}", f"⚽ {p.get('ap', 0)} pts"]
                lines.append(_entry(p, stats, with_deadline=True))
            lines.append("")
        if watch_mgr:
            lines.append("🔥🧑 <b>Rising, unaffordable — other managers</b>")
            for p in watch_mgr:
                score = data.watch_scores.get(p["i"], 0)
                stats = [
                    f"💰 {_compact(p.get('prc', 0))}", f"🎯 score {score}",
                    f"⚽ {p.get('ap', 0)} pts", f"👤 {e(seller_name(p))}",
                ]
                lines.append(_entry(p, stats, with_deadline=True))
            lines.append("")

    lines.extend(f"<i>{e(ln)}</i>" for ln in LEGEND_LINES)
    text = "\n".join(lines)

    button_players = (data.buys + data.list_sells + data.instant_sells)[:KEYBOARD_LIMIT]
    keyboard_rows = [[(f"🔍 {_name(p)}", _transfermarkt_url(p))] for p in button_players]

    return {
        "photo_url": photo_url,
        "caption": caption,
        "text": text,
        "keyboard": telegram.inline_keyboard(keyboard_rows) if button_players else None,
    }
