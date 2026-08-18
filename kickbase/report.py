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
TOP_PERFORMERS_LIMIT = 5
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
    top_performers: list[dict]
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


def _signed_pct(n: float) -> str:
    return f"{'+' if n >= 0 else ''}{n:.0f}%"


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

    # Manager-listed players (see seller_name()) are excluded from every
    # advice section below: buying from another manager is a different,
    # negotiation-flavored decision (they set the price, there's no
    # closing deadline) than buying from the computer market, and mixing
    # the two into one ranked list made the advice harder to act on than
    # just leaving them out.
    kickbase_market = [m for m in market if not m.get("u")]

    instant_sells, list_sells = strategy.sell_candidates(bench, MIN_SQUAD_SIZE, len(squad))
    buys = strategy.buy_candidates(kickbase_market, budget, len(squad), max_squad_size)
    bought_ids = {p.get("i") for p in buys}
    watchlist = sorted(
        (m for m in kickbase_market if m.get("mvt") == strategy.RISING and m.get("i") not in bought_ids),
        key=predict.momentum_score,
        reverse=True,
    )[:MOVERS_LIMIT]

    # Standout talent by output (avg points, then total points) - ranked
    # independently of buys/watchlist above (which are trend- and
    # budget-gated), so a proven performer (e.g. an established MVP) always
    # surfaces here even when their value trend is flat/falling, the price
    # is out of budget, or they already appear in one of those other
    # sections for an unrelated reason.
    top_performers = sorted(
        (m for m in kickbase_market if (m.get("ap") or 0) > 0),
        key=lambda p: (p.get("ap") or 0, p.get("p") or 0),
        reverse=True,
    )[:TOP_PERFORMERS_LIMIT]

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
        top_performers=top_performers,
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
        lines.append("📈 Buy advice (affordable):")
        for p in data.buys:
            score = data.buy_scores.get(p["i"], 0)
            stats = [f"💰 bid {_compact(p.get('prc', 0))}", f"🎯 score {score}"]
            lines.append(_plain_entry(p, stats, with_deadline=True))
        lines.append("")
    else:
        lines.append("📈 Buy advice: nothing affordable stands out right now.")
        lines.append("")

    if data.top_performers:
        lines.append("⭐ Top performers on the market:")
        for p in data.top_performers:
            afford = (p.get("prc") or 0) <= data.budget
            stats = [
                f"⚽ {p.get('ap', 0)} avg pts (Σ {p.get('p', 0)})",
                f"💰 bid {_compact(p.get('prc', 0))}" + ("" if afford else " (over budget)"),
            ]
            lines.append(_plain_entry(p, stats, with_deadline=True))
        lines.append("")

    if data.watchlist:
        lines.append("🔥 Rising, unaffordable:")
        for p in data.watchlist:
            score = data.watch_scores.get(p["i"], 0)
            stats = [f"💰 {_compact(p.get('prc', 0))}", f"🎯 score {score}", f"⚽ {p.get('ap', 0)} pts"]
            lines.append(_plain_entry(p, stats, with_deadline=True))

    return "\n".join(lines)


def render_new_listing_alert(player: dict) -> dict:
    """A standalone Telegram card for one market listing that just
    appeared - fired independently of the periodic brief (see cli.py's
    `alert` command), so it needs its own compact layout rather than
    reusing render_telegram's full-digest one. Same visual language as
    that digest's featured photo card: a photo, a short HTML caption, and
    one Transfermarkt link button.

    Returns {"photo_url": str|None, "caption": str, "keyboard": dict}.
    """
    e = html.escape
    caption_lines = [
        f"🆕 <b>New listing: {e(_name(player))}</b>",
        e(_deadline_label(player)),
        f"💰 bid {e(_compact(player.get('prc', 0)))}",
        f"⚽ {player.get('ap', 0)} avg pts",
    ]
    caption_lines.extend(e(ln) for ln in _trend_lines(player))
    return {
        "photo_url": _player_photo_url(player),
        "caption": "\n".join(caption_lines),
        "keyboard": telegram.inline_keyboard([[(f"🔍 {_name(player)}", _transfermarkt_url(player))]]),
    }


