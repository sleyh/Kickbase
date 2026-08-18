"""Kickbase's league-achievement catalog and public-data inference rules.

Achievement completion and rewards are user-scoped only
(client.get_achievements()) - there is no /managers/{managerId}/achievements
endpoint, confirmed against the API doc's own OpenAPI spec. So a
competitor's achievement status can never be read directly. But most of
the *milestone* achievements (not the season-performance ones, which need
live per-manager matchday points/wins this API doesn't expose at all,
before or after a season starts) have a threshold expressed against data
that IS public: league member count, a manager's own transfer count, or
their squad value. This catalog was pulled live via
client.get_achievements()/get_achievement_detail() against a real
account (45 types total) - not guessed or hardcoded from documentation -
and each entry below is annotated with an inference rule where the
threshold can be checked from public data, or None where it can't.

Two entries are known impostors, excluded on purpose: "Panini" (set your
profile picture) and "Choreo" (set your background picture) both show
ac=1 and a nonzero "er", but their "dt" is 2019-08-03 - years before any
current league existed. They're old account-level achievements bleeding
through into the per-league achievement list, not real per-league
rewards. Confirmed empirically: including their combined 200,000 in a
budget reconstruction overshot a known-real budget by exactly 200,000;
excluding them landed the reconstruction on the exact dollar.
"""
from __future__ import annotations

from dataclasses import dataclass

INFER_LEAGUE_SIZE = "league_size"
INFER_TRANSFER_COUNT = "transfer_count"
INFER_SQUAD_VALUE = "squad_value"


@dataclass(frozen=True)
class Achievement:
    type_id: int
    name: str
    description: str
    reward: int
    infer: str | None  # one of the INFER_* constants above, or None if not publicly inferable
    threshold: int | None


