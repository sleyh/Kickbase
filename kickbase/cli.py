"""CLI for polling the Kickbase transfer market.

Usage:
    python -m kickbase.cli market
    python -m kickbase.cli market --raw
    python -m kickbase.cli watch --interval 300
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from . import achievements, predict, report, strategy, telegram
from .client import KickbaseClient, KickbaseError

STATE_DIR = Path.home() / ".cache" / "kickbase"
MIN_SQUAD_SIZE = 11  # can't field a legal lineup with fewer players than this

# Confirmed against a live /v4/leagues/{leagueId}/market response (the
# upstream doc's own example was captured with an empty market, so these
# were originally guesses). Fallbacks are kept in case Kickbase varies
# the payload shape across accounts/leagues.
NAME_FIRST_KEYS = ("fn",)
NAME_LAST_KEYS = ("n", "ln")
NAME_FALLBACK_KEYS = ("name",)
TEAM_KEYS = ("tn", "tid")  # tn (team name) isn't present in the market payload; tid (team id) is
PRICE_KEYS = ("prc", "price")
MARKET_VALUE_KEYS = ("mv",)
EXPIRY_KEYS = ("exs", "exd", "expiry", "dt")
BID_COUNT_KEYS = ("ofc", "no", "noo", "ofn", "numOffers", "offerCount", "bids", "nob")
OFFER_LIST_KEYS = ("ofs",)  # per-offer detail: [{"unm": bidder name, "uop": offer amount, ...}]
OFFER_AMOUNT_KEYS = ("uop", "price", "amount")
OFFER_BIDDER_KEYS = ("unm", "name")
ITEM_ID_KEYS = ("i", "id", "pi")


def _first_present(item: dict, keys: tuple[str, ...]):
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def _top_bid(item: dict) -> tuple[int | float | None, str | None]:
    """Highest offer amount + bidder name from the item's offer list, if any."""
    offers = _first_present(item, OFFER_LIST_KEYS)
    if not offers:
        return None, None
    top = max(offers, key=lambda o: _first_present(o, OFFER_AMOUNT_KEYS) or 0)
    return _first_present(top, OFFER_AMOUNT_KEYS), _first_present(top, OFFER_BIDDER_KEYS)


def _player_name(item: dict) -> str:
    first = _first_present(item, NAME_FIRST_KEYS)
    last = _first_present(item, NAME_LAST_KEYS)
    if first or last:
        return " ".join(p for p in (first, last) if p)
    return str(_first_present(item, NAME_FALLBACK_KEYS) or "?")


def _item_id(item: dict) -> str:
    return str(_first_present(item, ITEM_ID_KEYS) or "?")


def _load_credentials(args: argparse.Namespace) -> tuple[str, str]:
    email = args.email or os.environ.get("KICKBASE_EMAIL")
    password = args.password or os.environ.get("KICKBASE_PASSWORD")
    if not email or not password:
        sys.exit(
            "Missing credentials: set KICKBASE_EMAIL / KICKBASE_PASSWORD "
            "(env vars or a .env file) or pass --email/--password."
        )
    return email, password


def _resolve_league_id(client: KickbaseClient, args: argparse.Namespace) -> str:
    league_id = args.league_id or os.environ.get("KICKBASE_LEAGUE_ID")
    if league_id:
        return league_id
    if len(client.leagues) == 1:
        return client.leagues[0]["id"]
    if not client.leagues:
        sys.exit("No leagues found on this account.")
    options = ", ".join(f"{l['id']} ({l.get('name', '?')})" for l in client.leagues)
    sys.exit(f"Multiple leagues found, pass --league-id: {options}")


def _print_market_table(items: list[dict]) -> None:
    if not items:
        print("Transfer market is empty.")
        return
    rows = []
    for item in items:
        bids = _first_present(item, BID_COUNT_KEYS)
        bid_amount, bidder = _top_bid(item)
        top_bid = f"{bid_amount} ({bidder})" if bid_amount is not None else ""
        rows.append((
            _item_id(item),
            _player_name(item),
            str(_first_present(item, TEAM_KEYS) or ""),
            report.seller_name(item),
            str(_first_present(item, PRICE_KEYS) or ""),
            str(_first_present(item, MARKET_VALUE_KEYS) or ""),
            str(_first_present(item, EXPIRY_KEYS) or ""),
            str(bids) if bids is not None else "?",
            top_bid,
        ))
    # "Bids"/"Your Offer": Kickbase only ever reports your own offer on a
    # listing, never competing bids from other managers - see README.
    headers = ("ID", "Player", "Team", "Seller", "Price", "Market Value", "Expires", "Your Bid?", "Your Offer")
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*("-" * w for w in widths)))
    for row in rows:
        print(fmt.format(*row))
    if all(r[-2] == "?" for r in rows):
        print(
            "\nNote: no known bid-count field matched on any item. "
            "Run with --raw to inspect the actual JSON and identify the "
            "right field for your account (see BID_COUNT_KEYS in cli.py)."
        )


