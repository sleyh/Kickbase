// deno-lint-ignore-file no-explicit-any
/**
 * Shared core for running one report against one user's linked Kickbase
 * account. Used by both run-report (a user running their own report) and
 * admin-trigger-job (an admin running a report on someone else's behalf
 * on demand) - everything here is identical between the two callers
 * except *whose* account is being read, which the caller decides before
 * ever reaching this module.
 */

import { KickbaseClient, KickbaseError } from "./kickbase-client.ts";
import { buildSquadValueReport } from "./squad-value.ts";
import { buildSpendingProfiles } from "./transfer-analysis.ts";
import { buildMarketSnapshot } from "./market.ts";
import {
  renderSquadValueTelegram,
  renderTransferAnalysisTelegram,
  renderBonusCollectedTelegram,
  renderMarketSnapshotTelegram,
} from "./report.ts";
import { sendMessage } from "./telegram.ts";

interface RunResult {
  payload: unknown;
  outputSummary: string;
  telegramText: string | null;
}

async function runSquadValue(
  client: KickbaseClient,
  leagueId: string,
  leagueName: string
): Promise<RunResult> {
  const report = await buildSquadValueReport(client, leagueId, leagueName, true);
  return {
    payload: report,
    outputSummary: `Squad value ${report.totalValue.toLocaleString()}, budget ${report.budget.toLocaleString()}`,
    telegramText: renderSquadValueTelegram(report),
  };
}

async function runTransferAnalysis(
  client: KickbaseClient,
  leagueId: string,
  leagueName: string
): Promise<RunResult> {
  const profiles = await buildSpendingProfiles(client, leagueId);
  const payload = { leagueName, profiles };
  return {
    payload,
    outputSummary: `Spending profiles for ${profiles.length} managers`,
    telegramText: renderTransferAnalysisTelegram(leagueName, profiles),
  };
}

async function runCollectBonus(
  client: KickbaseClient,
  leagueId: string,
  leagueName: string
): Promise<RunResult> {
  const result = await client.collectBonus();
  const entry = (result.it ?? []).find((e: any) => e.li === leagueId);
  if (!entry) {
    return {
      payload: { collected: false },
      outputSummary: "Nothing to collect (already claimed today, or none yet).",
      telegramText: null,
    };
  }
  return {
    payload: { collected: true, amount: entry.v, streakDay: entry.day },
    outputSummary: `Collected ${entry.v.toLocaleString()} (day ${entry.day} streak)`,
    telegramText: renderBonusCollectedTelegram(leagueName, entry.v, entry.day),
  };
}

async function runMarketAlert(
  client: KickbaseClient,
  leagueId: string,
  leagueName: string
): Promise<RunResult> {
  const market = (await client.getMarket(leagueId)).it ?? [];
  const snapshot = buildMarketSnapshot(leagueName, market);
  return {
    payload: snapshot,
    outputSummary: `${snapshot.notable.length} notable listings, ${snapshot.ownBids.length} own bids`,
    telegramText: renderMarketSnapshotTelegram(snapshot),
  };
}

const RUNNERS: Record<
  string,
  (client: KickbaseClient, leagueId: string, leagueName: string) => Promise<RunResult>
> = {
  squad_value: runSquadValue,
  transfer_analysis: runTransferAnalysis,
  collect_bonus: runCollectBonus,
  market_alert: runMarketAlert,
};

export const REPORT_TYPES = Object.keys(RUNNERS);

export interface RunReportOutcome {
  ok: boolean;
  payload?: unknown;
  error?: string;
  status: number;
}

/**
 * Runs one report for the given user: loads their linked Kickbase
 * account, decrypts the stored password just for this invocation, builds
 * the report, caches it, records a job_runs row either way, and - only
 * when notify is true - pushes it to Telegram if the user has a
 * confirmed chat link and the report actually has something to say
 * (collect_bonus's telegramText is null when nothing was collected,
 * matching cmd_collect_bonus's "skip Telegram on a no-op").
 *
 * market_alert here is a live snapshot ("what's notable right now"), not
 * a diff against the previous poll like cmd_alert()'s cron-driven
 * new-listing detection - that needs a persistent previous snapshot to
 * compare against, which a scheduled cron dispatcher would provide (not
 * built yet). teamcenter_live isn't wired in here at all - live matchday
 * data is meant to be fetched fresh on every dashboard view, not cached
 * the way a snapshot report is - see its own dedicated Edge Function.
 *
 * supabaseAdmin is passed in rather than constructed here so callers keep
 * using the single service-role client withSupabase already gave them.
 */
export async function runReportForUser(
  supabaseAdmin: any,
  userId: string,
  reportType: string,
  notify: boolean
): Promise<RunReportOutcome> {
  const runner = RUNNERS[reportType];
  if (!runner) {
    return { ok: false, error: `Unknown report_type "${reportType}".`, status: 400 };
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from("kickbase_accounts")
    .select("kickbase_email, vault_secret_id, league_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError || !account) {
    return { ok: false, error: "No linked Kickbase account. Finish onboarding first.", status: 400 };
  }

  const { data: password, error: secretError } = await supabaseAdmin.rpc("read_kickbase_secret", {
    p_secret_id: account.vault_secret_id,
  });
  if (secretError || !password) {
    return { ok: false, error: "Couldn't read stored credentials.", status: 500 };
  }

  const startedAt = new Date().toISOString();

  try {
    const client = new KickbaseClient(account.kickbase_email, password);
    await client.login();

    const league = client.leagues.find((l) => l.id === account.league_id);
    const leagueName = (league?.name as string) ?? account.league_id;

    const { payload, outputSummary, telegramText } = await runner(client, account.league_id, leagueName);

    await supabaseAdmin.from("reports_cache").upsert({
      user_id: userId,
      report_type: reportType,
      payload,
      generated_at: new Date().toISOString(),
    });

    await supabaseAdmin.from("job_runs").insert({
      user_id: userId,
      job_type: reportType,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "success",
      output_summary: outputSummary,
    });

    if (notify && telegramText) {
      const { data: link } = await supabaseAdmin
        .from("telegram_links")
        .select("chat_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (link?.chat_id) {
        const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
        try {
          await sendMessage(token, link.chat_id, telegramText);
        } catch (err) {
          // A Telegram delivery failure shouldn't fail the whole report
          // run - the report itself succeeded and is cached; log it and
          // move on (same reasoning as telegram-webhook's tryNotify()).
          console.error("Telegram delivery failed:", err);
        }
      }
    }

    return { ok: true, payload, status: 200 };
  } catch (err) {
    const message = err instanceof KickbaseError ? err.message : String(err);
    await supabaseAdmin.from("job_runs").insert({
      user_id: userId,
      job_type: reportType,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "failed",
      error_detail: message,
    });
    return { ok: false, error: message, status: 502 };
  }
}
