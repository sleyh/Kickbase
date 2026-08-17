# Kickbase bot

CLI that logs into the [Kickbase v4 API](https://github.com/kevinskyba/kickbase-api-doc)
to watch your league's transfer market, generate a read-only advisory
briefing, and (currently paused - see below) run an autonomous bot that
sets your lineup, lists falling-value players for sale, and bids on
rising-value market listings.

**Current mode: advisory only.** `brief` prints a summary + recommendations
across all your leagues and executes nothing. The autonomous `bot` command
still exists and works (it's what `brief`'s advice is generated from - see
`report.py`), but its scheduled GitHub Actions run is paused
(`.github/workflows/bot.yml`) until live automation is turned back on.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
# edit .env with your Kickbase login (and league ID if your account is in more than one league)
```

## Usage

```bash
# one-off snapshot, printed as a table
python -m kickbase.cli market

# one-off snapshot, raw JSON (useful to inspect the real field names,
# see "About bid counts" below)
python -m kickbase.cli market --raw

# poll every 5 minutes and print what changed since the last poll
python -m kickbase.cli watch --interval 300

# poll once and exit (what the GitHub Actions workflow uses)
python -m kickbase.cli watch --once

# print the bot's plan without touching anything
python -m kickbase.cli bot --dry-run

# run the bot for real: sets lineup, lists sales, places bids
python -m kickbase.cli bot

# read-only summary + advice across all leagues on the account, no execution
python -m kickbase.cli brief
```

Credentials can be passed via `.env`/environment variables (`KICKBASE_EMAIL`,
`KICKBASE_PASSWORD`, `KICKBASE_LEAGUE_ID`) or `--email` / `--password` /
`--league-id` flags. A login token is cached under `~/.cache/kickbase/` and
reused between runs so scheduled runs don't hammer the login endpoint.

## Running it on a trigger

- **cron**: `*/5 * * * * cd /path/to/repo && .venv/bin/python -m kickbase.cli watch --once >> market.log 2>&1`
- **systemd timer**: run `watch --once` as a `oneshot` service triggered by a `.timer` unit.
- **GitHub Actions**: `.github/workflows/transfer-market.yml` runs `watch --once`
  every 15 minutes, and `.github/workflows/bot.yml` runs `bot` (live, not
  `--dry-run`) every hour — both also support manual `workflow_dispatch`.
  Add `KICKBASE_EMAIL`, `KICKBASE_PASSWORD`, and optionally
  `KICKBASE_LEAGUE_ID` as repository secrets for either to work. Both cache
  `~/.cache/kickbase` between runs (the watcher needs it to diff against the
  previous snapshot; the bot doesn't strictly need it but it saves a login
  round-trip each hour).

`watch` persists the last-seen market snapshot to
`~/.cache/kickbase/market_<leagueId>.json` and on each poll reports:

- `[NEW]` — a player was newly listed
- `[REMOVED]` — a listing disappeared (sold, bought, or withdrawn)
- `[CHANGED]` — a listing's price and/or bid count changed

## The briefing

`brief` (`kickbase/report.py`) is the current default way to use this:
read-only, no write endpoint ever called. Scoped to one league by default
(`--league-id` / `KICKBASE_LEAGUE_ID`, same as `market`/`bot`; pass
`--all-leagues` to cover every league on the account instead), it reuses
the exact same decision logic the bot would act on (`strategy.py`/`predict.py`)
and prints it as advice instead of executing it — lineup recommendation,
sell/buy candidates with the reasoning behind each, and a "rising but out
of budget/room" watchlist.

Intended to run six times a day (6am, 10am, 2pm, 6pm, 8pm, midnight) and
eventually push straight to a Telegram channel instead of stdout — not
wired up yet; for now the plan is to keep iterating on the message content
here before adding that integration.

## The bot

`bot` runs one full cycle: fetch squad + budget + market, decide, act.
`--dry-run` prints the plan without calling any write endpoint — always run
that first on an unfamiliar squad/league before letting it execute for real.

**Lineup.** Tries every standard formation (`3-4-3` through `5-4-1`,
goalkeeper implicit) against your fit squad (`kickbase/strategy.py`'s
`FORMATIONS`), picks whichever fills all its slots and maximizes total
average points (`ap`), and submits it via `POST /v4/leagues/{leagueId}/lineup`.
Players with a non-zero status (`st`) — injured, suspended, etc. — are
excluded from selection entirely.

**Sell.** Bench players (not in the chosen lineup) with a falling market
value trend (`mvt == 2`), worst trend first, capped so the squad never
drops below 11 players (you can't field a lineup with fewer). Split into
two tiers:
- **Instant-sell to Kickbase** (`DELETE`-free single `POST
  /v4/leagues/{leagueId}/market/{playerId}/sell` call — despite the doc
  describing a two-step offer/accept flow, live testing showed one POST
  completes the sale immediately: player removed from squad, budget
  credited on the spot) for players with 0 average points — dead weight
  nobody's likely to bid on anyway, so take the guaranteed sale now rather
  than waiting.
- **List on the market** (`POST /v4/leagues/{leagueId}/market`) for
  players still scoring points — a real bid might beat Kickbase's price,
  so these wait. Listing doesn't remove them from your squad immediately;
  the slot only frees up once someone actually buys them, unlike an
  instant sell.

**Bid.** Market listings with a rising trend (`mvt == 1`) that fit in
remaining budget and squad space, strongest signal first (see "Prediction"
below), get a bid at the full asking price (`prc`) — not shaded up or down.
See "About bid counts" below for why: this API doesn't expose competing
bids, so there's no signal to bid strategically against, only whether
you're willing to pay the asking price or not. Listings that already show
an offer (`ofc > 0`, possibly from someone else, invisibly) are skipped
rather than contested blind.

## Prediction

`kickbase/predict.py` is the ranking signal behind buy/sell ordering, and
it's honest about what it currently is: **not a trained model** - a
transparent, hand-weighted combination of real signals, not something
fitted to historical (features → outcome) examples.

**Correction:** an earlier version of this section claimed Kickbase
exposes no historical market-value time series and built a workaround
(comparing our own sporadic snapshots) instead. That was wrong - `GET
/v4/leagues/{leagueId}/players/{playerId}/marketValue/{timeframe}`
(`client.get_market_value_history()`) returns real daily value history
for up to a year, for any player, owned or not. That's what the app's own
24h/7d charts are built from, and what this now uses instead of the
workaround.

What's there today:
- `history_deltas()` — turns a `get_market_value_history()` response into
  actual observed `{"d1": 24h change, "d7": 7-day change}`.
  `cli._enrich_with_history()` fetches this for every squad/market player
  before ranking (one extra request per player - adds a few seconds to
  `bot`/`brief`, not something to do more often than a few times a day).
- `momentum_score()` — ranks buy candidates: real 7-day delta (`d7`) when
  available, scaled up for players also producing points (`ap`) - a rise
  backed by real performance is more likely to continue than one that
  isn't. Falls back to `sdmvt` (present on squad items only, never market
  listings) and finally points alone if no delta is available at all (a
  player too new to have value history yet).
- `decline_urgency()` — ranks sell candidates the opposite way: a falling
  player still producing points is treated as *less* urgent to sell than
  the same decline with nothing behind it, since it reads more like a
  temporary dip. Same `d7` → `sdmvt` → points-only fallback order.
- `record_snapshot()` — logs every squad + market player's features
  (`mv`, `mvt`, `sdmvt`, `tfhmvt`, `ap`, `p`, day) to a local SQLite
  database (`~/.cache/kickbase/history.db`) on every bot/brief run. Kept
  for a different purpose than the market-value history above: Kickbase's
  own history endpoint gives value over time, but not the *other* features
  (points, status) aligned to those same days. This is what building that
  combined dataset ourselves, one run at a time, would look like - for
  whenever a real regression model is worth training on it.
  `load_history()` reads it back per-player.

None of this is claimed to be an "optimal" strategy — it's a small set of
explicit, readable rules in `strategy.py`/`predict.py` (pure functions, no network calls)
that you can read end to end and adjust. There are no spending caps beyond
"can't overdraw the budget and can't exceed the league's max squad size" —
review a `--dry-run` plan before your first live run, and after any change
to the strategy, since a bad rule spends real budget with nothing to undo it.

## About bid counts

The upstream API doc doesn't pin down the exact field names inside a market
listing (`GET /v4/leagues/{leagueId}/market`'s `it` array) — the example
response it ships was captured with an empty market. Verified against a
live response, each item looks like:

```json
{
  "i": "3232", "fn": "Luca", "n": "Pfeiffer", "tid": "77",
  "pos": 4, "mv": 4698937, "prc": 4698937,
  "ofc": 1, "exs": 2896, "uop": 4698937, "uoid": "1442868",
  "ofs": [{"u": "1442868", "unm": "Simon", "uop": 4698937, "st": 0}],
  "dt": "2026-08-17T10:08:00Z"
}
```

`exs` is seconds until the listing expires, `prc`/`mv` are asking price and
market value, and `n` (not `ln`) is the last name. There's no team-name
field (`tn`) in this payload, only the numeric `tid` — the CLI falls back to
showing that.

**Important caveat, confirmed by live testing with two accounts bidding on
the same player:** `ofc`/`ofs`/`uop`/`uoid` do **not** reflect the total
bids on a listing — they reflect only *your own* offer. Two managers bid on
the same player in testing; each account's own `/market` call showed `ofc: 1`
with only their own offer in `ofs`, never the other's. Checked against every
other endpoint that touches offers (`/players/{playerId}/transfers`, the
player-detail endpoint) and the retired v3 API (now `404`, fully gone) —
same result everywhere. This looks like deliberate sealed-bid design (you
find out only when a listing resolves, not who else is bidding or for how
much), not a gap in this tool. So "Bids"/"Top Bid" in the `market` table
mean "your own bid," not "how many people are bidding." `market --raw`
prints the real JSON for your league if you want to double check.

## Endpoints used

| Purpose | Endpoint |
|---|---|
| Login | `POST /v4/user/login` |
| Transfer market listing | `GET /v4/leagues/{leagueId}/market` |
| Player detail | `GET /v4/leagues/{leagueId}/players/{playerId}` |
| Player market value history (24h/7d/etc.) | `GET /v4/leagues/{leagueId}/players/{playerId}/marketValue/{timeframe}` |
| Owned squad | `GET /v4/leagues/{leagueId}/squad` |
| Budget | `GET /v4/leagues/{leagueId}/me/budget` |
| Get/set lineup | `GET`/`POST /v4/leagues/{leagueId}/lineup` |
| List a player for sale | `POST /v4/leagues/{leagueId}/market` |
| Instant-sell to Kickbase | `POST /v4/leagues/{leagueId}/market/{playerId}/sell` |
| Place a bid | `POST /v4/leagues/{leagueId}/market/{playerId}/offers` |

Accepting/declining *manager* offers (`POST/DELETE
/v4/leagues/{leagueId}/market/{playerId}/offers/{offerId}/accept|decline`)
is documented upstream but not wired up — nothing here currently needs to
respond to an incoming offer on your own listings.
