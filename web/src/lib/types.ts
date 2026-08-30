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
