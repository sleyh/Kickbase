"""Market-value momentum scoring, plus a snapshot collector for the
broader-feature history (points, status, etc.) a future trained model
would need beyond what Kickbase's own history endpoint gives.

Correction from an earlier version of this file: Kickbase *does* expose
real daily market-value history per player - `GET
/v4/leagues/{leagueId}/players/{playerId}/marketValue/{timeframe}` (see
client.get_market_value_history) - which is what the app's own 24h/7d
charts are built from. An earlier pass here claimed no such endpoint
existed and built a workaround (comparing our own sporadic snapshots)
instead; that was a research miss, not a real API limitation. The
workaround is gone - history_deltas() below uses the real endpoint.

What's still not a trained model, and why: the real endpoint gives market
value over time, but not the *other* features (points, status, minutes)
aligned to those same days - and Kickbase doesn't expose that combined
history at all. record_snapshot()/load_history() are what build that
dataset ourselves, one run at a time, for whenever there's enough of it to
train something real on.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

HISTORY_DB_PATH = Path.home() / ".cache" / "kickbase" / "history.db"


def history_deltas(history: dict) -> dict[str, float | None]:
    """Given a get_market_value_history() response, returns the actual
    observed {"d1": 1-day change, "d7": 7-day change} in market value -
    None for either if there isn't enough history yet (e.g. a player who
    only just appeared).
    """
    entries = history.get("it") or []
    if len(entries) < 2:
        return {"d1": None, "d7": None}
    latest = entries[-1].get("mv")
    d1 = latest - entries[-2]["mv"] if len(entries) >= 2 else None
    d7 = latest - entries[-8]["mv"] if len(entries) >= 8 else None
    return {"d1": d1, "d7": d7}


def naive_projection(player: dict) -> float | None:
    """The closest thing here to an actual forward-looking number: the
    7-day trend's average daily rate, continued one more day. This is
    NOT a trained forecast - it's linear trend continuation, the simplest
    possible assumption, and will be wrong whenever a trend reverses
    (which market values do, often, especially after a good/bad
    matchday). None if there's no d7 to extrapolate from.
    """
    d7 = player.get("d7")
    if d7 is None:
        return None
    return d7 / 7


def momentum_score(player: dict) -> float:
    """Recent market value delta, scaled up for players also producing
    points - a rise backed by real performance is more likely to continue
    than one that isn't. Used to rank buy candidates: higher = stronger
    buy signal.

    Prefers the real 7-day delta (`d7`, from history_deltas()) when the
    caller has attached one; falls back to `sdmvt` (only present on squad
    items, never on market listings) and finally to points alone if
    neither delta is available.
    """
    points = player.get("ap", 0) or 0
    delta = player.get("d7")
    if delta is None:
        delta = player.get("sdmvt")
    if delta is None:
        return points
    return delta * (1 + points / 100)


def decline_urgency(player: dict) -> float:
    """Recent market value delta, scaled down for players still producing
    points - a decline with real output behind it reads more like a
    temporary dip than one with nothing behind it. Used to rank sell
    candidates: more negative = more urgent to sell.

    Same `d7` -> `sdmvt` -> points-only fallback order as momentum_score().
    """
    points = player.get("ap", 0) or 0
    delta = player.get("d7")
    if delta is None:
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
