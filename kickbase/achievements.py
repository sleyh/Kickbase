"""Kickbase's league-achievement catalog and public-data inference rules.

Achievement completion and rewards are user-scoped only
(client.get_achievements()) - there is no /managers/{managerId}/achievements
endpoint, confirmed against the API doc's own OpenAPI spec. So a
competitor's achievement status can never be read directly. But most of
the catalog's thresholds are expressed against data that IS public per
manager: league member count, a manager's own transfer count, their
squad value, their season/matchday points (client.get_manager_performance()),
or their per-player point totals (client.get_manager_squad()'s "p"
field). This catalog was pulled live via
client.get_achievements()/get_achievement_detail() against a real
account (45 types total) - not guessed or hardcoded from documentation -
and each entry below is annotated with an inference rule where the
threshold can be checked from public data, or None where it genuinely
can't.

Correction: an earlier version of this module (and the README) claimed
performance-based achievements were entirely uninferable because
"no per-manager matchday data exists via this API." That was wrong -
get_manager_dashboard()/get_manager_performance() are per-manager
endpoints, not user-scoped, and were already being used elsewhere in
this project before this correction. The season/matchday/per-player
point tiers below are inferred from them. They all read zero right now
because this league is pre-season (no matchdays played yet), not
because the data is hidden - once real matches happen, ManagerStats
should be re-verified against however Kickbase's own UI actually
reports these numbers, since none of it has been validated against a
real non-zero value yet.

Two entries are known impostors, excluded on purpose: "Panini" (set your
profile picture) and "Choreo" (set your background picture) both show
ac=1 and a nonzero "er", but their "dt" is 2019-08-03 - years before any
current league existed. They're old account-level achievements bleeding
through into the per-league achievement list, not real per-league
rewards. Confirmed empirically: including their combined 200,000 in a
budget reconstruction overshot a known-real budget by exactly 200,000;
excluding them landed the reconstruction on the exact dollar.

Still genuinely not inferable, and why:
- Top scorer / Match winner / World class / Football god ("score X points
  with a player") - squad items carry a "p" field, but it's a leftover
  from the *previous* real-world season, not points scored this fantasy
  season while owned by the manager (confirmed live: checked before this
  season's first real match and a squad player already showed "p": 2789).
  Using it directly would overcount for nearly everyone immediately -
  disabled (infer=None) until a season-scoped, ownership-scoped points
  source is found.
- MVP ("own the best player of a match day") needs to know who the
  single best-scoring player across the *entire* competition was that
  day, not just within a manager's own squad - no endpoint found for that.
- Goal machine ("your players scored most goals in your league") needs a
  goals total per manager compared against every other manager's - doable
  in principle by summing squad players' goal counts once that field is
  confirmed populated, but not yet built or verified.
- Champion / Runner-up only resolve at the very end of a season from
  final standings, not something meaningfully "inferred" mid-season.
- Long bench ("have a team with 25 players") is structurally unreachable
  in a league whose squad cap is under 25 (this one's is 16, from
  get_league's "mppu") - not worth an inference rule.
- Manager license pays 0 reward regardless, so it's irrelevant either way.
"""
from __future__ import annotations

from dataclasses import dataclass, fields

INFER_LEAGUE_SIZE = "league_size"
INFER_TRANSFER_COUNT = "transfer_count"
INFER_SQUAD_VALUE = "squad_value"
INFER_SEASON_POINTS = "season_points"
INFER_MATCHDAY_WINS = "matchday_wins"
INFER_MAX_MATCHDAY_POINTS = "max_matchday_points"
INFER_MAX_PLAYER_POINTS = "max_player_points"
INFER_MAX_COMPUTER_PROFIT = "max_computer_market_profit"