def render_squad_value_update(
    league_name: str, squad: list[dict], budget: float, competitors: list[dict] | None = None
) -> str:
    """Daily squad market-value recap: every owned player's 24h change
    plus the total gain/loss across the whole squad. Meant to fire once a
    day right after Kickbase's own daily value recalculation (see cli.py's
    `squad-value` command and its dedicated cron), separate from `brief`'s
    advice digest - this is purely "what did today's update do to what I
    already own," sorted best mover first so a bad day doesn't bury the
    one bright spot at the bottom.

    Also shows budget (cash on hand) and net worth (budget + squad value)
    alongside the squad value itself, since "how well am I doing overall"
    is budget-plus-players, not just players - a big sale can grow the
    budget line while shrinking the squad-value line, and neither one
    alone tells the full story.

    competitors, if given, is a list of {"name", "total_value",
    "total_delta"} (total_delta may be None if none of that manager's
    players had value history yet) - one entry per other league member,
    from cli.py's per-manager squad fetch (GET
    /v4/leagues/{leagueId}/managers/{managerId}/squad).
    """
    e = html.escape
    with_delta = [p for p in squad if p.get("d1") is not None]
    without_delta = [p for p in squad if p.get("d1") is None]
    total_delta = sum(p.get("d1", 0) for p in with_delta)
    total_value = sum(p.get("mv", 0) or 0 for p in squad)
    net_worth = budget + total_value

    lines = [
        f"📊 <b>Daily Value Update — {e(league_name)}</b>",
        "",
        f"{'📈' if total_delta >= 0 else '📉'} <b>Squad total: {e(_signed(total_delta))} today</b>",
        f"💰 Budget: {e(_compact(budget))}",
        f"👥 Squad value: {e(_compact(total_value))}",
        f"🏦 Total value (budget + squad): {e(_compact(net_worth))}",
        "",
    ]
    with_delta.sort(key=lambda p: p.get("d1", 0), reverse=True)
    for p in with_delta:
        d1 = p.get("d1", 0)
        icon = "🟢" if d1 > 0 else "🔴" if d1 < 0 else "⚪"
        lines.append(f"{icon} <b>{e(_name(p))}</b>  {e(_signed(d1))}")
    if without_delta:
        lines.append("")
        lines.append("ℹ️ No value history yet: " + ", ".join(e(_name(p)) for p in without_delta))

    if competitors:
        lines.append("")
        lines.append("🏆 <b>Competitors (squad value today)</b>")
        ranked = sorted(
            competitors,
            key=lambda c: c["total_delta"] if c["total_delta"] is not None else float("-inf"),
            reverse=True,
        )
        for comp in ranked:
            delta = comp["total_delta"]
            if delta is None:
                icon, delta_str = "⚪", "no data yet"
            else:
                icon = "🟢" if delta > 0 else "🔴" if delta < 0 else "⚪"
                delta_str = e(_signed(delta))
            lines.append(f"{icon} <b>{e(comp['name'])}</b>")
            lines.append(f"   👥 squad {e(_compact(comp['total_value']))} ({delta_str})")
            budget = comp.get("estimated_budget")
            if budget is not None:
                total = budget + comp["total_value"]
                lines.append(f"   💰 budget ≈{e(_compact(budget))}")
                lines.append(f"   🏦 total ≈{e(_compact(total))}")
        lines.append("")
        lines.append("<i>ℹ️ ≈ = reconstructed estimate, not their real number</i>")
        lines.append("<i>(likely a lower bound - private bonuses/rewards aren't counted)</i>")

    return "\n".join(lines)


