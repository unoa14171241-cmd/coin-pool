import type { PositionAnalyticsResult } from "./position-analytics";
import type { StrategyRecommendation } from "./strategy";

export function estimateGasCostUsd(input: { gasPriceGwei?: number; gasUnits?: number }): number {
  const gasPriceGwei = input.gasPriceGwei ?? 0.12;
  const gasUnits = input.gasUnits ?? 420_000;
  const ethUsd = 3000; // Estimated only; route-level preview heuristic.
  const cost = gasPriceGwei * 1e-9 * gasUnits * ethUsd;
  return Number(cost.toFixed(2));
}

export function toStrategyApiPayload(input: {
  walletAddress: `0x${string}`;
  positionId: string;
  recommendation: StrategyRecommendation;
  analyticsRow?: PositionAnalyticsResult;
}) {
  const preview = input.analyticsRow ? buildRebalancePreview(input.analyticsRow, input.recommendation) : undefined;
  return {
    positionId: input.positionId,
    walletAddress: input.walletAddress,
    mode: input.recommendation.mode,
    marketState: input.recommendation.market.marketState,
    marketConfidence: input.recommendation.market.confidence,
    marketVolatility: input.recommendation.market.volatility,
    marketTrendScore: input.recommendation.market.trendScore,
    suggestion: {
      suggestedCenterPrice: input.recommendation.proposal.suggestedCenterPrice,
      suggestedLowerPrice: input.recommendation.proposal.suggestedLowerPrice,
      suggestedUpperPrice: input.recommendation.proposal.suggestedUpperPrice,
      suggestedTickLower: input.recommendation.proposal.suggestedTickLower,
      suggestedTickUpper: input.recommendation.proposal.suggestedTickUpper,
      widthPercent: input.recommendation.proposal.widthPercent,
      confidence: input.recommendation.proposal.confidence
    },
    decision: {
      shouldRebalance: input.recommendation.decision.shouldRebalance,
      urgency: input.recommendation.decision.urgency,
      reasonCodes: input.recommendation.decision.reasonCodes,
      expectedBenefitUsd: input.recommendation.decision.expectedBenefitUsd,
      estimatedGasCostUsd: input.recommendation.decision.estimatedGasCostUsd,
      netExpectedBenefitUsd: input.recommendation.decision.netExpectedBenefitUsd
    },
    rationale: input.recommendation.rationale,
    explanationLines: input.recommendation.explanationLines,
    riskNotes: input.recommendation.riskNotes,
    confidence: input.recommendation.confidence,
    quality: input.recommendation.quality,
    source: "strategy-engine",
    generatedAt: input.recommendation.computedAt,
    stale: Date.now() - Date.parse(input.recommendation.computedAt) > 30_000,
    preview,
    computedAt: input.recommendation.computedAt,
    ilFeeEvaluation: input.recommendation.ilFeeEvaluation,
    pairClassification: input.recommendation.pairClassification
  };
}

function buildRebalancePreview(analyticsRow: PositionAnalyticsResult, recommendation: StrategyRecommendation) {
  const currentTick = analyticsRow.live.currentTick;
  const distanceFromRangeTicks =
    currentTick < analyticsRow.saved.tickLower
      ? analyticsRow.saved.tickLower - currentTick
      : currentTick >= analyticsRow.saved.tickUpper
        ? currentTick - analyticsRow.saved.tickUpper
        : 0;
  return {
    currentRange: {
      tickLower: analyticsRow.saved.tickLower,
      tickUpper: analyticsRow.saved.tickUpper
    },
    proposedRange: {
      tickLower: recommendation.proposal.suggestedTickLower,
      tickUpper: recommendation.proposal.suggestedTickUpper
    },
    currentPrice: analyticsRow.live.currentPrice,
    distanceFromRangeTicks,
    expectedFeeImprovementUsd: recommendation.decision.expectedBenefitUsd,
    confidenceScore: recommendation.confidence,
    riskNotes: recommendation.riskNotes
  };
}
