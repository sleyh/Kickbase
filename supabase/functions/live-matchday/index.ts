import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { KickbaseClient, KickbaseError } from "../_shared/kickbase-client.ts";
import { buildLiveMatchdayReport } from "../_shared/live-matchday.ts";

/**
 * Always fetched fresh, unlike run-report's report types - live matchday
 * data is only meaningful in the moment, so there's no reports_cache row
 * or job_runs history for this one, just load-on-view from the
 * dashboard's Live Matchday page.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const userId = ctx.userClaims!.id;

    const { data: account, error: accountError } = await ctx.supabaseAdmin
      .from("kickbase_accounts")
      .select("kickbase_email, vault_secret_id, league_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (accountError || !account) {
      return Response.json({ error: "No linked Kickbase account. Finish onboarding first." }, { status: 400 });
    }

    const { data: password, error: secretError } = await ctx.supabaseAdmin.rpc("read_kickbase_secret", {
      p_secret_id: account.vault_secret_id,
    });
    if (secretError || !password) {
      return Response.json({ error: "Couldn't read stored credentials." }, { status: 500 });
    }

    try {
      const client = new KickbaseClient(account.kickbase_email, password);
      await client.login();

      const league = client.leagues.find((l) => l.id === account.league_id);
      const leagueName = (league?.name as string) ?? account.league_id;

      const report = await buildLiveMatchdayReport(client, account.league_id, leagueName);
      return Response.json(report);
    } catch (err) {
      const message = err instanceof KickbaseError ? err.message : String(err);
      return Response.json({ error: message }, { status: 502 });
    }
  }),
};
