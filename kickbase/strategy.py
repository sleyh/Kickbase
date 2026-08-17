"""Decision logic for the autonomous team bot.

Pure functions: given squad/market/budget state, decide what to do. No
network calls here - kickbase/cli.py wires this to the live client and
either prints the plan (--dry-run) or executes it.

Position codes (confirmed against live data and the retired kickbase_api
library's enum): 1=goalkeeper, 2=defender, 3=midfielder, 4=forward.
Status (`st`) 0 means fit/available; anything else (injured, suspended,
etc.) is treated as unavailable for the lineup.
"""
from __future__ import annotations

GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD = 1, 2, 3, 4

# DEF-MID-FWD counts; goalkeeper (1) is implicit and always required.
FORMATIONS = {
    "3-4-3": (3, 4, 3),
    "3-5-2": (3, 5, 2),
    "4-3-3": (4, 3, 3),
    "4-4-2": (4, 4, 2),
    "4-5-1": (4, 5, 1),
    "5-3-2": (5, 3, 2),
    "5-4-1": (5, 4, 1),
}

RISING, FALLING = 1, 2  # mvt values


def _is_available(player: dict) -> bool:
    return player.get("st", 0) == 0


def _points(player: dict) -> float:
    return player.get("ap", 0) or 0


def best_lineup(squad: list[dict]) -> tuple[str, list[str], list[dict]] | None:
    """Picks the formation + starting XI maximizing summed average points.

    Returns (formation, player_ids, bench_players) or None if the squad
    doesn't have enough fit players to fill any known formation.
    """
    by_pos: dict[int, list[dict]] = {GOALKEEPER: [], DEFENDER: [], MIDFIELDER: [], FORWARD: []}
    for player in squad:
        if _is_available(player):
            by_pos.setdefault(player.get("pos"), []).append(player)
    for group in by_pos.values():
        group.sort(key=_points, reverse=True)

    best: tuple[str, list[str], list[dict], float] | None = None
    for name, (defs, mids, fwds) in FORMATIONS.items():
        need = {GOALKEEPER: 1, DEFENDER: defs, MIDFIELDER: mids, FORWARD: fwds}
        if any(len(by_pos.get(pos, [])) < count for pos, count in need.items()):
            continue
        starters = [p for pos, count in need.items() for p in by_pos[pos][:count]]
        total = sum(_points(p) for p in starters)
        if best is None or total > best[3]:
            starter_ids = {p["i"] for p in starters}
            bench = [p for p in squad if p["i"] not in starter_ids]
            best = (name, [p["i"] for p in starters], bench, total)

    return (best[0], best[1], best[2]) if best else None


def sell_candidates(bench: list[dict], min_squad_size: int, squad_size: int) -> list[dict]:
    """Bench players with a falling market value trend, worst-trending first.

    Caps the count so the squad never drops below min_squad_size - selling
    more than that would leave too few players to field a legal lineup.
    """
    room = max(0, squad_size - min_squad_size)
    candidates = [p for p in bench if p.get("mvt") == FALLING]
    candidates.sort(key=lambda p: p.get("sdmvt", 0))  # most negative trend first
    return candidates[:room]


def buy_candidates(
    market_items: list[dict],
    budget: float,
    squad_size: int,
    max_squad_size: int,
) -> list[dict]:
    """Market listings with a rising trend, affordable, best momentum first."""
    room = max(0, max_squad_size - squad_size)
    if room == 0:
        return []
    candidates = [
        item for item in market_items
        if item.get("mvt") == RISING and (item.get("prc") or 0) <= budget and not item.get("ofc")
    ]
    candidates.sort(key=lambda p: p.get("sdmvt", 0), reverse=True)  # strongest upward trend first

    picked = []
    remaining = budget
    for item in candidates:
        price = item.get("prc") or 0
        if price <= remaining and len(picked) < room:
            picked.append(item)
            remaining -= price
    return picked