def cmd_market(args: argparse.Namespace) -> None:
    email, password = _load_credentials(args)
    client = KickbaseClient(email, password)
    client.login()
    league_id = _resolve_league_id(client, args)
    market = client.get_market(league_id)
    if args.raw:
        print(json.dumps(market, indent=2, ensure_ascii=False))
        return
    _print_market_table(market.get("it", []))


def _state_path(league_id: str) -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / f"market_{league_id}.json"


def _alert_state_path(league_id: str) -> Path:
    """Separate from watch's market_<leagueId>.json - watch is an
    interactive/manual command and alert is meant for a scheduled cron, so
    keeping their "last seen" snapshots apart means running one never
    resets the other's baseline.
    """
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / f"alert_seen_{league_id}.json"


def _my_bids_state_path(league_id: str) -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / f"my_bids_{league_id}.json"


def _send_bid_alert(
    player: dict, status: str, bid_amount, previous_amount,
    telegram_enabled: bool, token: str | None, chat_id: str | None,
) -> None:
    alert = report.render_bid_status_alert(player, status, bid_amount, previous_amount)
    if telegram_enabled:
        if alert["photo_url"]:
            telegram.send_photo(token, chat_id, alert["photo_url"], alert["caption"], alert["keyboard"])
        else:
            telegram.send_message(token, chat_id, alert["caption"], alert["keyboard"])


def _track_my_bids(
    client: KickbaseClient, league_id: str, league_name: str, market_items: list[dict],
    telegram_enabled: bool, token: str | None, chat_id: str | None,
) -> None:
    """Diffs your own active offers (the market's uop/uoid/ofc fields -
    only ever your own, see README) against the previous poll's snapshot
    and alerts on anything that changed: a new bid, a revised bid amount,
    or a tracked bid that's no longer on the market - resolved as "won" if
    the player is now in your squad, "lost" otherwise. Works regardless of
    whether the bid was placed through this tool or the Kickbase app
    itself, since it's reading your account's own offer state from the API,
    not anything this tool wrote.

    Separate state file from the notable-new-listing tracking above - the
    two are unrelated diffs over the same market snapshot.
    """
    state_file = _my_bids_state_path(league_id)
    first_run = not state_file.exists()
    previous: dict[str, dict] = {}
    if not first_run:
        try:
            previous = json.loads(state_file.read_text())
        except json.JSONDecodeError:
            previous = {}

    current_bids = {item["i"]: item for item in market_items if item.get("uop") is not None}

    if not first_run:
        for player_id, item in current_bids.items():
            prev_item = previous.get(player_id)
            if prev_item is None:
                print(f"[{league_name}] BID PLACED: {_player_name(item)} at {item.get('uop')}")
                _send_bid_alert(item, "placed", item.get("uop"), None, telegram_enabled, token, chat_id)
            elif prev_item.get("uop") != item.get("uop"):
                print(f"[{league_name}] BID UPDATED: {_player_name(item)} now {item.get('uop')} (was {prev_item.get('uop')})")
                _send_bid_alert(
                    item, "updated", item.get("uop"), prev_item.get("uop"), telegram_enabled, token, chat_id
                )

        resolved_ids = set(previous) - set(current_bids)
        if resolved_ids:
            squad_ids = {p.get("i") for p in client.get_squad(league_id).get("it", [])}
            for player_id in resolved_ids:
                prev_item = previous[player_id]
                won = player_id in squad_ids
                status = "won" if won else "lost"
                print(f"[{league_name}] BID {'WON' if won else 'LOST'}: {_player_name(prev_item)}")
                _send_bid_alert(
                    prev_item, status, prev_item.get("uop"), None, telegram_enabled, token, chat_id
                )

    state_file.write_text(json.dumps(current_bids))


