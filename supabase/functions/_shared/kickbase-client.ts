/**
 * Minimal client for the Kickbase v4 API - TypeScript port of
 * kickbase/client.py (the Python CLI/bot this app is built from). Field
 * names match the Python client's docstrings, which in turn match the
 * community API doc (https://github.com/kevinskyba/kickbase-api-doc) -
 * kept loosely typed (Record<string, any> / unknown) the same way the
 * Python client keeps everything as plain dicts, rather than fully
 * modeling every response shape up front.
 */

// deno-lint-ignore-file no-explicit-any

const BASE_URL = "https://api.kickbase.com";

export class KickbaseError extends Error {}

export interface KickbaseLeague {
  id: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * A genuinely expired token gets 403 from this API, not 401 (confirmed
 * live in the Python client: decoded a cached token past its own "exp"
 * claim, hit a real endpoint with it, got 403 with an empty body - no 401
 * anywhere). Both statuses have to trigger a fresh login, or an expired
 * token is never detected and every call fails until someone notices.
 * See kickbase/client.py's _AUTH_RETRY_STATUSES for the full incident
 * writeup (a multi-day silent outage caused by only handling 401).
 */
const AUTH_RETRY_STATUSES = new Set([401, 403]);

export class KickbaseClient {
  private email: string;
  private password: string;
  private token: string | null = null;
  leagues: KickbaseLeague[] = [];
  userId: string | null = null;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Authenticates and populates token/leagues/userId. Always a fresh
   * login - unlike the Python client, this short-lived Edge Function
   * invocation has no reason to cache a token across calls (a future
   * cron dispatcher call gets a fresh instance every time anyway).
   */
  async login(): Promise<void> {
    const resp = await fetch(`${BASE_URL}/v4/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ em: this.email, pass: this.password }),
    });
    if (resp.status !== 200) {
      const text = await resp.text();
      throw new KickbaseError(`Login failed (${resp.status}): ${text}`);
    }
    const data = await resp.json();
    this.token = data.tkn;
    this.leagues = data.srvl ?? [];
    this.userId = data.u?.id ?? null;
  }

  async get(path: string): Promise<unknown> {
    let resp = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
    if (AUTH_RETRY_STATUSES.has(resp.status)) {
      await this.login();
      resp = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
    }
    if (!resp.ok) {
      throw new KickbaseError(`GET ${path} failed (${resp.status}): ${await resp.text()}`);
    }
    return resp.json();
  }

  async post(path: string, body: Record<string, unknown> = {}): Promise<unknown> {
    const doPost = () =>
      fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    let resp = await doPost();
    if (AUTH_RETRY_STATUSES.has(resp.status)) {
      await this.login();
      resp = await doPost();
    }
    if (!resp.ok) {
      throw new KickbaseError(`POST ${path} failed (${resp.status}): ${await resp.text()}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  /** Transfer market overview: {it: [...market items], nps, tv, mvud, dt, day}. */
  getMarket(leagueId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/market`);
  }

  getPlayer(leagueId: string, playerId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/players/${playerId}`);
  }

  /**
   * Daily market-value time series for a player - what the app's own
   * 24h/7d charts are built from. timeframe is 92 (~3 months) or 365 (1
   * year), the only two values the API accepts. Response: {it: [{dt: day
   * index, mv: value}, ...] oldest first, lmv/hmv: low/high in window,
   * trp: total rise points, idp: in a drop phase}.
   */
  getMarketValueHistory(leagueId: string, playerId: string, timeframe = 92): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/players/${playerId}/marketValue/${timeframe}`);
  }

  /** Owned players: {it: [...]}, each with mv/mvt (value + trend), ap, pos, st. */
  getSquad(leagueId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/squad`);
  }