def _spending_label(avg_pct: float | None) -> str:
    """Qualitative read on a manager's average premium over current
    market value across their computer-market buys. Thresholds are a
    starting guess (not tuned against real behavior yet, since the league
    is only a few days old) - 3%/15% split "basically paid asking price"
    from "paid noticeably more than needed" from "consistently overspends."
    """
    if avg_pct is None:
        return "ℹ️ no computer-market buys yet"
    if avg_pct <= 3:
        return f"🎯 pays close to asking price ({_signed_pct(avg_pct)} avg)"
    if avg_pct <= 15:
        return f"💵 pays a moderate premium ({_signed_pct(avg_pct)} avg)"
    return f"🔥 tends to overspend ({_signed_pct(avg_pct)} avg)"


def render_spending_analysis(league_name: str, profiles: list[dict]) -> str:
    """Compares what each league member actually paid for a player
    against that player's *current* market value - a close proxy for
    value-at-purchase here since every transfer in a brand-new league is
    only days old, not a general-purpose historical reconstruction - to
    surface bidding behavior that Kickbase's sealed-bid design otherwise
    hides completely (see README's "sealed bid" findings). This is only
    possible retroactively, once a transfer has completed
    (client.get_manager_transfers()), never for a listing that's still open.

    profiles: list of {"name", "computer_buys": [{"player_name", "trp",
    "mv", "premium_pct"}], "manager_buys": [...same shape plus "othnm"]}
    from cli._build_spending_profiles(). Only computer-market buys feed
    the per-manager average - manager-to-manager trades are shown
    individually instead, since there are usually too few per manager for
    an average to mean anything, and the price there reflects a human
    negotiation, not beating a sealed-bid field.
    """
    e = html.escape
    lines = [
        f"💸 <b>Transfer Spending Analysis — {e(league_name)}</b>",
        "ℹ️ Premium = price paid vs. that player's current market value",
        "",
    ]

    def _avg(profile: dict) -> float:
        buys = profile["computer_buys"]
        return sum(b["premium_pct"] for b in buys) / len(buys) if buys else float("-inf")

    for profile in sorted(profiles, key=_avg, reverse=True):
        buys = profile["computer_buys"]
        avg = sum(b["premium_pct"] for b in buys) / len(buys) if buys else None
        count = f"{len(buys)} computer buy{'s' if len(buys) != 1 else ''}"
        lines.append(f"{_spending_label(avg)} — <b>{e(profile['name'])}</b> ({count})")

    manager_trades = [(p["name"], b) for p in profiles for b in p["manager_buys"]]
    if manager_trades:
        lines.append("")
        lines.append("🤝 <b>Manager-to-manager trades</b>")
        for name, b in sorted(manager_trades, key=lambda x: abs(x[1]["premium_pct"]), reverse=True):
            lines.append(
                f"{e(name)} paid {e(_signed_pct(b['premium_pct']))} vs. value for {e(b['player_name'])} "
                f"({e(_compact(b['trp']))} vs. {e(_compact(b['mv']))}) — bought from {e(b['othnm'])}"
            )

    return "\n".join(lines)


_BID_STATUS_ICONS = {"placed": "📤", "updated": "🔄", "won": "✅", "lost": "❌"}
_BID_STATUS_LABELS = {"placed": "Bid placed", "updated": "Bid updated", "won": "Bid won", "lost": "Bid lost"}


def render_bid_status_alert(
    player: dict, status: str, bid_amount: float | None, previous_amount: float | None = None
) -> dict:
    """A standalone Telegram card for something happening to *your own*
    bid on a listing - placed, revised, won (the listing closed and the
    player showed up in your squad), or lost (the listing closed and it
    didn't). Fired from cli.py's `alert` command, which tracks your active
    offers across polls via the market's own uop/uoid fields (see README's
    "sealed bid" section - these only ever reflect your own offer, which
    is exactly what this needs).
    """
    e = html.escape
    caption_lines = [f"{_BID_STATUS_ICONS[status]} <b>{_BID_STATUS_LABELS[status]}: {e(_name(player))}</b>"]
    if bid_amount is not None:
        amount_line = f"💰 {e(_compact(bid_amount))}"
        if status == "updated" and previous_amount is not None:
            amount_line += f" (was {e(_compact(previous_amount))})"
        caption_lines.append(amount_line)
    if status in ("placed", "updated"):
        caption_lines.append(e(_deadline_label(player)))
    caption_lines.extend(e(ln) for ln in _trend_lines(player))
    return {
        "photo_url": _player_photo_url(player),
        "caption": "\n".join(caption_lines),
        "keyboard": telegram.inline_keyboard([[(f"🔍 {_name(player)}", _transfermarkt_url(player))]]),
    }