def _diff_market(previous: dict[str, dict], current: dict[str, dict]) -> None:
    prev_ids, cur_ids = set(previous), set(current)
    for new_id in cur_ids - prev_ids:
        print(f"[NEW]     {_item_id(current[new_id]):>8}  {_player_name(current[new_id])}")
    for gone_id in prev_ids - cur_ids:
        print(f"[REMOVED] {_item_id(previous[gone_id]):>8}  {_player_name(previous[gone_id])}")
    for shared_id in prev_ids & cur_ids:
        old_item, new_item = previous[shared_id], current[shared_id]
        old_price = _first_present(old_item, PRICE_KEYS)
        new_price = _first_present(new_item, PRICE_KEYS)
        old_bids = _first_present(old_item, BID_COUNT_KEYS)
        new_bids = _first_present(new_item, BID_COUNT_KEYS)
        old_bid_amount, _ = _top_bid(old_item)
        new_bid_amount, new_bidder = _top_bid(new_item)
        if old_price != new_price or old_bids != new_bids or old_bid_amount != new_bid_amount:
            top_bid = f"{new_bid_amount} ({new_bidder})" if new_bid_amount is not None else "none"
            print(
                f"[CHANGED] {_item_id(new_item):>8}  {_player_name(new_item)}  "
                f"price {old_price} -> {new_price}  bids {old_bids} -> {new_bids}  top bid now {top_bid}"
            )


def cmd_watch(args: argparse.Namespace) -> None:
    email, password = _load_credentials(args)
    client = KickbaseClient(email, password)
    client.login()
    league_id = _resolve_league_id(client, args)
    state_file = _state_path(league_id)
    previous: dict[str, dict] = {}
    if state_file.exists():
        try:
            previous = json.loads(state_file.read_text())
        except json.JSONDecodeError:
            previous = {}

    print(f"Watching league {league_id} every {args.interval}s (Ctrl+C to stop)...")
    while True:
        try:
            market = client.get_market(league_id)
            current = {_item_id(item): item for item in market.get("it", [])}
            if previous:
                _diff_market(previous, current)
            else:
                print(f"Initial snapshot: {len(current)} item(s) on the market.")
            state_file.write_text(json.dumps(current))
            previous = current
        except KickbaseError as exc:
            print(f"Error fetching market: {exc}", file=sys.stderr)
        if args.once:
            break
        time.sleep(args.interval)


def cmd_alert(args: argparse.Namespace) -> None:
    """Single poll, two independent diffs against the last-seen snapshot:

    1. Any newly-appeared, notable Kickbase listing (strategy.is_notable_listing
       - manager listings are skipped, same as brief) - see _alert_state_path.
    2. Your own bids (_track_my_bids): a new or revised offer, or a
       previously-tracked bid that's no longer on the market, resolved as
       won/lost by checking your squad.

    Meant to run on a tight cron (.github/workflows/transfer-market.yml)
    rather than in a loop - state persists on disk across runs (via GitHub
    Actions cache in CI), so only what's actually changed since the
    *previous* run gets reported, not the whole market every time.

    The very first run for a league has no prior snapshot to diff
    against, so it just saves a baseline and alerts on nothing - otherwise
    every listing already on the market (and every bid already active)
    would fire as "new" the moment this is turned on.
    """
    email, password = _load_credentials(args)
    client = KickbaseClient(email, password)
    client.login()

    if args.all_leagues:
        leagues = client.leagues
    else:
        league_id = _resolve_league_id(client, args)
        leagues = [l for l in client.leagues if l.get("id") == league_id]

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if args.telegram and not (token and chat_id):
        sys.exit("--telegram needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set.")

    for league in leagues:
        league_id = league["id"]
        league_name = league.get("name", league_id)
        state_file = _alert_state_path(league_id)
        previous: dict[str, dict] = {}
        if state_file.exists():
            try:
                previous = json.loads(state_file.read_text())
            except json.JSONDecodeError:
                previous = {}

        market = client.get_market(league_id).get("it", [])
        current = {_item_id(item): item for item in market}

        if not previous:
            print(f"[{league_name}] Baseline snapshot saved ({len(current)} listings) - no alerts on first run.")
        else:
            new_ids = set(current) - set(previous)
            new_items = [current[i] for i in new_ids]
            notable = [p for p in new_items if not p.get("u") and strategy.is_notable_listing(p)]
            if not notable:
                print(f"[{league_name}] No notable new listings this poll ({len(new_items)} new, filtered out).")
            for player in notable[: args.max_alerts]:
                _enrich_with_history(client, league_id, [player])
                alert = report.render_new_listing_alert(player)
                print(f"[{league_name}] ALERT: {_player_name(player)}")
                if args.telegram:
                    if alert["photo_url"]:
                        telegram.send_photo(token, chat_id, alert["photo_url"], alert["caption"], alert["keyboard"])
                    else:
                        telegram.send_message(token, chat_id, alert["caption"], alert["keyboard"])

        state_file.write_text(json.dumps(current))

        _track_my_bids(client, league_id, league_name, list(current.values()), args.telegram, token, chat_id)