  /** {b: available budget, pbas: ..., bs: ...}. */
  getBudget(leagueId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/me/budget`);
  }

  /**
   * League standings: {us: [{i: user id, n: name, jd: join date, ...},
   * ...]}, one entry per manager including yourself. `jd` matters for
   * budget reconstruction - a manager's starting-allocation squad is
   * valued as of the day *before* they joined if they joined before the
   * daily value update fires (~18:00-20:00 UTC), since that day's own
   * update hadn't landed yet at join time.
   */
  getRanking(leagueId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/ranking`);
  }

  /**
   * Another league member's squad. Response shape differs from
   * getSquad(): {u: manager's user id, unm: name, uim: avatar, it:
   * [...]}, and each player item uses pi/pn (player id/name) instead of
   * getSquad()'s i/fn+n.
   */
  getManagerSquad(leagueId: string, managerId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/managers/${managerId}/squad`);
  }

  /**
   * A manager's dashboard summary: {tv: team value, prft: profit, ap:
   * avg points, mdw: matchday wins, pl: points last, ...}. All points
   * fields read 0 pre-season - there's genuinely nothing there yet, not
   * a permissions gap.
   */
  getManagerDashboard(leagueId: string, managerId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/managers/${managerId}/dashboard`);
  }

  /**
   * A manager's season/matchday performance: {it: [{sid, sn: season
   * name, tp: total season points, mdw: matchday wins, it: [{day, mdp:
   * points that matchday, tw: won that matchday, md: kickoff time,
   * ...}]}]}.
   */
  getManagerPerformance(leagueId: string, managerId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/managers/${managerId}/performance`);
  }

  /**
   * A manager's transfer history: {u, unm, it: [{pi, pn, tid, tty:
   * 1=bought/2=sold, othnm: the other party's name (only for a real
   * manager, not Kickbase), trp: price paid/received, dt, pim}]}.
   * Paginated (`start` offset) - callers should walk every page rather
   * than trust a single one, since trusting a single page could silently
   * truncate an active manager's history. A manager-to-manager trade
   * shows up as a mirrored pair across both parties' own logs.
   */
  getManagerTransfers(leagueId: string, managerId: string, start = 0): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/managers/${managerId}/transfer?start=${start}`);
  }

  /**
   * Your own achievement list: {it: [{t: type id, n, d, ac: 1 if
   * achieved, ...}]}. Only ac=1 entries have a real cash payout - fetch
   * getAchievementDetail() per type for the "er" (earned reward) field.
   * User-scoped only - there's no equivalent for another manager.
   */
  getAchievements(leagueId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/user/achievements`);
  }

  /**
   * One achievement's full detail, including "er" (earned reward - cash
   * actually credited, only meaningful if ac=1). Some achieved
   * achievements carry an "er" value that clearly wasn't credited (e.g.
   * cosmetic ones) - cross-check against a known-real budget before
   * trusting "er" blindly.
   */
  getAchievementDetail(leagueId: string, achievementType: number): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/user/achievements/${achievementType}`);
  }

  /**
   * Paginated league activity feed: {af: [{t: type code, data: {...},
   * dt, ...}]}. Mixes public events (transfers - type 15, new listings -
   * type 3, milestones - type 26) with private ones that only ever show
   * your own (bonus collections - type 22). type 23 is the
   * league-creation event, carrying the league's starting budget.
   */
  getActivitiesFeed(leagueId: string, start = 0, maxItems = 100): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/activitiesFeed?start=${start}&max=${maxItems}`);
  }

  /**
   * Collects the daily login bonus - a GET that actually claims it as a
   * side effect, not just checks for one. Not league-scoped - covers
   * every league on the account in one call: {it: [{li: league id, lnm:
   * league name, v: amount collected, day: streak day, b: budget
   * snapshot after collecting}, ...]}. Empty "it" (no error) when
   * there's nothing left to collect today.
   */
  collectBonus(): Promise<any> {
    return this.get(`/v4/bonus/collect`);
  }

  getLineup(leagueId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/lineup`);
  }

  /** formation like "4-4-2" (DEF-MID-FWD; goalkeeper is implicit). */
  setLineup(leagueId: string, formation: string, playerIds: string[]): Promise<any> {
    return this.post(`/v4/leagues/${leagueId}/lineup`, { type: formation, players: playerIds });
  }

  /** Lists an owned player on the transfer market at the given price. */
  listForSale(leagueId: string, playerId: string, price: number): Promise<any> {
    return this.post(`/v4/leagues/${leagueId}/market`, { pi: playerId, prc: price });
  }

  /** Places an offer on a market listing (sealed bid - see report.ts). */
  placeBid(leagueId: string, playerId: string, price: number): Promise<any> {
    return this.post(`/v4/leagues/${leagueId}/market/${playerId}/offers`, { price });
  }

  /**
   * Instantly sells an owned player to Kickbase itself, no waiting on a
   * manager bid. Despite the doc describing a two-step POST-then-DELETE
   * flow, a single POST completes the sale immediately in practice (no
   * separate accept call needed).
   */
  sellToKickbase(leagueId: string, playerId: string): Promise<any> {
    return this.post(`/v4/leagues/${leagueId}/market/${playerId}/sell`);
  }

  /**
   * Live per-player fantasy points for whichever matches your own
   * current lineup's players are involved in today: {lp: [{i, n, tid,
   * pos, p: live points, mst: match status, mtd: match minute, ot:
   * {i: opponent team id}, ...}], nlp: non-lineup players, p, pa, lpc,
   * clpc}.
   */
  getTeamcenterMyEleven(leagueId: string): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/teamcenter/myeleven`);
  }

  /**
   * Live total matchday points for every manager in the league (not
   * just yourself): {us: [{i: user id, unm, mdp: live matchday points,
   * lp: this manager's lineup player ids, ...}]}. No per-player
   * breakdown for anyone but yourself - only getTeamcenterMyEleven()
   * gives that.
   */
  getUserTeamcenter(leagueId: string, userId: string, dayNumber: number): Promise<any> {
    return this.get(`/v4/leagues/${leagueId}/users/${userId}/teamcenter?dayNumber=${dayNumber}`);
  }

  /** Bundesliga competition id "1"'s team list: {it: [{tid, tn: team name, ...}]}. */
  getCompetitionTable(competitionId: string): Promise<any> {
    return this.get(`/v4/competitions/${competitionId}/table`);
  }

  /** Every matchday's fixtures for a competition: {it: [{day, it: [{mi: match id, t1, t2, t1g, t2g, dt, mtd, st, il: is-live, ...}]}]}. */
  getCompetitionMatchdays(competitionId: string): Promise<any> {
    return this.get(`/v4/competitions/${competitionId}/matchdays`);
  }

  /** Full live detail for one match: score, lineups, and a goal/assist events feed. */
  getMatchDetails(matchId: string): Promise<any> {
    return this.get(`/v4/matches/${matchId}/details`);
  }
}