def render_telegram(league_name: str, data: BriefingData) -> dict:
    """Rich Telegram content: a featured player photo (the strongest buy
    candidate, or a sell candidate if there's nothing to buy) with an HTML
    caption, the full digest as HTML text, and a link-button keyboard
    (Transfermarkt profile search) for the players mentioned - see
    telegram.py for why these are link buttons, not action buttons.

    Returns {"photo_url": str|None, "caption": str, "text": str, "keyboard": dict}.
    """
    e = html.escape

    featured = (data.buys or data.top_performers or data.list_sells or data.instant_sells or [None])[0]
    photo_url = _player_photo_url(featured) if featured else None
    if featured:
        is_market_item = featured in data.buys or featured in data.top_performers
        if featured in data.buys:
            kind, score = "📈 Top buy signal", data.buy_scores.get(featured["i"])
        elif featured in data.top_performers:
            kind, score = "⭐ Top performer", None
        else:
            kind, score = "📉 Top sell signal", data.sell_scores.get(featured["i"])
        caption_lines = [f"<b>{kind}: {e(_name(featured))}</b>"]
        if is_market_item:
            caption_lines.append(e(_deadline_label(featured)))
        caption_lines.extend(e(ln) for ln in _trend_lines(featured))
        caption_lines.append(f"🎯 Score {score}" if score is not None else f"⚽ {featured.get('ap', 0)} avg pts")
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
        lines.append("📈 <b>Buy advice</b> (affordable)")
        for p in data.buys:
            score = data.buy_scores.get(p["i"], 0)
            stats = [f"💰 bid {_compact(p.get('prc', 0))}", f"🎯 score {score}"]
            lines.append(_entry(p, stats, with_deadline=True))
        lines.append("")
    else:
        lines.append("📈 <b>Buy advice</b> — nothing affordable stands out right now.")
        lines.append("")

    if data.top_performers:
        lines.append("⭐ <b>Top performers on the market</b>")
        for p in data.top_performers:
            afford = (p.get("prc") or 0) <= data.budget
            stats = [
                f"⚽ {p.get('ap', 0)} avg pts (Σ {p.get('p', 0)})",
                f"💰 bid {_compact(p.get('prc', 0))}" + ("" if afford else " (over budget)"),
            ]
            lines.append(_entry(p, stats, with_deadline=True))
        lines.append("")

    if data.watchlist:
        lines.append("🔥 <b>Rising, unaffordable</b>")
        for p in data.watchlist:
            score = data.watch_scores.get(p["i"], 0)
            stats = [f"💰 {_compact(p.get('prc', 0))}", f"🎯 score {score}", f"⚽ {p.get('ap', 0)} pts"]
            lines.append(_entry(p, stats, with_deadline=True))
        lines.append("")

    lines.extend(f"<i>{e(ln)}</i>" for ln in LEGEND_LINES)
    text = "\n".join(lines)

    button_players = (data.buys + data.top_performers + data.list_sells + data.instant_sells)[:KEYBOARD_LIMIT]
    keyboard_rows = [[(f"🔍 {_name(p)}", _transfermarkt_url(p))] for p in button_players]

    return {
        "photo_url": photo_url,
        "caption": caption,
        "text": text,
        "keyboard": telegram.inline_keyboard(keyboard_rows) if button_players else None,
    }