def _max_squad_size(client: KickbaseClient, league_id: str) -> int:
    for league in client.leagues:
        if league.get("id") == league_id:
            return league.get("pl", 9999)
    return 9999


def _enrich_with_history(client: KickbaseClient, league_id: str, players: list[dict]) -> None:
    """Mutates each player dict in place, attaching real d1/d7 market-value
    deltas (see predict.history_deltas) from Kickbase's own history
    endpoint, so momentum_score()/decline_urgency() rank on actual
    observed trend instead of a fallback. One extra request per player -
    fine at brief/bot's run frequency, not something to do in a tight loop.
    """
    for player in players:
        player_id = player.get("i")
        if not player_id:
            continue
        try:
            history = client.get_market_value_history(league_id, player_id)
        except KickbaseError:
            continue
        player.update(predict.history_deltas(history))


def _normalize_manager_squad_items(items: list[dict]) -> list[dict]:
    """get_manager_squad()'s player items use "pi"/"pn" (player id/name)
    instead of get_squad()'s "i"/"fn"+"n" - remap in place so the shared
    report.py/_enrich_with_history helpers (which expect "i" and "n")
    work unchanged on another manager's squad too.
    """
    for item in items:
        item["i"] = item.get("pi")
        item["n"] = item.get("pn")
    return items


UPDATE_CUTOFF_HOUR_UTC = 18  # the daily market-value update empirically fires ~18:00-20:00 UTC


def _reference_day_for_join(join_dt: str) -> int:
    """Epoch day index (matching market-value-history's "dt") to value a
    manager's starting-allocation squad at: the day *before* they joined
    if they joined before the daily value update fires that day (their
    squad was priced using the previous day's close, since that day's own
    update hadn't landed yet), otherwise the join day itself. Validated to
    the exact budget dollar against a real account that joined at 11:53
    UTC - see README's budget-reconstruction section for the full
    derivation.
    """
    dt = datetime.fromisoformat(join_dt.replace("Z", "+00:00"))
    day_index = (dt.date() - date(1970, 1, 1)).days
    return day_index - 1 if dt.hour < UPDATE_CUTOFF_HOUR_UTC else day_index


def _all_manager_transfers(client: KickbaseClient, league_id: str, manager_id: str) -> list[dict]:
    """Every transfer for a manager, walking get_manager_transfers()'s
    pagination fully rather than trusting a single page - important here
    since a truncated buy/sell total would silently corrupt the budget
    reconstruction below.
    """
    entries: list[dict] = []
    start = 0
    while True:
        batch = client.get_manager_transfers(league_id, manager_id, start=start).get("it", [])
        if not batch:
            break
        entries.extend(batch)
        start += len(batch)
    return entries


def _achievement_state_path(league_id: str) -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / f"achievements_seen_{league_id}.json"


def _track_achievements(
    league_id: str, manager_id: str, manager_name: str, unlocked: list[achievements.Achievement]
) -> list[achievements.Achievement]:
    """Persists which publicly-inferable achievements each manager has
    crossed the threshold for, across runs (see achievements.infer_unlocked) -
    so a newly-crossed one gets a real "first seen" date instead of just
    silently feeding that day's budget total. Returns the ones newly
    unlocked since the last run (always empty the very first time a
    manager is tracked, since there's nothing yet to compare against).
    """
    state_file = _achievement_state_path(league_id)
    state: dict = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text())
        except json.JSONDecodeError:
            state = {}

    manager_state = state.get(manager_id, {})
    known_ids = set(manager_state.get("achievement_ids", []))
    current_ids = {a.type_id for a in unlocked}
    newly_unlocked = [a for a in unlocked if a.type_id not in known_ids]

    first_seen = manager_state.get("first_seen", {})
    now = datetime.now(timezone.utc).isoformat()
    for a in newly_unlocked:
        first_seen[str(a.type_id)] = now

    state[manager_id] = {"name": manager_name, "achievement_ids": sorted(current_ids), "first_seen": first_seen}
    state_file.write_text(json.dumps(state))
    return newly_unlocked


