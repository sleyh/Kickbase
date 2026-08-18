"""Minimal client for the Kickbase v4 API.

Endpoint reference: https://github.com/kevinskyba/kickbase-api-doc
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests

BASE_URL = "https://api.kickbase.com"
TOKEN_CACHE_PATH = Path.home() / ".cache" / "kickbase" / "token.json"


class KickbaseError(RuntimeError):
    """Raised when the Kickbase API returns an unexpected response."""


class KickbaseClient:
    def __init__(self, email: str, password: str, base_url: str = BASE_URL):
        self.email = email
        self.password = password
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.token: str | None = None
        self.leagues: list[dict] = []
        self.user_id: str | None = None

    def _headers(self) -> dict:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def login(self, use_cache: bool = True) -> None:
        """Authenticate and populate self.token / self.leagues.

        Reuses a cached token from a previous run when possible, since
        Kickbase rate-limits repeated logins. Falls back to a fresh login
        automatically on the first 401 (see _get).
        """
        if use_cache and self._load_cached_token():
            return
        resp = self.session.post(
            f"{self.base_url}/v4/user/login",
            json={"em": self.email, "pass": self.password},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=15,
        )
        if resp.status_code != 200:
            raise KickbaseError(f"Login failed ({resp.status_code}): {resp.text}")
        data = resp.json()
        self.token = data["tkn"]
        self.leagues = data.get("srvl", [])
        self.user_id = data.get("u", {}).get("id")
        self._save_cached_token()

    def _load_cached_token(self) -> bool:
        if not TOKEN_CACHE_PATH.exists():
            return False
        try:
            cached = json.loads(TOKEN_CACHE_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return False
        if cached.get("email") != self.email or not cached.get("tkn"):
            return False
        self.token = cached["tkn"]
        self.leagues = cached.get("srvl", [])
        self.user_id = cached.get("user_id")
        return True

    def _save_cached_token(self) -> None:
        TOKEN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_CACHE_PATH.write_text(json.dumps({
            "email": self.email,
            "tkn": self.token,
            "srvl": self.leagues,
            "user_id": self.user_id,
        }))
        TOKEN_CACHE_PATH.chmod(0o600)

    def _get(self, path: str) -> Any:
        resp = self.session.get(f"{self.base_url}{path}", headers=self._headers(), timeout=15)
        if resp.status_code == 401:
            # Cached token expired: force a fresh login and retry once.
            self.login(use_cache=False)
            resp = self.session.get(f"{self.base_url}{path}", headers=self._headers(), timeout=15)
        if not resp.ok:
            raise KickbaseError(f"GET {path} failed ({resp.status_code}): {resp.text}")
        return resp.json()

    def _post(self, path: str, body: dict | None = None) -> Any:
        headers = {**self._headers(), "Content-Type": "application/json"}
        resp = self.session.post(f"{self.base_url}{path}", headers=headers, json=body or {}, timeout=15)
        if resp.status_code == 401:
            self.login(use_cache=False)
            headers = {**self._headers(), "Content-Type": "application/json"}
            resp = self.session.post(f"{self.base_url}{path}", headers=headers, json=body or {}, timeout=15)
        if not resp.ok:
            raise KickbaseError(f"POST {path} failed ({resp.status_code}): {resp.text}")
        return resp.json() if resp.text else None

    def get_market(self, league_id: str) -> dict:
        """Returns the transfer market overview for a league.

        Response shape (per the community doc): {"it": [...market items...],
        "nps": int, "tv": int, "mvud": str, "dt": str, "day": int}.
        The exact fields of each market item aren't documented upstream
        (the doc's captured example had an empty market) - inspect a live
        item with `--raw` to confirm field names for your account/league.
        """
        return self._get(f"/v4/leagues/{league_id}/market")

    def get_player(self, league_id: str, player_id: str) -> dict:
        return self._get(f"/v4/leagues/{league_id}/players/{player_id}")

    def get_market_value_history(self, league_id: str, player_id: str, timeframe: int = 92) -> dict:
        """Daily market value time series for a player - what the app's
        24h/7d value charts are actually built from. timeframe is 92
        (~3 months) or 365 (1 year); those are the only two values the
        API currently accepts. Response: {"it": [{"dt": day_index, "mv":
        value}, ...] (oldest first), "lmv"/"hmv": low/high in the window,
        "trp": total rise points, "idp": in a drop phase}.
        """
        return self._get(f"/v4/leagues/{league_id}/players/{player_id}/marketValue/{timeframe}")

    def get_squad(self, league_id: str) -> dict:
        """Owned players: {"it": [...]}, each with mv/mvt (value + trend), ap, pos, st."""
        return self._get(f"/v4/leagues/{league_id}/squad")

    def get_budget(self, league_id: str) -> dict:
        """{"b": available budget, "pbas": ..., "bs": ...}."""
        return self._get(f"/v4/leagues/{league_id}/me/budget")

    def get_ranking(self, league_id: str) -> dict:
        """League standings: {"us": [{"i": user id, "n": name, "jd": join
        date, ...}, ...]} - one entry per manager including yourself. The
        doc-listed field that looks like team value (`tv`) reads 0.0 for
        everyone in practice (confirmed live, including on my own squad
        which is worth tens of millions) - not a usable market-value
        source. `jd` (join date) matters for budget reconstruction - see
        cli._estimate_manager_budget() - a manager's starting-allocation
        squad is valued as of the day *before* they joined if they joined
        before the daily value update fires (confirmed empirically:
        ~18:00-20:00 UTC), since that day's own update hadn't landed yet
        at join time.
        """
        return self._get(f"/v4/leagues/{league_id}/ranking")

    def get_manager_squad(self, league_id: str, manager_id: str) -> dict:
        """Another league member's squad - found via the doc's OpenAPI
        spec (GET /v4/leagues/{leagueId}/managers/{managerId}/squad),
        missed on first pass since it's nested under `managers/`, not the
        `squad`/`users` paths tried first. Confirmed live to return a real,
        distinct squad per manager (not a silent fallback to your own,
        unlike passing ?userId= to the plain /squad endpoint, which is
        ignored entirely).

        Response shape differs from get_squad(): {"u": manager's user id,
        "unm": name, "uim": avatar, "it": [...]}, and each player item
        uses "pi"/"pn" (player id/name) instead of get_squad()'s "i"/"fn"+"n" -
        see cli.py's _normalize_manager_squad_items().
        """
        return self._get(f"/v4/leagues/{league_id}/managers/{manager_id}/squad")

    def get_manager_transfers(self, league_id: str, manager_id: str, start: int = 0) -> dict:
        """A manager's transfer history: {"u", "unm", "it": [{"pi", "pn",
        "tid", "tty" (1=bought, 2=sold), "othnm" (the other party's name -
        only present when it was a real manager, not Kickbase itself),
        "trp" (price paid/received), "dt", "pim"}]}. Paginated (`start`
        offset) - see cli._all_manager_transfers() for a helper that
        walks every page, since trusting a single page could silently
        truncate an active manager's history.

        Confirmed live: a manager-to-manager trade shows up as a mirrored
        pair across both parties' own logs - identical player, price, and
        timestamp, with tty=2+othnm=<buyer> on the seller's side and
        tty=1+othnm=<seller> on the buyer's side. This is what makes
        sealed bids retroactively visible once a listing resolves - see
        README's "Transfer spending analysis" section.
        """
        return self._get(f"/v4/leagues/{league_id}/managers/{manager_id}/transfer?start={start}")

    def get_achievements(self, league_id: str) -> dict:
        """Your own achievement list: {"it": [{"t" (type id), "n", "d",
        "ac" (1 if achieved), ...}]}. Only ac=1 entries have a real cash
        payout - fetch get_achievement_detail() per type for the "er"
        (earned reward) field. User-scoped only, same as get_budget() -
        there's no /managers/{managerId}/achievements, so this can't be
        read for another manager (confirmed: no such path in the API
        doc's OpenAPI spec).
        """
        return self._get(f"/v4/leagues/{league_id}/user/achievements")

    def get_achievement_detail(self, league_id: str, achievement_type: int) -> dict:
        """One achievement's full detail, including "er" (earned reward -
        cash actually credited to budget, only meaningful if "ac": 1).
        Confirmed live: some achieved achievements carry an "er" value
        that clearly wasn't credited (e.g. cosmetic ones) - cross-check
        against a known-real budget before trusting "er" blindly, see
        README's budget-reconstruction section.
        """
        return self._get(f"/v4/leagues/{league_id}/user/achievements/{achievement_type}")

    def get_activities_feed(self, league_id: str, start: int = 0, max_items: int = 100) -> dict:
        """Paginated league activity feed: {"af": [{"t": type code, "data":
        {...}, "dt", ...}]}. Mixes public events (transfers - type 15,
        new listings - type 3, milestones - type 26) with private ones
        that only ever show your own (bonus collections - type 22,
        confirmed by scanning an entire league's feed and finding zero
        type-22 entries from any of 6 other managers). type 23 is the
        league-creation event itself, carrying the league's starting
        budget setting.
        """
        return self._get(f"/v4/leagues/{league_id}/activitiesFeed?start={start}&max={max_items}")

    def get_lineup(self, league_id: str) -> dict:
        return self._get(f"/v4/leagues/{league_id}/lineup")

    def set_lineup(self, league_id: str, formation: str, player_ids: list[str]) -> Any:
        """formation like "4-4-2" (DEF-MID-FWD; goalkeeper is implicit)."""
        return self._post(f"/v4/leagues/{league_id}/lineup", {"type": formation, "players": player_ids})

    def list_for_sale(self, league_id: str, player_id: str, price: int) -> Any:
        """Lists an owned player on the transfer market at the given price."""
        return self._post(f"/v4/leagues/{league_id}/market", {"pi": player_id, "prc": price})

    def place_bid(self, league_id: str, player_id: str, price: int) -> Any:
        """Places an offer on a market listing (see cli.py for why this is a sealed bid)."""
        return self._post(f"/v4/leagues/{league_id}/market/{player_id}/offers", {"price": price})

    def sell_to_kickbase(self, league_id: str, player_id: str) -> Any:
        """Instantly sells an owned player to Kickbase itself, no waiting on a manager bid.

        Despite the doc describing a two-step POST-then-DELETE-to-accept
        flow, live testing showed a single POST completes the sale
        immediately (player removed from squad, budget credited on the
        spot) - no separate accept call needed.
        """
        return self._post(f"/v4/leagues/{league_id}/market/{player_id}/sell")
