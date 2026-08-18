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

# single poll: push a Telegram card for any newly-listed notable player
# since the last run (what the GitHub Actions workflow uses, every 15 min)
python -m kickbase.cli alert --telegram

# daily recap: each squad player's 24h value change + total gain/loss,
# plus every competitor's squad value and gain/loss
python -m kickbase.cli squad-value --telegram

# same, but skip fetching competitor squads (faster)
python -m kickbase.cli squad-value --telegram --no-competitors

# on-demand: who pays close to asking price vs who overspends, per league member
python -m kickbase.cli transfer-analysis
```

Credentials can be passed via `.env`/environment variables (`KICKBASE_EMAIL`,
`KICKBASE_PASSWORD`, `KICKBASE_LEAGUE_ID`) or `--email` / `--password` /
`--league-id` flags. A login token is cached under `~/.cache/kickbase/` and
reused between runs so scheduled runs don't hammer the login endpoint.

## Running it on a trigger

- **cron**: `*/5 * * * * cd /path/to/repo && .venv/bin/python -m kickbase.cli watch --once >> market.log 2>&1`
- **systemd timer**: run `watch --once` as a `oneshot` service triggered by a `.timer` unit.
- **GitHub Actions**: four workflows, all needing `KICKBASE_EMAIL`,
  `KICKBASE_PASSWORD`, and `KICKBASE_LEAGUE_ID` as repository secrets
  (Settings → Secrets and variables → Actions → New repository secret on
  the repo) to actually run. All four also support manual
  `workflow_dispatch` for an on-demand run.
  - `transfer-market.yml` — every 15 minutes: `watch --once` (logs
    `[NEW]`/`[REMOVED]`/`[CHANGED]` to the Action's own output, see
    below), then `alert --telegram` (see "Real-time alerts" below) on the
    same run - no separate cron, so this costs nothing beyond what the
    workflow was already spending.
  - `bot.yml` — `bot` (live, not `--dry-run`). **Schedule currently
    paused** (rolled back to advisory-only, see "The briefing" below) —
    only runs on manual trigger until the `schedule:` block is restored.
  - `brief.yml` — `brief --telegram`, at 6am/10am/2pm/6pm/8pm/midnight
    Europe/Berlin time (cron is UTC-fixed; the file has a comment on
    adjusting for DST).
  - `squad-value.yml` — `squad-value --telegram`, once daily at 10pm
    Europe/Berlin (see "Daily squad value update" below).

  `brief.yml` and `squad-value.yml` also need
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` as repository secrets to
  actually push anywhere.

  All four cache `~/.cache/kickbase` between runs.

`watch` persists the last-seen market snapshot to
`~/.cache/kickbase/market_<leagueId>.json` and on each poll reports:

- `[NEW]` — a player was newly listed
- `[REMOVED]` — a listing disappeared (sold, bought, or withdrawn)
- `[CHANGED]` — a listing's price and/or bid count changed

## Real-time alerts

`alert` is what actually gets a new listing to your phone quickly, instead
of waiting for the next scheduled `brief`. Kickbase's API has no
webhook/push mechanism, so "real-time" here means "polled often enough
that the delay is small" - every 15 minutes via the `transfer-market.yml`
cron already described above, not a dedicated always-on server.

Each run is a single poll that diffs the market against the previous
run's snapshot (`~/.cache/kickbase/alert_seen_<leagueId>.json`, kept
separate from `watch`'s own snapshot file so the two commands never reset
each other's baseline) and sends one compact Telegram card - photo, price,
avg points, value trend, deadline, and a Transfermarkt button - for each
newly-appeared listing that's actually worth knowing about
(`strategy.is_notable_listing()`: a rising trend, or real average points;
this cuts out the falling/zero-point dead weight that's most of what the
computer market churns through). Manager listings are skipped, same as
`brief`. The very first run for a league only saves a baseline - nothing
alerts until there's a previous snapshot to diff against, otherwise every
listing already on the market would fire as "new" the moment this turns on.

**Cost/latency tradeoff:** GitHub Actions bills by the minute per job
regardless of how short the actual run is, so a 15-minute cron is ~96
runs/day - comfortably inside the free tier's 2,000 min/month for a
private repo alongside `brief.yml`'s much lighter schedule, but a much
tighter cron (e.g. every 5 minutes) would burn through that budget fast.
Given listings stay open for hours, not seconds, 15 minutes of latency
captures nearly all the practical benefit; true sub-minute alerts would
need an always-on polling process instead of a scheduled one.