@dataclass(frozen=True)
class ManagerStats:
    """Everything achievement inference needs about one manager, all from
    public endpoints - see cli._collect_manager_stats().
    """
    league_size: int = 0
    transfer_count: int = 0
    squad_value: float = 0
    season_points: int = 0
    matchday_wins: int = 0
    max_matchday_points: int = 0
    max_player_points: int = 0
    max_computer_market_profit: int = 0


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
    # --- Publicly inferable: season total points (get_manager_performance()'s "tp") ---
    Achievement(200, "Season points bronze", "Score at least 1,000 points during a season", 100_000, INFER_SEASON_POINTS, 1_000),
    Achievement(201, "Season points silver", "Score at least 5,000 points during a season", 250_000, INFER_SEASON_POINTS, 5_000),
    Achievement(202, "Season points gold", "Score at least 15,000 points during a season", 500_000, INFER_SEASON_POINTS, 15_000),
    Achievement(203, "Season points platinum", "Score at least 30,000 points during a season", 1_000_000, INFER_SEASON_POINTS, 30_000),
    Achievement(204, "World cup winner", "Score at least 40,000 points during a season", 2_000_000, INFER_SEASON_POINTS, 40_000),
    # --- Publicly inferable: matchday win count (get_manager_performance()'s "mdw") ---
    Achievement(5, "Match day winner", "Win the match day", 1_000_000, INFER_MATCHDAY_WINS, 1),
    Achievement(1, "Match day winner bronze", "Win the match day 3 times in a season", 500_000, INFER_MATCHDAY_WINS, 3),
    Achievement(2, "Match day winner silver", "Win the match day 5 times in a season", 1_000_000, INFER_MATCHDAY_WINS, 5),
    Achievement(3, "Match day winner gold", "Win the match day 10 times in a season", 1_500_000, INFER_MATCHDAY_WINS, 10),
    Achievement(4, "The Special One", "Win the match day 25 times in a season", 2_000_000, INFER_MATCHDAY_WINS, 25),
    # --- Publicly inferable: best single-matchday points (max of performance's per-day "mdp") ---
    Achievement(100, "Match day points bronze", "Score at least 500 points during a match day", 100_000, INFER_MAX_MATCHDAY_POINTS, 500),
    Achievement(101, "Match day points silver", "Score at least 1000 points during a match day", 250_000, INFER_MAX_MATCHDAY_POINTS, 1_000),
    Achievement(102, "Match day points gold", "Score at least 1500 points during a match day", 1_000_000, INFER_MAX_MATCHDAY_POINTS, 1_500),
    Achievement(103, "Match of the century", "Score at least 2000 points during a match day", 2_000_000, INFER_MAX_MATCHDAY_POINTS, 2_000),
    # --- NOT reliably inferable, despite squad items carrying a "p" field: confirmed live that
    # "p" is a leftover from the *previous* real-world season (checked a squad on 2026-08-19,
    # before the 2026/27 season's day-1 match on 2026-08-28 - one player already showed "p": 2789),
    # not points scored this fantasy season while owned by the manager. Using it directly would
    # systematically overcount "score X points with a player" for nearly everyone immediately -
    # exactly the overstating this module is supposed to never do. Needs a season-scoped,
    # ownership-scoped points source that doesn't exist yet (or hasn't been found yet).
    Achievement(300, "Top scorer", "Score at least 200 points with a player", 100_000, None, 200),
    Achievement(301, "Match winner", "Score at least 300 points with a player", 500_000, None, 300),
    Achievement(302, "World class", "Score at least 400 points with a player", 1_000_000, None, 400),
    Achievement(303, "Football god", "Score at least 500 points with a player", 2_000_000, None, 500),
    # --- Publicly inferable: best profit on a single computer-market buy+sell pair ---
    Achievement(700, "The right touch", "Yield 1 mil profit with a player. No transfers between managers.", 100_000, INFER_MAX_COMPUTER_PROFIT, 1_000_000),
    Achievement(701, "Bronze hand", "Yield 3 mil profit with a player. No transfers between managers.", 250_000, INFER_MAX_COMPUTER_PROFIT, 3_000_000),
    Achievement(702, "Silver hand", "Yield 5 mil profit with a player. No transfers between managers.", 500_000, INFER_MAX_COMPUTER_PROFIT, 5_000_000),
    Achievement(703, "Golden hand", "Yield 10 mil profit with a player. No transfers between managers.", 1_000_000, INFER_MAX_COMPUTER_PROFIT, 10_000_000),
    Achievement(704, "Royal transfer", "Yield 25 mil profit with a player. No transfers between managers.", 2_000_000, INFER_MAX_COMPUTER_PROFIT, 25_000_000),
    # --- Not (yet) publicly inferable - see module docstring for why each one ---
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


def infer_unlocked(stats: ManagerStats) -> list[Achievement]:
    """Every publicly-inferable achievement whose threshold is met, given
    a manager's own stats bundle (transfer count, squad value, season/
    matchday points, best single-player points, best computer-market
    profit) plus the league's member count. A lower bound on their real
    unlocked set - achievements without an inference rule (see module
    docstring) are always omitted, so this can undercount but never
    overstate.
    """
    values = {f.name: getattr(stats, f.name) for f in fields(stats)}
    return [a for a in CATALOG if a.infer and values.get(a.infer, 0) >= a.threshold]
