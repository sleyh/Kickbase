/** Mirrors supabase/functions/_shared/squad-value.ts's SquadValueReport - kept in sync by hand since the two projects don't share a build. */
export interface CompetitorSummary {
  name: string;
  totalValue: number;
  totalDelta: number | null;
  estimatedBudget: number | null;
}

export interface ValueTrendPoint {
  day: number;
  totalValue: number;
}

export interface SquadValueReport {
  leagueName: string;
  budget: number;
  totalValue: number;
  netWorth: number;
  totalDelta: number;
  players: Array<{ name: string; d1: number; attributable: boolean }>;
  noHistoryYet: string[];
  competitors: CompetitorSummary[] | null;
  valueTrend: ValueTrendPoint[];
}

/**
 * reports_cache rows written before valueTrend existed don't have that
 * field at all (not even present-as-undefined) - reading one straight
 * off the cache and accessing .valueTrend.length crashes the page.
 * Every read of a cached squad_value payload should go through this.
 */
export function normalizeSquadValueReport(payload: unknown): SquadValueReport | null {
  if (!payload) return null;
  const partial = payload as Partial<SquadValueReport>;
  return { ...partial, valueTrend: partial.valueTrend ?? [] } as SquadValueReport;
}

export const DEBT_CEILING_RATIO = 0.33;

/** Mirrors supabase/functions/_shared/transfer-analysis.ts's SpendingProfile. */
export interface SpendingEntry {
  playerName: string;
  trp: number;
  mv: number;
  premiumPct: number;
  othnm?: string;
}

export interface SpendingProfile {
  name: string;
  computerBuys: SpendingEntry[];
  managerBuys: SpendingEntry[];
}

export interface TransferAnalysisReport {
  leagueName: string;
  profiles: SpendingProfile[];
}

/** Mirrors run-report's collect_bonus payload shape. */
export interface BonusReport {
  collected: boolean;
  amount?: number;
  streakDay?: number;
}

/** Mirrors supabase/functions/_shared/market.ts's MarketSnapshot. */
export interface MarketListingSummary {
  name: string;
  price: number;
  marketValue: number;
  rising: boolean;
  avgPoints: number;
  hasOwnBid: boolean;
  ownBidAmount: number | null;
}

export interface MarketSnapshot {
  leagueName: string;
  notable: MarketListingSummary[];
  ownBids: MarketListingSummary[];
}

/** Mirrors supabase/functions/_shared/live-matchday.ts's LiveMatchdayReport. */
export interface LiveMatchGroup {
  matchLabel: string;
  minute: string;
  status: number;
  isLive: boolean;
  players: Array<{ name: string; points: number; team: string }>;
}

export interface LiveStandingEntry {
  name: string;
  points: number;
  isYou: boolean;
}

export interface LiveMatchdayReport {
  leagueName: string;
  day: number | null;
  myMatches: LiveMatchGroup[];
  standings: LiveStandingEntry[];
}

/** Admin section types - report_type/job_type as text since the DB enum's exact members don't need mirroring 1:1 here. */
export type ReportType = "squad_value" | "transfer_analysis" | "collect_bonus" | "market_alert";

export const ADMIN_TRIGGERABLE_REPORT_TYPES: ReportType[] = [
  "squad_value",
  "transfer_analysis",
  "collect_bonus",
  "market_alert",
];

export interface AdminUserRow {
  userId: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string;
  kickbaseEmail: string | null;
  leagueId: string | null;
  lastVerifiedAt: string | null;
  telegramLinked: boolean;
  telegramLinkedAt: string | null;
}

export interface JobRunRow {
  id: string;
  userId: string;
  jobType: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  outputSummary: string | null;
  errorDetail: string | null;
}

export interface ScheduledJobRow {
  id: string;
  userId: string;
  jobType: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export interface HealthCheckResult {
  ok: boolean;
  detail: string;
}

export interface AdminHealthReport {
  kickbase: HealthCheckResult;
  telegram: HealthCheckResult;
  database: HealthCheckResult;
  checkedAt: string;
}