def _estimate_manager_budget(
    client: KickbaseClient, league_id: str, manager_id: str, manager_name: str,
    join_dt: str, squad_items: list[dict], league_size: int,
) -> float:
    """Reconstructs a manager's current budget: Kickbase's fixed 150M
    starting budget, minus their starting-allocation squad's value (see
    _reference_day_for_join), minus everything they've ever bought, plus
    everything they've ever sold, plus every publicly-inferable
    achievement reward they've crossed the threshold for
    (achievements.infer_unlocked() - league size, their own transfer
    count, their own squad value; see _track_achievements() for the
    persisted "when did they unlock this" record).

    This is exact for the logged-in account when *all* achievement
    rewards (not just the inferable ones) and daily-bonus collections are
    added on top (both otherwise user-scoped only, no equivalent for
    another manager - see client.get_achievements()) - for a competitor
    this is still only a lower bound, since performance-based
    achievements (points, wins, per-player profit) can't be checked this
    way and bonus collections are invisible entirely. squad_items is
    whatever's already been fetched for this manager (get_squad() or
    get_manager_squad(), already normalized) so this doesn't re-fetch it.
    """
    log = _all_manager_transfers(client, league_id, manager_id)
    bought_ids_ever = {t["pi"] for t in log if t.get("tty") == 1}
    current_ids = {p.get("i") for p in squad_items}
    sold_ids = {t["pi"] for t in log if t.get("tty") == 2}
    starting_ids = (current_ids | sold_ids) - bought_ids_ever

    reference_day = _reference_day_for_join(join_dt)
    starting_cost = 0.0
    for player_id in starting_ids:
        try:
            history = client.get_market_value_history(league_id, player_id)
        except KickbaseError:
            continue
        mv = next((e.get("mv") for e in history.get("it", []) if e.get("dt") == reference_day), None)
        starting_cost += mv or 0

    total_bought = sum(t.get("trp", 0) for t in log if t.get("tty") == 1)
    total_sold = sum(t.get("trp", 0) for t in log if t.get("tty") == 2)

    squad_value = sum(p.get("mv", 0) or 0 for p in squad_items)
    unlocked = achievements.infer_unlocked(league_size, len(log), squad_value)
    achievement_reward = sum(a.reward for a in unlocked)

    newly_unlocked = _track_achievements(league_id, manager_id, manager_name, unlocked)
    for a in newly_unlocked:
        print(f"  ACHIEVEMENT: {manager_name} newly unlocked '{a.name}' (+{a.reward:,})")

    return 150_000_000 - starting_cost - total_bought + total_sold + achievement_reward


def _fetch_competitors(client: KickbaseClient, league_id: str) -> list[dict] | None:
    """Every other league member's squad value, today's gain/loss, and
    estimated budget (+ combined total), for the daily squad-value
    update's "Competitors" section. Returns None (rather than a
    partial/misleading list) if the ranking call itself fails - a single
    competitor's squad failing to load just drops that one manager
    instead, since one member's odd data shouldn't hide everyone else's.
    """
    try:
        ranking = client.get_ranking(league_id)
    except KickbaseError as exc:
        print(f"Warning: couldn't fetch league ranking for competitors: {exc}", file=sys.stderr)
        return None

    league_size = len(ranking.get("us", []))
    competitors = []
    for manager in ranking.get("us", []):
        manager_id = manager.get("i")
        manager_name = manager.get("n", "?")
        if not manager_id or manager_id == client.user_id:
            continue
        try:
            squad = client.get_manager_squad(league_id, manager_id).get("it", [])
        except KickbaseError as exc:
            print(f"Warning: couldn't fetch squad for {manager_name}: {exc}", file=sys.stderr)
            continue
        _normalize_manager_squad_items(squad)
        _enrich_with_history(client, league_id, squad)
        total_value = sum(p.get("mv", 0) or 0 for p in squad)
        deltas = [p.get("d1") for p in squad if p.get("d1") is not None]
        total_delta = sum(deltas) if deltas else None

        estimated_budget = None
        join_dt = manager.get("jd")
        if join_dt:
            try:
                estimated_budget = _estimate_manager_budget(
                    client, league_id, manager_id, manager_name, join_dt, squad, league_size
                )
            except KickbaseError as exc:
                print(f"Warning: couldn't estimate budget for {manager_name}: {exc}", file=sys.stderr)

        competitors.append({
            "name": manager_name,
            "total_value": total_value,
            "total_delta": total_delta,
            "estimated_budget": estimated_budget,
        })
    return competitors


