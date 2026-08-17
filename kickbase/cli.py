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
from pathlib import Path

from .client import KickbaseClient, KickbaseError

STATE_DIR = Path.home() / ".cache" / "kickbase"

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
ITEM_ID_KEYS = ("i", "id", "pi")


def _first_present(item: dict, keys: tuple[str, ...]):
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


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
        rows.append((
            _item_id(item),
            _player_name(item),
            str(_first_present(item, TEAM_KEYS) or ""),
            str(_first_present(item, PRICE_KEYS) or ""),
            str(_first_present(item, MARKET_VALUE_KEYS) or ""),
            str(_first_present(item, EXPIRY_KEYS) or ""),
            str(bids) if bids is not None else "?",
        ))
    headers = ("ID", "Player", "Team", "Price", "Market Value", "Expires", "Bids")
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*("-" * w for w in widths)))
    for row in rows:
        print(fmt.format(*row))
    if all(r[-1] == "?" for r in rows):
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
        if old_price != new_price or old_bids != new_bids:
            print(
                f"[CHANGED] {_item_id(new_item):>8}  {_player_name(new_item)}  "
                f"price {old_price} -> {new_price}  bids {old_bids} -> {new_bids}"
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