**Your own bid tracking** rides the same poll (`cli._track_my_bids()`,
state in `~/.cache/kickbase/my_bids_<leagueId>.json`). Each run diffs your
account's currently active offers - the market's `uop`/`uoid` fields,
which only ever reflect your own offer (see "Important caveat" below) -
against the previous run, and sends a Telegram card for:

- **placed** - a new offer appeared that wasn't tracked last poll
- **updated** - a tracked offer's amount changed (you re-bid)
- **won** - a tracked offer's listing is gone from the market *and* the
  player is now in your squad
- **lost** - a tracked offer's listing is gone from the market and the
  player isn't in your squad (someone else won it, or - per the sealed-bid
  findings below - it went unsold because the bid wasn't enough)

This reads your account's own offer state from the API, not anything this
tool itself wrote, so it catches bids placed through the Kickbase app
directly, not just ones placed via `bot`/manual testing - confirmed live:
a real in-app bid on Vitalie Becker showed up as a "placed" alert with no
CLI involvement in placing it. Like the new-listing alert, the first-ever
run only baselines (no alerts) so pre-existing bids at feature-launch
don't all fire as "new."

## Daily squad value update

`squad-value` is a separate daily recap from `brief` - not advice, just
"what did today's market-value update do to what I already own." Fires
once a day at 10pm Europe/Berlin (`squad-value.yml`), timed to land after
Kickbase's own daily value recalculation.

For each owned player it shows the real 24h change (`d1`, from the same
market-value-history endpoint `brief` uses - see "Endpoints used" below),
sorted best mover first, plus the day's total gain/loss summed across the
whole squad, current budget, current squad value, and net worth (budget +
squad value) - a big sale grows budget while shrinking squad value, so
neither number alone says whether you're actually doing better. A player
with no history yet (just bought, nothing to diff against) is listed
separately rather than silently dropped. Text-only Telegram message, no
photo - a per-player list like this doesn't map to a single
featured-player card the way `brief`'s digest does.

**Competitors.** The message also includes every other league member's
squad value and today's gain/loss, ranked best to worst -
`cli._fetch_competitors()`. This corrects an earlier, wrong conclusion in
this README: initial probing found only `/v4/leagues/{leagueId}/ranking`
(whose team-value field is `0.0` for everyone, including my own
78m-value squad - not real data) and a `squad?userId=` parameter that
turned out to be silently ignored, always returning your own squad
regardless of the id passed. Both looked like confirmation that
competitor squads were walled off entirely, the same way bids are.
They're not - re-reading the API doc's actual OpenAPI spec (not just
skimming the README) surfaced `GET
/v4/leagues/{leagueId}/managers/{managerId}/squad`, missed on the first
pass because it's nested under `managers/`, not the `squad`/`users` paths
tried first. Confirmed live: returns a real, distinct squad per manager
id from `ranking`'s member list. Player items there use `pi`/`pn`
instead of `get_squad()`'s `i`/`fn`+`n` - normalized in
`cli._normalize_manager_squad_items()` so the same history-enrichment and
display helpers work on them unchanged. One extra `get_market_value_history`
call per competitor player (~10-13 players × 6 competitors here), so this
adds real runtime to the daily job (~15s total) but nothing outsized for
a once-a-day cron; `--no-competitors` skips it if that's ever a problem.

## Transfer spending analysis

`transfer-analysis` answers "who overpays and who pays close to asking
price" - on-demand only, no scheduled workflow calls it, since it's an
investigative tool rather than a daily digest.

