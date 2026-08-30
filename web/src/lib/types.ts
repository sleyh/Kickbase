/**
 * Mirrors supabase/functions/_shared/squad-value.ts's SquadValueReport -
 * kept in sync by hand since the two projects don't share a build.
 * photo/sparkline are marked optional (not just nullable) because a
 * reports_cache row written before these fields existed won't have the
 * keys at all - consuming components must default them, not assume
 * presence (same reasoning as normalizeSquadValueReport() below).
 */
export interface CompetitorSummary {
  id?: string;
  name: string;
  totalValue: number;
  totalDelta: number | null;
  estimatedBudget: number | null;
  photo?: string | null;
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
  players: Array<{
    id?: string;
    name: string;
    value?: number;
    d1: number;
    d7?: number | null;
    points?: number | null;
    rating?: number;
    attributable: boolean;
    photo?: string | null;
    sparkline?: number[];
    pos?: number | null;
    tid?: string | null;
  }>;
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
  playerId?: string;
  playerName: string;
  trp: number;
  mv: number;
  premiumPct: number;
  othnm?: string;
}

export interface SpendingProfile {
  id?: string;
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
  id?: string;
  name: string;
  price: number;
  marketValue: number;
  rising: boolean;
  avgPoints: number;
  hasOwnBid: boolean;
  ownBidAmount: number | null;
  photo?: string | null;
  pos?: number | null;
  trend?: "up" | "down" | "flat";
  expiresInSeconds?: number | null;
  d1?: number | null;
  d7?: number | null;
  teamId?: string | null;
  teamName?: string | null;
  teamCrest?: string | null;
  owner?: { id: string; name: string; photo: string | null } | null;
}

export interface MarketSnapshot {
  leagueName: string;
  notable: MarketListingSummary[];
  ownBids: MarketListingSummary[];
}

/** Mirrors supabase/functions/market-full/index.ts's response - every live listing, not the notable-filtered subset. */
export interface FullMarketReport {
  leagueName: string;
  listings: MarketListingSummary[];
  ownBids: MarketListingSummary[];
}

/** Mirrors supabase/functions/_shared/live-matchday.ts's LiveMatchdayReport. */
export interface LiveMatchTeam {
  id: string;
  name: string;
  crest?: string | null;
  goals: number;
}

export interface LiveMatchGroup {
  team1: LiveMatchTeam;
  team2: LiveMatchTeam;
  minute: string;
  status: number;
  isLive: boolean;
  players: Array<{ id?: string; name: string; points: number; team: string; photo?: string | null }>;
}

export interface LiveStandingEntry {
  id?: string;
  name: string;
  points: number;
  isYou: boolean;
  photo?: string | null;
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

/** Mirrors supabase/functions/_shared/manager-detail.ts's ManagerDetailReport - not cached, so no stale-shape concern (unlike the report types above). */
export interface ManagerDetailReport {
  id: string;
  name: string;
  photo: string | null;
  isYou: boolean;
  rank: number | null;
  squadValue: number;
  estimatedBudget: number | null;
  dashboard: {
    teamValue: number | null;
    profit: number | null;
    avgPoints: number | null;
    matchdayWins: number | null;
  } | null;
  seasonTotalPoints: number | null;
  performance: Array<{ day: number; points: number; won: boolean }>;
  transfers: Array<{
    playerName: string;
    type: "buy" | "sell";
    amount: number;
    date: string;
    counterparty: string | null;
  }>;
  squad: Array<{
    id: string;
    name: string;
    photo: string | null;
    pos: number | null;
    value: number;
    d1: number | null;
  }>;
}

/** Mirrors supabase/functions/_shared/player-detail.ts's PlayerDetailReport. */
export interface PlayerDetailReport {
  id: string;
  name: string;
  photo: string | null;
  pos: number | null;
  team: { id: string; name: string; crest: string | null } | null;
  value: number | null;
  points: number | null;
  history: Array<{ day: number; value: number }>;
  upcomingFixtures: Array<{
    opponentId: string;
    opponentName: string;
    opponentCrest: string | null;
    opponentStrength: number;
    date: string;
  }>;
  ownership: { boughtPrice: number; boughtDate: string } | null;
  listedBy?: { id: string; name: string; photo: string | null } | null;
}

/** Mirrors supabase/functions/_shared/team-detail.ts's TeamDetailReport. */
export interface TeamFixture {
  matchId: string;
  opponentId: string;
  opponentName: string;
  opponentCrest: string | null;
  opponentStrength: number;
  date: string;
  home: boolean;
  ownGoals: number | null;
  opponentGoals: number | null;
}

export interface TeamDetailReport {
  id: string;
  name: string;
  crest: string | null;
  rank: number | null;
  strength: number | null;
  recentMatches: TeamFixture[];
  upcomingMatches: TeamFixture[];
}
