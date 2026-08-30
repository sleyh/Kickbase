/**
 * Minimal client for the Kickbase v4 API - TypeScript port of
 * kickbase/client.py (the Python CLI/bot this app is built from).
 *
 * Endpoint reference: https://github.com/kevinskyba/kickbase-api-doc
 *
 * Only login() + the shared _get/_post retry infrastructure are ported
 * here for now (needed to verify a user's credentials during onboarding).
 * The rest of client.py (get_squad, get_market, teamcenter, etc.) lands
 * in the next milestone alongside the first real report.
 */

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
}