The sealed-bid design (see below) hides competing bids completely while a
listing is open - nobody, including this tool, can see what anyone else
is bidding in real time. But `GET
/v4/leagues/{leagueId}/managers/{managerId}/transfer` (found by reading
the API doc's OpenAPI spec, same as the manager-squad endpoint above)
exposes every completed transfer *after the fact*: `tty` is 1 for a buy
and 2 for a sale, and `othnm` carries the other party's name whenever it
was a real manager rather than Kickbase - confirmed live by finding the
exact same trade (player, price, timestamp) mirrored on both sides: one
manager's log showed `tty:2, othnm:"Igor Pamic"` for a sale, and Igor
Pamic's own log showed the identical trade as `tty:1, othnm:"kicktoph"`.
So a sealed bid stops being sealed the moment it resolves - you just
can't see it coming.

`cli._build_spending_profiles()` takes every buy (`tty:1`) from each
manager's log and compares the price paid (`trp`) against that player's
*current* market value - a reasonable proxy here since this league is
only days old and every transfer in it is recent, not a general
historical-price reconstruction (there's no endpoint for a player's mv on
an arbitrary past date, only the recent daily series `brief` already
uses). Buys are split into computer-market (`othnm` absent) and
manager-to-manager (`othnm` present): only the former feeds each
manager's average "premium %" and qualitative label (pays close to
asking price / a moderate premium / tends to overspend - thresholds in
`report._spending_label()`, not yet tuned against real behavior), since
there are usually too few manager-to-manager trades per person for an
average to mean anything, and that price reflects a human negotiation
rather than beating a sealed-bid field. Manager-to-manager trades are
listed individually instead. Live test showed real, useful spread - one
manager averaging +20% over value on computer buys against others
clustered around +4-12%.

## The briefing

`brief` (`kickbase/report.py`) is the current default way to use this:
read-only, no write endpoint ever called. Scoped to one league by default
(`--league-id` / `KICKBASE_LEAGUE_ID`, same as `market`/`bot`; pass
`--all-leagues` to cover every league on the account instead), it reuses
the exact same decision logic the bot would act on (`strategy.py`/`predict.py`)
and prints it as advice instead of executing it — lineup recommendation,
sell/buy candidates with the reasoning behind each, a "top performers"
list (best avg/total points on the market right now, independent of
value trend or affordability — the earlier trend-only ranking could miss
an established, proven performer like a league MVP whose price is simply
flat or out of reach), and a "rising but out of budget/room" watchlist.
All three market-driven sections only ever consider computer-generated
listings (see "Seller identity" below) — a real manager's asking price
isn't a signal about the player, just about what that manager wants.

Runs six times a day (6am, 10am, 2pm, 6pm, 8pm, midnight Europe/Berlin) via
`.github/workflows/brief.yml`, and pushes to a Telegram channel via
`--telegram` (`kickbase/telegram.py`).

