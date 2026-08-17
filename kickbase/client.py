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
        return True

    def _save_cached_token(self) -> None:
        TOKEN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_CACHE_PATH.write_text(json.dumps({
            "email": self.email,
            "tkn": self.token,
            "srvl": self.leagues,
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
