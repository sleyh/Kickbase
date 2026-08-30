// deno-lint-ignore-file no-explicit-any
/**
 * The account-lookup + vault-decrypt + client-login sequence every
 * not-cached, load-on-view Edge Function needs (live-matchday and the
 * three entity-detail functions) - factored out here so it exists once,
 * not once per function. run-report-core.ts keeps its own inline version
 * since it's woven into cache/job_runs bookkeeping those functions don't
 * have.
 */

import { KickbaseClient, KickbaseError } from "./kickbase-client.ts";

export interface AuthContext {
  client: KickbaseClient;
  leagueId: string;
  leagueName: string;
}

export interface AuthContextError {
  error: string;
  status: number;
}

export function isAuthContextError(x: AuthContext | AuthContextError): x is AuthContextError {
  return "error" in x;
}

export async function getAuthContext(supabaseAdmin: any, userId: string): Promise<AuthContext | AuthContextError> {
  const { data: account, error: accountError } = await supabaseAdmin
    .from("kickbase_accounts")
    .select("kickbase_email, vault_secret_id, league_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError || !account) {
    return { error: "No linked Kickbase account. Finish onboarding first.", status: 400 };
  }

  const { data: password, error: secretError } = await supabaseAdmin.rpc("read_kickbase_secret", {
    p_secret_id: account.vault_secret_id,
  });
  if (secretError || !password) {
    return { error: "Couldn't read stored credentials.", status: 500 };
  }

  try {
    const client = new KickbaseClient(account.kickbase_email, password);
    await client.login();
    const league = client.leagues.find((l) => l.id === account.league_id);
    return {
      client,
      leagueId: account.league_id,
      leagueName: (league?.name as string) ?? account.league_id,
    };
  } catch (err) {
    const message = err instanceof KickbaseError ? err.message : String(err);
    return { error: message, status: 502 };
  }
}