**Telegram setup:**
1. Get your bot's token from [@BotFather](https://t.me/BotFather) (`/mybots` → pick the bot → API Token).
2. Add the bot as an **administrator** of the target channel, with "Post Messages" permission.
3. Post any message in the channel, then call `GET https://api.telegram.org/bot<TOKEN>/getUpdates` —
   the response includes a `my_chat_member` (or `channel_post`) update with the channel's numeric `chat.id`
   (negative, e.g. `-1003685452737`).
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` — in `.env` for local runs, or as GitHub Actions
   repository secrets (alongside the `KICKBASE_*` ones) for the scheduled workflow.

**Rich formatting.** `--telegram` sends more than the plain digest per league:
1. A **photo** of the strongest signal (top buy candidate, else top performer, else a sell
   candidate if there's nothing else) from Kickbase's own CDN, with a short HTML caption.
2. The **full digest** as an HTML-formatted message.
3. An **inline keyboard** — one link button per player mentioned (buy candidates, then top
   performers, then sell candidates, capped at 8), opening that player's Transfermarkt search page.

These are link buttons, not action buttons — tapping one opens a URL, nothing more. A real
"Bid"/"Sell" *action* button needs something listening for the tap and executing it the moment it
happens, which doesn't fit GitHub Actions' schedule-and-exit model; that's future work, not
implemented yet. `kickbase/telegram.py` uses HTML parse mode (stricter but more predictable than
Markdown - `html.escape()` handles special characters in player names safely) with a plain-text
fallback if parsing fails, and splits text into multiple messages if it exceeds Telegram's
4096-character limit (mainly relevant to `--all-leagues`). `report.py`'s `compute_briefing()` /
`render_text()` / `render_telegram()` split ensures the rich version can never say something
different from the plain digest - both render the same underlying `BriefingData`.

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
- `naive_projection()` — the closest thing here to an actual forward
  number: the 7-day trend's average daily rate, continued one more day.
  Not a forecast, just linear trend continuation — will be wrong whenever
  a trend reverses, which market values do often (e.g. after a bad
  matchday). Shown in `brief` as "next-day est."
- `report._normalized_scores()` — `momentum_score()`/`decline_urgency()`
  produce raw numbers on whatever scale their inputs happen to be on
  (recently: multi-million currency-scale, easy to mistake for an actual
  value prediction). This min-max normalizes to 0-100 *within each list
  shown* (buy candidates, sell candidates, watchlist), for display only —
  the underlying ranking is unchanged, this just relabels it clearly as
  "relative strength," not an amount.
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

**`prc` never moves, even from your own bids.** Placed a bid at a
listing's exact asking price, then a second bid 100k higher on the same
listing: `prc` stayed at the original value through both, while `uop`
(my own offer) updated correctly. So `prc` is a static, computer-set
asking price, not a live "current top bid" - there is genuinely no
visible signal anywhere of how much competition a listing has, at any
point before it resolves. Practical takeaway: bidding right before a
listing's deadline buys you nothing defensively (nobody can see or react
to your bid regardless of timing) - the only thing timing affects is your
own flexibility, since re-bidding replaces your existing offer in place
(same `uoid` both times, not a second entry in `ofs`) rather than
stacking, so a placeholder bid can be revised upward later at no cost.

**Budget has a field the bot wasn't using.** `GET .../me/budget` returns
`{"pbaa": ..., "pbas": ..., "b": ..., "bs": ...}`. `b`/`pbas` is your
nominal balance and does not move when you place a bid; `pbaa` is exactly
`b` minus your currently outstanding offer(s) - confirmed by placing a
3.9m bid and watching `pbaa` drop by exactly that much while `b` stayed
put. `strategy.buy_candidates()` currently reads only `b`, so with more
than one simultaneous pending bid it could recommend spending money
that's already committed elsewhere. Not yet fixed - worth switching to
`pbaa` if/when multi-bid scenarios become common.

**Seller identity.** Whether a listing is a real manager selling a player
or a computer-generated market listing matters a lot for a buy decision,
and it turns out to be directly determinable: manager-listed items carry a
`"u"` object with the seller's identity (`{"i": ..., "n": "Simon", ...}`);
computer-generated listings never have that key at all. Confirmed by
listing a real player for sale and diffing its raw JSON against a computer
listing — `"u"` was the only field present on one and absent on the other.
`report.seller_name()` reads this (falls back to `"Kickbase"` when absent)
and is still shown in the `market` table's Seller column. `brief`'s advice
sections go further and drop manager-listed players entirely
(`report.compute_briefing()` filters `market` to items without `"u"`
before any buy/watch/top-performer ranking runs) — buying from another
manager is a different, negotiation-flavored decision (they set the
price, there's no closing deadline) than buying from the computer market,
so mixing the two into one ranked list made the advice harder to act on
than just leaving manager listings out.

**Deadlines.** `exs` (seconds until a listing closes) follows the same
pattern as `"u"` above: only ever present on computer-generated listings.
Manager-listed items never carry it - consistent with them staying up
until bought or withdrawn rather than closing on a timer. `brief` shows
this as `⏰ Xh Ym left` for computer listings, or an explicit `⏳ no
deadline` note for manager ones, rather than leaving it blank.

## Endpoints used

| Purpose | Endpoint |
|---|---|
| Login | `POST /v4/user/login` |
| Transfer market listing | `GET /v4/leagues/{leagueId}/market` |
| Player detail | `GET /v4/leagues/{leagueId}/players/{playerId}` |
| Player market value history (24h/7d/etc.) | `GET /v4/leagues/{leagueId}/players/{playerId}/marketValue/{timeframe}` |
| Owned squad | `GET /v4/leagues/{leagueId}/squad` |
| Another manager's squad | `GET /v4/leagues/{leagueId}/managers/{managerId}/squad` |
| A manager's transfer history | `GET /v4/leagues/{leagueId}/managers/{managerId}/transfer` |
| League standings / member list | `GET /v4/leagues/{leagueId}/ranking` |
| Budget | `GET /v4/leagues/{leagueId}/me/budget` |
| Get/set lineup | `GET`/`POST /v4/leagues/{leagueId}/lineup` |
| List a player for sale | `POST /v4/leagues/{leagueId}/market` |
| Instant-sell to Kickbase | `POST /v4/leagues/{leagueId}/market/{playerId}/sell` |
| Place a bid | `POST /v4/leagues/{leagueId}/market/{playerId}/offers` |

Accepting/declining *manager* offers (`POST/DELETE
/v4/leagues/{leagueId}/market/{playerId}/offers/{offerId}/accept|decline`)
is documented upstream but not wired up — nothing here currently needs to
respond to an incoming offer on your own listings.
