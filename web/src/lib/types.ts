/** Mirrors supabase/functions/_shared/squad-value.ts's SquadValueReport - kept in sync by hand since the two projects don't share a build. */
export interface CompetitorSummary {
  name: string;
  totalValue: number;
  totalDelta: number | null;
  estimatedBudget: number | null;
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
