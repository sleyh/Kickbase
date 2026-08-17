# Kickbase bot

CLI that logs into the [Kickbase v4 API](https://github.com/kevinskyba/kickbase-api-doc)
to (a) watch your league's transfer market and (b) run an autonomous bot
that sets your lineup, lists falling-value players for sale, and bids on
rising-value market listings — meant to run unattended on a schedule (cron,
systemd timer, GitHub Actions).

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
remaining budget and squad space, strongest trend first, get a bid at the
full asking price (`prc`) — not shaded up or down. See "About bid counts"
below for why: this API doesn't expose competing bids, so there's no signal
to bid strategically against, only whether you're willing to pay the asking
price or not. Listings that already show an offer (`ofc > 0`, possibly from
someone else, invisibly) are skipped rather than contested blind.

None of this is claimed to be an "optimal" strategy — it's a small set of
explicit, readable rules in `strategy.py` (pure functions, no network calls)
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

Placing/accepting/declining offers (`POST/DELETE /v4/leagues/{leagueId}/market/{playerId}/offers...`)
is documented upstream but intentionally not wired up here — this tool only
reads the market, it doesn't act on it.
