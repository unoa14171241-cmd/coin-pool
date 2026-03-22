export type StrategyMode = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export type MarketState = "RANGE" | "UP_TREND" | "DOWN_TREND" | "HIGH_VOLATILITY" | "LOW_LIQUIDITY" | "UNKNOWN";
export type PairClassification = "VOLATILE" | "STABLE";
export type RebalanceUrgency = "LOW" | "MEDIUM" | "HIGH";
export type RecommendationStatus = "ok" | "hold" | "reject";
export type MetricQuality = "exact" | "estimated" | "heuristic";

export interface StrategyModeConfig {
  widthMultiplier: number;
  rebalanceThresholdBps: number;
  cooldownMs: number;
  minimumNetBenefitUsd: number;
  volatilitySensitivity: number;
}

export const STRATEGY_MODE_CONFIG: Record<StrategyMode, StrategyModeConfig> = {
  CONSERVATIVE: {
    widthMultiplier: 1.4,
    rebalanceThresholdBps: 700,
    cooldownMs: 1000 * 60 * 90,
    minimumNetBenefitUsd: 10,
    volatilitySensitivity: 0.8
  },
  BALANCED: {
    widthMultiplier: 1,
    rebalanceThresholdBps: 450,
    cooldownMs: 1000 * 60 * 45,
    minimumNetBenefitUsd: 5,
    volatilitySensitivity: 1
  },
  AGGRESSIVE: {
    widthMultiplier: 0.72,
    rebalanceThresholdBps: 250,
    cooldownMs: 1000 * 60 * 20,
    minimumNetBenefitUsd: 2,
    volatilitySensitivity: 1.2
  }
};

export interface MarketSnapshotPoint {
  snapshotAt: string;
  currentTick: number;
  currentPrice: number | null;
  liquidity: string | null;
  volatilityScore?: number | null;
  volumeProxy?: number | null;
}

export interface MarketStateDetectionInput {
  chainId: number;
  poolAddress: `0x${string}`;
  currentTick: number;
  currentPrice: number | null;
  recentSnapshots: MarketSnapshotPoint[];
  feeTier: number;
}

export interface MarketStateDetectionResult {
  marketState: MarketState;
  confidence: number;
  volatility: number;
  trendScore: number;
  drift: number;
  explanationLines: string[];
}

export interface RangeProposalInput {
  mode: StrategyMode;
  market: MarketStateDetectionResult;
  currentPrice: number | null;
  currentTick: number;
  feeTier: number;
  /** VOLATILE: レンジ広め + キャピタルゲイン考慮 / STABLE: レンジ狭め + 手数料最大化 */
  pairClassification?: PairClassification;
}

export interface RangeProposal {
  suggestedCenterPrice: number | null;
  suggestedLowerPrice: number | null;
  suggestedUpperPrice: number | null;
  suggestedTickLower: number;
  suggestedTickUpper: number;
  widthPercent: number;
  confidence: number;
  rationale: string;
  explanationLines: string[];
}

export interface RebalanceDecisionInput {
  mode: StrategyMode;
  currentTick: number;
  currentPrice: number | null;
  currentTickLower: number;
  currentTickUpper: number;
  proposed: RangeProposal;
  market: MarketStateDetectionResult;
  estimatedGasCostUsd: number;
  currentUncollectedFeesUsd: number;
  expectedFeeOpportunityUsd: number;
  cooldownRemainingMs: number;
  /** IL vs 手数料評価結果（fee < IL の場合はリバランス/撤退検討を強化） */
  ilFeeEvaluation?: {
    verdict: "CONTINUE" | "REBALANCE_CONSIDER" | "EXIT_CONSIDER";
    shouldConsiderRebalance: boolean;
    shouldConsiderExit: boolean;
  };
}

export interface RebalanceDecision {
  shouldRebalance: boolean;
  urgency: RebalanceUrgency;
  reasonCodes: string[];
  expectedBenefitUsd: number;
  estimatedGasCostUsd: number;
  netExpectedBenefitUsd: number;
  explanationLines: string[];
}

export interface PositionStrategyContext {
  wallet: `0x${string}`;
  positionId: string;
  chainId: number;
  poolAddress: `0x${string}`;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  currentPrice: number | null;
  createdAt: string;
  lastRebalanceAt?: string | null;
  token0Symbol?: string;
  token1Symbol?: string;
  analytics: {
    estimatedFeesUsd: number | null;
    estimatedApr: number | null;
    estimatedImpermanentLossUsd: number | null;
    estimatedPositionValueUsd: number | null;
    metricQuality: MetricQuality;
  };
  estimatedGasCostUsd: number;
}

export interface IlFeeEvaluationSummary {
  verdict: "CONTINUE" | "REBALANCE_CONSIDER" | "EXIT_CONSIDER";
  feeVsIlRatio: number | null;
  netFeesOverIl: number | null;
  rationale: string;
  shouldConsiderRebalance: boolean;
  shouldConsiderExit: boolean;
}

export interface StrategyRecommendation {
  status: RecommendationStatus;
  mode: StrategyMode;
  market: MarketStateDetectionResult;
  proposal: RangeProposal;
  decision: RebalanceDecision;
  rationale: string;
  explanationLines: string[];
  riskNotes: string[];
  confidence: number;
  computedAt: string;
  quality: {
    marketState: MetricQuality;
    proposal: MetricQuality;
    decision: MetricQuality;
  };
  /** IL vs 手数料評価（fee > IL 継続 / fee < IL リバランス検討） */
  ilFeeEvaluation?: IlFeeEvaluationSummary;
  /** ペア分類（VOLATILE / STABLE） */
  pairClassification?: PairClassification;
}
