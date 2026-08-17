"""Market-value momentum scoring, and the snapshot collector that builds
the dataset a real trained model (v1) would eventually need.

v0 here is deliberately NOT a trained model: Kickbase doesn't expose
historical value time series through any endpoint we've found, and before
this file existed we had no snapshots of our own either. Training
something today and calling it machine learning would just be fitting
noise (or worse, dressing up a hardcoded answer as "learned"). So:

- momentum_score() is a transparent, hand-weighted combination of what a
  single live snapshot actually gives us: the recent value delta (sdmvt)
  and points production (ap). This is what strategy.py ranks buy/sell
  candidates by today.
- record_snapshot() / load_history() persist every squad+market snapshot
  the bot sees to a local SQLite database. Once enough days of real
  (features -> next-day actual value change) pairs exist, that data is
  what an actual regression model would train on to replace
  momentum_score(). Nothing here claims that day has arrived yet.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

HISTORY_DB_PATH = Path.home() / ".cache" / "kickbase" / "history.db"


def momentum_score(player: dict) -> float:
    """Recent market value delta, scaled up for players also producing
    points - a rise backed by real performance is more likely to continue
    than one that isn't. Used to rank buy candidates: higher = stronger
    buy signal.

    `sdmvt` is only present on squad items, never on market listings (
    confirmed against live data - every market item has the key entirely
    absent, not just zero) - so buy candidates, which come from the
    market, always fall back to points production alone as the ranking
    signal. Squad items (used for sell ranking) do carry it.
    """
    points = player.get("ap", 0) or 0
    delta = player.get("sdmvt")
    if delta is None:
        return points
    return delta * (1 + points / 100)


def decline_urgency(player: dict) -> float:
    """Recent market value delta, scaled down for players still producing
    points - a decline with real output behind it reads more like a
    temporary dip than one with nothing behind it. Used to rank sell
    candidates: more negative = more urgent to sell.

    Falls back to a small points-scaled negative value if sdmvt is
    missing, so the same "protect productive players" logic still holds
    even without a real delta to work from.
    """
    points = player.get("ap", 0) or 0
    delta = player.get("sdmvt")
    if delta is None:
        return -1 / (1 + points / 100)
    return delta / (1 + points / 100)


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
            league_id TEXT NOT NULL,
            player_id TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            day INTEGER,
            mv INTEGER,
            mvt INTEGER,
            sdmvt INTEGER,
            tfhmvt INTEGER,
            ap INTEGER,
            p INTEGER,
            PRIMARY KEY (league_id, player_id, captured_at)
        )
        """
    )
    return conn


def record_snapshot(league_id: str, players: list[dict], db_path: Path = HISTORY_DB_PATH) -> None:
    """Appends one row per player for this point in time.

    Safe to call on every bot run - captured_at (an ISO timestamp) makes
    each call's rows distinct, so this is an append-only log, not a
    last-known-state table.
    """
    captured_at = datetime.now(timezone.utc).isoformat()
    conn = _connect(db_path)
    with conn:
        conn.executemany(
            """INSERT OR IGNORE INTO snapshots
               (league_id, player_id, captured_at, day, mv, mvt, sdmvt, tfhmvt, ap, p)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    league_id, p.get("i"), captured_at, p.get("day"),
                    p.get("mv"), p.get("mvt"), p.get("sdmvt"), p.get("tfhmvt"),
                    p.get("ap"), p.get("p"),
                )
                for p in players
                if p.get("i")
            ],
        )
    conn.close()


def load_history(league_id: str, player_id: str, db_path: Path = HISTORY_DB_PATH) -> list[dict]:
    """All recorded snapshots for one player, oldest first - the raw
    material a future training step would turn into (features, label)
    pairs. Empty until record_snapshot() has run a few times.
    """
    conn = _connect(db_path)
    rows = conn.execute(
        """SELECT captured_at, day, mv, mvt, sdmvt, tfhmvt, ap, p
           FROM snapshots WHERE league_id = ? AND player_id = ?
           ORDER BY captured_at""",
        (league_id, player_id),
    ).fetchall()
    conn.close()
    cols = ["captured_at", "day", "mv", "mvt", "sdmvt", "tfhmvt", "ap", "p"]
    return [dict(zip(cols, row)) for row in rows]


def observed_delta(
    league_id: str, player_id: str, current_mv: int | None, db_path: Path = HISTORY_DB_PATH
) -> int | None:
    """Market value change since the most recent snapshot we recorded for
    this player - our own substitute for sdmvt on market listings, which
    the live API never provides (see momentum_score). None if we haven't
    seen this player before or current_mv is unknown.

    Caller must query this *before* calling record_snapshot() for the
    current run, or "most recent" would just be the run in progress.
    """
    if current_mv is None:
        return None
    history = load_history(league_id, player_id, db_path)
    if not history:
        return None
    previous_mv = history[-1].get("mv")
    if previous_mv is None:
        return None
    return current_mv - previous_mv