CATALOG: list[Achievement] = [
    # --- Publicly inferable: league member count ---
    Achievement(600, "Kreisliga", "Your league has at least 3 managers", 1_000_000, INFER_LEAGUE_SIZE, 3),
    Achievement(601, "Regionalliga", "Your league has at least 6 managers", 1_000_000, INFER_LEAGUE_SIZE, 6),
    Achievement(602, "2. Liga", "Your league has at least 12 managers", 1_000_000, INFER_LEAGUE_SIZE, 12),
    Achievement(603, "1. Liga", "Your league has at least 18 managers", 1_000_000, INFER_LEAGUE_SIZE, 18),
    # --- Publicly inferable: a manager's own total transfer count ---
    Achievement(500, "First deal", "Sell or buy 1 player during a season", 100_000, INFER_TRANSFER_COUNT, 1),
    Achievement(501, "Transfer King bronze", "Sell or buy 50 players during a season", 250_000, INFER_TRANSFER_COUNT, 50),
    Achievement(502, "Transfer King silver", "Sell or buy 250 players during a season", 500_000, INFER_TRANSFER_COUNT, 250),
    Achievement(503, "Transfer King gold", "Sell or buy 500 players during a season", 1_000_000, INFER_TRANSFER_COUNT, 500),
    Achievement(504, "F. Magath", "Sell or buy 1000 players during a season", 2_000_000, INFER_TRANSFER_COUNT, 1000),
    # --- Publicly inferable: a manager's current squad value ---
    Achievement(400, "Team value bronze", "Own a team with a value of 125 mil.", 100_000, INFER_SQUAD_VALUE, 125_000_000),
    Achievement(401, "Team value silver", "Own a team with a value of 150 mil.", 250_000, INFER_SQUAD_VALUE, 150_000_000),
    Achievement(402, "Team value gold", "Own a team with a value of 200 mil.", 500_000, INFER_SQUAD_VALUE, 200_000_000),
    Achievement(403, "Team value platinum", "Own a team with a value of 250 mil.", 1_000_000, INFER_SQUAD_VALUE, 250_000_000),
    Achievement(404, "The Galactics", "Own a team with a value of 350 mil.", 2_000_000, INFER_SQUAD_VALUE, 350_000_000),
    # --- Not publicly inferable: needs live per-manager matchday points/wins/profit-per-player this API doesn't expose ---
    Achievement(5, "Match day winner", "Win the match day", 1_000_000, None, None),
    Achievement(1, "Match day winner bronze", "Win the match day 3 times in a season", 500_000, None, None),
    Achievement(2, "Match day winner silver", "Win the match day 5 times in a season", 1_000_000, None, None),
    Achievement(3, "Match day winner gold", "Win the match day 10 times in a season", 1_500_000, None, None),
    Achievement(4, "The Special One", "Win the match day 25 times in a season", 2_000_000, None, None),
    Achievement(100, "Match day points bronze", "Score at least 500 points during a match day", 100_000, None, None),
    Achievement(101, "Match day points silver", "Score at least 1000 points during a match day", 250_000, None, None),
    Achievement(102, "Match day points gold", "Score at least 1500 points during a match day", 1_000_000, None, None),
    Achievement(103, "Match of the century", "Score at least 2000 points during a match day", 2_000_000, None, None),
    Achievement(200, "Season points bronze", "Score at least 1,000 points during a season", 100_000, None, None),
    Achievement(201, "Season points silver", "Score at least 5,000 points during a season", 250_000, None, None),
    Achievement(202, "Season points gold", "Score at least 15,000 points during a season", 500_000, None, None),
    Achievement(203, "Season points platinum", "Score at least 30,000 points during a season", 1_000_000, None, None),
    Achievement(204, "World cup winner", "Score at least 40,000 points during a season", 2_000_000, None, None),
    Achievement(300, "Top scorer", "Score at least 200 points with a player", 100_000, None, None),
    Achievement(301, "Match winner", "Score at least 300 points with a player", 500_000, None, None),
    Achievement(302, "World class", "Score at least 400 points with a player", 1_000_000, None, None),
    Achievement(303, "Football god", "Score at least 500 points with a player", 2_000_000, None, None),
    Achievement(700, "The right touch", "Yield 1 mil profit with a player. No transfers between managers.", 100_000, None, None),
    Achievement(701, "Bronze hand", "Yield 3 mil profit with a player. No transfers between managers.", 250_000, None, None),
    Achievement(702, "Silver hand", "Yield 5 mil profit with a player. No transfers between managers.", 500_000, None, None),
    Achievement(703, "Golden hand", "Yield 10 mil profit with a player. No transfers between managers.", 1_000_000, None, None),
    Achievement(704, "Royal transfer", "Yield 25 mil profit with a player. No transfers between managers.", 2_000_000, None, None),
    Achievement(900, "Manager license", "Get the manager license", 0, None, None),
    Achievement(2001, "Champion", "Win the championship", 2_000_000, None, None),
    Achievement(2002, "Runner-up", "Become second in your league", 1_000_000, None, None),
    Achievement(3000, "Long bench", "Have a team with 25 players", 100_000, None, None),
    Achievement(5001, "MVP", "Own the best player of a match day", 1_000_000, None, None),
    Achievement(7502, "Goal machine", "Your players scored most goals in your league", 250_000, None, None),
    # --- Excluded on purpose: account-level, not real per-league rewards (see module docstring) ---
    # Achievement(4000, "Panini", "Set your profile picture", 100_000, None, None),
    # Achievement(4001, "Choreo", "Set your background picture", 100_000, None, None),
]


def infer_unlocked(league_size: int, transfer_count: int, squad_value: float) -> list[Achievement]:
    """Every publicly-inferable achievement whose threshold is met, given
    a manager's own transfer count and squad value plus the league's
    member count. A lower bound on their real unlocked set - performance-
    based achievements (points, wins, per-player profit) can't be checked
    this way and are always omitted here, so this never overstates.
    """
    values = {
        INFER_LEAGUE_SIZE: league_size,
        INFER_TRANSFER_COUNT: transfer_count,
        INFER_SQUAD_VALUE: squad_value,
    }
    return [a for a in CATALOG if a.infer and values[a.infer] >= a.threshold]
