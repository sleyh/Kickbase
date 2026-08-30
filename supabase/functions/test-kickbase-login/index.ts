import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { KickbaseClient, KickbaseError } from "../_shared/kickbase-client.ts";

/**
 * Verifies a user's Kickbase credentials actually work before ever
 * storing them, mirroring how the whole onboarding flow is designed
 * around "never trust unverified input as a stored secret."
 *
 * Two-step flow, since one Kickbase account can belong to multiple
 * leagues (kickbase/cli.py's _resolve_league_id has the same shape):
 *   1. { kickbase_email, kickbase_password } only -> if the account has
 *      more than one league, returns { leagues: [...] } for the client to
 *      show a picker, without writing anything yet.
 *   2. Same body + { league_id } -> verifies again (Kickbase rate-limits
 *      logins, but correctness beats a saved round trip here) and, on
 *      success, stores the password in Vault and upserts kickbase_accounts.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    const kickbaseEmail: string | undefined = body?.kickbase_email;
    const kickbasePassword: string | undefined = body?.kickbase_password;
    const leagueId: string | undefined = body?.league_id;

    if (!kickbaseEmail || !kickbasePassword) {
      return Response.json(
        { error: "kickbase_email and kickbase_password are required." },
        { status: 400 }
      );
    }

    const client = new KickbaseClient(kickbaseEmail, kickbasePassword);
    try {
      await client.login();
    } catch (err) {
      const message = err instanceof KickbaseError ? err.message : "Login failed.";
      return Response.json({ error: message }, { status: 400 });
    }

    if (!leagueId) {
      if (client.leagues.length === 1) {
        return Response.json({ leagues: client.leagues, autoSelected: client.leagues[0].id });
      }
      return Response.json({ leagues: client.leagues });
    }

    const league = client.leagues.find((l) => l.id === leagueId);
    if (!league) {
      return Response.json({ error: "That league id wasn't found on this account." }, { status: 400 });
    }

    const userId = ctx.userClaims!.id;
    const secretName = `kickbase_password:${userId}`;

    const { data: secretId, error: vaultError } = await ctx.supabaseAdmin.rpc(
      "store_kickbase_secret",
      { p_secret: kickbasePassword, p_name: secretName }
    );
    if (vaultError) {
      return Response.json({ error: `Failed to store credentials: ${vaultError.message}` }, { status: 500 });
    }

    const { error: upsertError } = await ctx.supabaseAdmin.from("kickbase_accounts").upsert({
      user_id: userId,
      kickbase_email: kickbaseEmail,
      vault_secret_id: secretId,
      league_id: leagueId,
      cached_kb_user_id: client.userId,
      last_verified_at: new Date().toISOString(),
    });
    if (upsertError) {
      return Response.json({ error: `Failed to save account: ${upsertError.message}` }, { status: 500 });
    }

    return Response.json({ ok: true, league });
  }),
};