def _build_spending_profiles(client: KickbaseClient, league_id: str) -> list[dict]:
    """Per league member: every player they've bought (tty=1 in
    client.get_manager_transfers()), with the premium they paid over that
    player's *current* market value, split into computer-market buys (no
    othnm) vs. manager-to-manager trades (othnm present) - see
    report.render_spending_analysis() for why the split matters. Caches
    each player's current mv across managers so a player bought/resold
    multiple times only costs one get_player() call.
    """
    ranking = client.get_ranking(league_id)
    managers = {u["i"]: u.get("n", "?") for u in ranking.get("us", []) if u.get("i")}

    mv_cache: dict[str, float | None] = {}

    def _current_mv(player_id: str) -> float | None:
        if player_id not in mv_cache:
            try:
                mv_cache[player_id] = client.get_player(league_id, player_id).get("mv")
            except KickbaseError:
                mv_cache[player_id] = None
        return mv_cache[player_id]

    profiles = []
    for manager_id, name in managers.items():
        try:
            log = client.get_manager_transfers(league_id, manager_id).get("it", [])
        except KickbaseError as exc:
            print(f"Warning: couldn't fetch transfer history for {name}: {exc}", file=sys.stderr)
            continue
        computer_buys, manager_buys = [], []
        for t in log:
            if t.get("tty") != 1:  # only purchases feed spending behavior, not sales
                continue
            trp, mv = t.get("trp"), _current_mv(t.get("pi"))
            if not trp or not mv:
                continue
            entry = {"player_name": t.get("pn"), "trp": trp, "mv": mv, "premium_pct": (trp - mv) / mv * 100}
            if t.get("othnm"):
                entry["othnm"] = t["othnm"]
                manager_buys.append(entry)
            else:
                computer_buys.append(entry)
        profiles.append({"name": name, "computer_buys": computer_buys, "manager_buys": manager_buys})
    return profiles


def cmd_transfer_analysis(args: argparse.Namespace) -> None:
    """For every league member, compares what they actually paid for each
    player against that player's current market value, to see who pays
    close to asking price on computer listings vs who tends to overspend,
    plus every manager-to-manager trade's premium. This is the only way
    to see anything about competing bids at all - Kickbase's sealed-bid
    design (see README) hides them completely while a listing is open;
    this only works retroactively, once a transfer has already completed.

    Runs daily at 8pm Europe/Berlin via
    .github/workflows/transfer-analysis.yml - before the ~10pm daily
    value recalculation squad-value.yml waits for, so this reflects the
    day's transfers against values that haven't just shifted underneath
    them.
    """
    email, password = _load_credentials(args)
    client = KickbaseClient(email, password)
    client.login()

    if args.all_leagues:
        leagues = client.leagues
    else:
        league_id = _resolve_league_id(client, args)
        leagues = [l for l in client.leagues if l.get("id") == league_id]

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if args.telegram and not (token and chat_id):
        sys.exit("--telegram needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set.")

    for league in leagues:
        league_id = league["id"]
        league_name = league.get("name", league_id)
        profiles = _build_spending_profiles(client, league_id)
        text = report.render_spending_analysis(league_name, profiles)
        print(text)
        print()
        if args.telegram:
            telegram.send_message(token, chat_id, text)
            print("(sent to Telegram)")


