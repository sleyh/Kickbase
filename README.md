# Kickbase transfer market watcher

Small CLI that logs into the [Kickbase v4 API](https://github.com/kevinskyba/kickbase-api-doc)
and reports what's currently on your league's transfer market, so it can be
run on a schedule (cron, systemd timer, GitHub Actions) instead of checking
the app by hand.

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
```

Credentials can be passed via `.env`/environment variables (`KICKBASE_EMAIL`,
`KICKBASE_PASSWORD`, `KICKBASE_LEAGUE_ID`) or `--email` / `--password` /
`--league-id` flags. A login token is cached under `~/.cache/kickbase/` and
reused between runs so scheduled runs don't hammer the login endpoint.

## Running it on a trigger

- **cron**: `*/5 * * * * cd /path/to/repo && .venv/bin/python -m kickbase.cli watch --once >> market.log 2>&1`
- **systemd timer**: run `watch --once` as a `oneshot` service triggered by a `.timer` unit.
- **GitHub Actions**: `.github/workflows/transfer-market.yml` runs `watch --once`
  every 15 minutes (and on manual `workflow_dispatch`). Add `KICKBASE_EMAIL`,
  `KICKBASE_PASSWORD`, and optionally `KICKBASE_LEAGUE_ID` as repository
  secrets for it to work. It caches `~/.cache/kickbase` between runs so the
  watcher can diff against the previous run's snapshot.

`watch` persists the last-seen market snapshot to
`~/.cache/kickbase/market_<leagueId>.json` and on each poll reports:

- `[NEW]` — a player was newly listed
- `[REMOVED]` — a listing disappeared (sold, bought, or withdrawn)
- `[CHANGED]` — a listing's price and/or bid count changed

## About bid counts

The upstream API doc doesn't pin down the exact field names inside a market
listing (`GET /v4/leagues/{leagueId}/market`'s `it` array) — the example
response it ships was captured with an empty market. Verified against a
live response, each item looks like:

```json
{
  "i": "2804", "fn": "Jamal", "n": "Musiala", "tid": "2",
  "pos": 3, "mv": 35254956, "prc": 35254956,
  "ofc": 0, "exs": 35624, "dt": "2026-08-17T10:08:00Z"
}
```

`ofc` is the bid/offer count, `exs` is seconds until the listing expires,
`prc`/`mv` are asking price and market value, and `n` (not `ln`) is the last
name. There's no team-name field (`tn`) in this payload, only the numeric
`tid` — `kickbase/cli.py` falls back to showing that. `market --raw` prints
the real JSON for your league if you want to double check or extend this
(`BID_COUNT_KEYS` etc. in `cli.py` still list several fallback candidates
in case the shape varies for other accounts).

## Endpoints used

| Purpose | Endpoint |
|---|---|
| Login | `POST /v4/user/login` |
| Transfer market listing | `GET /v4/leagues/{leagueId}/market` |
| Player detail | `GET /v4/leagues/{leagueId}/players/{playerId}` |

Placing/accepting/declining offers (`POST/DELETE /v4/leagues/{leagueId}/market/{playerId}/offers...`)
is documented upstream but intentionally not wired up here — this tool only
reads the market, it doesn't act on it.
