export type StrategyMode = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export type StrategyUrgency = "LOW" | "MEDIUM" | "HIGH";

export interface StrategyApiResponse {
  positionId: string;
  walletAddress: `0x${string}`;
  mode: StrategyMode;
  marketState:
    | "RANGE"
    | "UP_TREND"
    | "DOWN_TREND"
    | "HIGH_VOLATILITY"
    | "LOW_LIQUIDITY"
    | "UNKNOWN";
  shouldRebalance?: boolean;
  urgency?: StrategyUrgency;
  rationale: string;
  explanationLines: string[];
  expectedBenefitUsd?: number;
  estimatedGasCostUsd?: number;
  netExpectedBenefitUsd?: number;
  confidence: number;
  marketConfidence?: number;
  marketVolatility?: number;
  marketTrendScore?: number;
  suggestion?: {
    suggestedCenterPrice: number | null;
    suggestedLowerPrice: number | null;
    suggestedUpperPrice: number | null;
    suggestedTickLower: number;
    suggestedTickUpper: number;
    widthPercent: number;
    confidence: number;
  };
  decision?: {
    shouldRebalance: boolean;
    urgency: StrategyUrgency;
    reasonCodes: string[];
    expectedBenefitUsd: number;
    estimatedGasCostUsd: number;
    netExpectedBenefitUsd: number;
  };
  riskNotes?: string[];
  source?: string;
  generatedAt?: string;
  stale?: boolean;
  quality?: {
    marketState: "exact" | "estimated" | "heuristic";
    proposal: "exact" | "estimated" | "heuristic";
    decision: "exact" | "estimated" | "heuristic";
  };
  preview?: {
    currentRange: { tickLower: number; tickUpper: number };
    proposedRange: { tickLower: number; tickUpper: number };
    currentPrice: number | null;
    distanceFromRangeTicks: number;
    expectedFeeImprovementUsd: number;
    confidenceScore: number;
    riskNotes: string[];
  };
}

export interface RebalancePreviewRequest {
  mode: StrategyMode;
  gasPriceGwei?: number;
  gasUnits?: number;
}

export interface StrategyPreviewSummary {
  marketState: StrategyApiResponse["marketState"];
  urgency: StrategyUrgency;
  shouldRebalance: boolean;
  netExpectedBenefitUsd: number;
  estimatedGasCostUsd: number;
  suggestedTickLower: number;
  suggestedTickUpper: number;
  explanationLines: string[];
  generatedAt: string;
  source?: string;
  stale?: boolean;
  quality?: {
    marketState: "exact" | "estimated" | "heuristic";
    proposal: "exact" | "estimated" | "heuristic";
    decision: "exact" | "estimated" | "heuristic";
  };
  suggestedLowerPrice?: number | null;
  suggestedUpperPrice?: number | null;
}