def cmd_bot(args: argparse.Namespace) -> None:
    email, password = _load_credentials(args)
    client = KickbaseClient(email, password)
    client.login()
    league_id = _resolve_league_id(client, args)

    squad = client.get_squad(league_id).get("it", [])
    budget = client.get_budget(league_id).get("b", 0)
    market = client.get_market(league_id).get("it", [])
    max_squad_size = _max_squad_size(client, league_id)
    _enrich_with_history(client, league_id, squad)
    _enrich_with_history(client, league_id, market)

    # Log this run's features so a real model can eventually be trained on
    # them (see predict.py) - append-only, safe on every run.
    predict.record_snapshot(league_id, squad + market)

    lineup_result = strategy.best_lineup(squad)
    if lineup_result is None:
        print("Not enough fit players to fill any known formation - skipping lineup change.")
        formation, starter_ids, bench = None, [], squad
    else:
        formation, starter_ids, bench = lineup_result

    instant_sells, list_sells = strategy.sell_candidates(bench, MIN_SQUAD_SIZE, len(squad))
    # Instant sells free a squad slot immediately (confirmed live: squad
    # size drops and budget is credited the moment the sale completes), so
    # buy room accounts for them. Market listings don't free a slot until
    # someone else actually buys, so those aren't subtracted here.
    projected_squad_size = len(squad) - len(instant_sells)
    buys = strategy.buy_candidates(market, budget, projected_squad_size, max_squad_size)

    print(f"=== Bot plan for league {league_id} ===")
    print(f"Budget: {budget:,.0f}")
    print(f"Squad size: {len(squad)} (max {max_squad_size})")
    print()
    if formation:
        print(f"Lineup: {formation} ({len(starter_ids)} starters)")
        by_id = {p["i"]: p for p in squad}
        for pid in starter_ids:
            player = by_id[pid]
            print(f"  {_player_name(player)} (pos {player.get('pos')}, {player.get('ap', 0)} avg pts)")
    print()
    print(f"Instant-sell to Kickbase ({len(instant_sells)}):")
    for player in instant_sells:
        print(f"  {_player_name(player)} for ~{player.get('mv')} (falling trend, 0 avg pts)")
    print()
    print(f"List on market ({len(list_sells)}):")
    for player in list_sells:
        score = predict.decline_urgency(player)
        print(f"  {_player_name(player)} at {player.get('mv')} (score {score:,.0f})")
    print()
    print(f"Bid ({len(buys)}):")
    spend = 0
    for item in buys:
        price = item.get("prc") or 0
        spend += price
        score = predict.momentum_score(item)
        print(f"  {_player_name(item)} at {price} (score {score:,.0f})")
    if not buys and projected_squad_size >= max_squad_size:
        print(f"  (squad at max size {max_squad_size} even after instant sells - listing a player for")
        print(f"   sale doesn't free a slot until someone buys it, so no bids are queued this cycle)")
    print(f"Total planned spend: {spend:,.0f} of {budget:,.0f} available")

    if args.dry_run:
        print("\n--dry-run: no changes made.")
        return

    print()
    if formation:
        client.set_lineup(league_id, formation, starter_ids)
        print(f"Lineup set to {formation}.")
    for player in instant_sells:
        client.sell_to_kickbase(league_id, player["i"])
        print(f"Instant-sold {_player_name(player)} to Kickbase.")
    for player in list_sells:
        client.list_for_sale(league_id, player["i"], int(player.get("mv", 0)))
        print(f"Listed {_player_name(player)} for {player.get('mv')}.")
    for item in buys:
        client.place_bid(league_id, item["i"], int(item.get("prc", 0)))
        print(f"Bid {item.get('prc')} on {_player_name(item)}.")


def cmd_brief(args: argparse.Namespace) -> None:
    """Read-only summary + advice, no execution. Scoped to one league by
    default (--league-id / KICKBASE_LEAGUE_ID, same as market/bot) since
    this is meant to become a single periodic digest for one league, not
    every league on the account. --all-leagues opts back into covering
    everything.
    """
    email, password = _load_credentials(args)
    client = KickbaseClient(email, password)
    client.login()

    if args.all_leagues:
        leagues = client.leagues
    else:
        league_id = _resolve_league_id(client, args)
        leagues = [l for l in client.leagues if l.get("id") == league_id]

    sections = []
    telegram_payloads = []
    for league in leagues:
        league_id = league["id"]
        league_name = league.get("name", league_id)
        squad = client.get_squad(league_id).get("it", [])
        budget = client.get_budget(league_id).get("b", 0)
        market = client.get_market(league_id).get("it", [])
        max_squad_size = _max_squad_size(client, league_id)
        _enrich_with_history(client, league_id, squad)
        _enrich_with_history(client, league_id, market)
        data = report.compute_briefing(squad, budget, market, max_squad_size)
        sections.append(report.render_text(league_name, data))
        telegram_payloads.append(report.render_telegram(league_name, data))
        predict.record_snapshot(league_id, squad + market)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    full_text = f"Kickbase Briefing — {timestamp}\n\n" + ("\n" + "-" * 40 + "\n").join(sections)
    print(full_text)

    if args.telegram:
        token = os.environ.get("TELEGRAM_BOT_TOKEN")
        chat_id = os.environ.get("TELEGRAM_CHAT_ID")
        if not token or not chat_id:
            sys.exit("--telegram needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set.")
        for payload in telegram_payloads:
            if payload["photo_url"]:
                telegram.send_photo(token, chat_id, payload["photo_url"], payload["caption"])
            telegram.send_message(token, chat_id, payload["text"], payload["keyboard"])
        print("\n(sent to Telegram)")


def cmd_squad_value(args: argparse.Namespace) -> None:
    """Daily squad market-value recap, separate from `brief`'s advice
    digest: every owned player's 24h change plus the total gain/loss
    across the whole squad, plus (unless --no-competitors) every other
    league member's squad value and gain/loss for the same comparison.
    Meant to run once a day shortly after Kickbase's own daily value
    recalculation (see .github/workflows/squad-value.yml), not tied to
    brief's schedule.
    """
    email, password = _load_credentials(args)
    client = KickbaseClient(email, password)
    client.login()

    if args.all_leagues:
        leagues = client.leagues
    else:
        league_id = _resolve_league_id(client, args)
        leagues = [l for l in client.leagues if l.get("id") == league_id]

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if args.telegram and not (token and chat_id):
        sys.exit("--telegram needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set.")

    for league in leagues:
        league_id = league["id"]
        league_name = league.get("name", league_id)
        squad = client.get_squad(league_id).get("it", [])
        budget = client.get_budget(league_id).get("b", 0)
        _enrich_with_history(client, league_id, squad)
        competitors = None if args.no_competitors else _fetch_competitors(client, league_id)
        text = report.render_squad_value_update(league_name, squad, budget, competitors)
        print(text)
        print()
        if args.telegram:
            telegram.send_message(token, chat_id, text)
            print("(sent to Telegram)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Kickbase transfer market CLI")
    parser.add_argument("--email", help="Kickbase account email (or KICKBASE_EMAIL env var)")
    parser.add_argument("--password", help="Kickbase account password (or KICKBASE_PASSWORD env var)")
    parser.add_argument("--league-id", help="League ID (or KICKBASE_LEAGUE_ID env var)")

    subparsers = parser.add_subparsers(dest="command", required=True)

    market_parser = subparsers.add_parser("market", help="Fetch the current transfer market once")
    market_parser.add_argument("--raw", action="store_true", help="Print raw JSON instead of a table")
    market_parser.set_defaults(func=cmd_market)

    watch_parser = subparsers.add_parser("watch", help="Poll the market on an interval and report changes")
    watch_parser.add_argument("--interval", type=int, default=300, help="Seconds between polls (default: 300)")
    watch_parser.add_argument("--once", action="store_true", help="Poll a single time and exit")
    watch_parser.set_defaults(func=cmd_watch)

    bot_parser = subparsers.add_parser(
        "bot", help="Optimize lineup, sell falling players, bid on rising ones"
    )
    bot_parser.add_argument(
        "--dry-run", action="store_true", help="Print the plan without setting the lineup or spending anything"
    )
    bot_parser.set_defaults(func=cmd_bot)

    brief_parser = subparsers.add_parser(
        "brief", help="Read-only summary + advice for one league, no execution"
    )
    brief_parser.add_argument(
        "--all-leagues", action="store_true", help="Cover every league on the account instead of just one"
    )
    brief_parser.add_argument(
        "--telegram", action="store_true",
        help="Also push the briefing to Telegram (needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"
    )
    brief_parser.set_defaults(func=cmd_brief)

    alert_parser = subparsers.add_parser(
        "alert", help="Single poll: alert on newly-listed notable players (meant for a tight cron)"
    )
    alert_parser.add_argument(
        "--all-leagues", action="store_true", help="Cover every league on the account instead of just one"
    )
    alert_parser.add_argument(
        "--telegram", action="store_true",
        help="Push new-listing alerts to Telegram (needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"
    )
    alert_parser.add_argument(
        "--max-alerts", type=int, default=5, help="Cap alerts sent in a single run (default: 5)"
    )
    alert_parser.set_defaults(func=cmd_alert)

    squad_value_parser = subparsers.add_parser(
        "squad-value", help="Daily recap: each squad player's 24h value change + total gain/loss"
    )
    squad_value_parser.add_argument(
        "--all-leagues", action="store_true", help="Cover every league on the account instead of just one"
    )
    squad_value_parser.add_argument(
        "--telegram", action="store_true",
        help="Push the recap to Telegram (needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"
    )
    squad_value_parser.add_argument(
        "--no-competitors", action="store_true",
        help="Skip fetching other league members' squads (faster, own squad only)"
    )
    squad_value_parser.set_defaults(func=cmd_squad_value)

    transfer_analysis_parser = subparsers.add_parser(
        "transfer-analysis",
        help="On-demand: who pays close to asking price vs who overspends, per league member",
    )
    transfer_analysis_parser.add_argument(
        "--all-leagues", action="store_true", help="Cover every league on the account instead of just one"
    )
    transfer_analysis_parser.add_argument(
        "--telegram", action="store_true",
        help="Push the analysis to Telegram (needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"
    )
    transfer_analysis_parser.set_defaults(func=cmd_transfer_analysis)

    return parser


def main(argv: list[str] | None = None) -> None:
    from dotenv import load_dotenv
    load_dotenv()

    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except KickbaseError as exc:
        sys.exit(str(exc))


if __name__ == "__main__":
    main()
