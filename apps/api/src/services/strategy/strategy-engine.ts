import { RuleBasedMarketStateDetector, type MarketStateDetector } from "./market-state-detector";
import { RuleBasedRangeProposalEngine, type RangeProposalEngine } from "./range-proposal-engine";
import { RuleBasedRebalanceDecisionEngine, type RebalanceDecisionEngine } from "./rebalance-decision-engine";
import { normalizeProposedRange, tickSpacingForFeeTier, tickFromPrice } from "./range-utils";
import { STRATEGY_MODE_CONFIG } from "./types";
import { classifyPair } from "./pair-classifier";
import { evaluateIlVsFees } from "./il-fee-evaluator";
import { rebalanceToEqualWeight } from "./rebalance-ratio-utils";
import type {
  MarketSnapshotPoint,
  PositionStrategyContext,
  StrategyMode,
  StrategyRecommendation,
  MetricQuality
} from "./types";

export interface RangeStrategyEngine {
  evaluate(input: {
    mode: StrategyMode;
    context: PositionStrategyContext;
    recentSnapshots: MarketSnapshotPoint[];
    nowMs?: number;
  }): StrategyRecommendation;
}

export class DefaultRangeStrategyEngine implements RangeStrategyEngine {
  constructor(
    private readonly marketStateDetector: MarketStateDetector = new RuleBasedMarketStateDetector(),
    private readonly rangeProposalEngine: RangeProposalEngine = new RuleBasedRangeProposalEngine(),
    private readonly rebalanceDecisionEngine: RebalanceDecisionEngine = new RuleBasedRebalanceDecisionEngine()
  ) {}

  evaluate(input: {
    mode: StrategyMode;
    context: PositionStrategyContext;
    recentSnapshots: MarketSnapshotPoint[];
    nowMs?: number;
  }): StrategyRecommendation {
    const nowMs = input.nowMs ?? Date.now();
    const riskNotes: string[] = [];
    const precheck = runSafetyPrechecks(input.context, input.recentSnapshots);
    if (precheck.rejected) {
      return {
        status: "reject",
        mode: input.mode,
        market: {
          marketState: "UNKNOWN",
          confidence: 0.2,
          volatility: 0,
          trendScore: 0,
          drift: 0,
          explanationLines: precheck.explanationLines
        },
        proposal: {
          suggestedCenterPrice: input.context.currentPrice,
          suggestedLowerPrice: input.context.currentPrice,
          suggestedUpperPrice: input.context.currentPrice,
          suggestedTickLower: input.context.tickLower,
          suggestedTickUpper: input.context.tickUpper,
          widthPercent: 0,
          confidence: 0.2,
          rationale: "Safety reject",
          explanationLines: precheck.explanationLines
        },
        decision: {
          shouldRebalance: false,
          urgency: "LOW",
          reasonCodes: precheck.reasonCodes,
          expectedBenefitUsd: 0,
          estimatedGasCostUsd: input.context.estimatedGasCostUsd,
          netExpectedBenefitUsd: -input.context.estimatedGasCostUsd,
          explanationLines: precheck.explanationLines
        },
        rationale: "Strategy rejected by safety rules",
        explanationLines: precheck.explanationLines,
        riskNotes: ["Unsupported/invalid input rejected before strategy evaluation."],
        confidence: 0.2,
        computedAt: new Date(nowMs).toISOString(),
        quality: {
          marketState: "heuristic",
          proposal: "heuristic",
          decision: "heuristic"
        }
      };
    }

    const market = this.marketStateDetector.detect({
      chainId: input.context.chainId,
      poolAddress: input.context.poolAddress,
      currentTick: input.context.currentTick,
      currentPrice: input.context.currentPrice,
      recentSnapshots: input.recentSnapshots,
      feeTier: input.context.feeTier
    });

    const pairClassification = classifyPair({
      token0Symbol: input.context.token0Symbol ?? "UNKNOWN",
      token1Symbol: input.context.token1Symbol ?? "UNKNOWN"
    }).classification;

    const proposal = this.rangeProposalEngine.propose({
      mode: input.mode,
      market,
      currentPrice: input.context.currentPrice,
      currentTick: input.context.currentTick,
      feeTier: input.context.feeTier,
      pairClassification
    });

    const currentPrice = input.context.currentPrice ?? 0;
    const adjustedCenter = rebalanceToEqualWeight(
      proposal.suggestedCenterPrice,
      currentPrice > 0 ? currentPrice : 1,
      1000
    );
    if (adjustedCenter != null && proposal.suggestedCenterPrice != null && adjustedCenter !== proposal.suggestedCenterPrice) {
      proposal.suggestedCenterPrice = adjustedCenter;
      const half = (proposal.widthPercent ?? 10) / 200;
      proposal.suggestedLowerPrice = adjustedCenter * (1 - half);
      proposal.suggestedUpperPrice = adjustedCenter * (1 + half);
      const halfWidthTicks = Math.round((proposal.suggestedTickUpper - proposal.suggestedTickLower) / 2);
      const rawTickCenter = tickFromPrice(adjustedCenter);
      const newTickLower = rawTickCenter - halfWidthTicks;
      const newTickUpper = rawTickCenter + halfWidthTicks;
      const normalizedFromCenter = normalizeProposedRange({
        tickLower: newTickLower,
        tickUpper: newTickUpper,
        feeTier: input.context.feeTier
      });
      proposal.suggestedTickLower = normalizedFromCenter.tickLower;
      proposal.suggestedTickUpper = normalizedFromCenter.tickUpper;
    }

    const normalized = normalizeProposedRange({
      tickLower: proposal.suggestedTickLower,
      tickUpper: proposal.suggestedTickUpper,
      feeTier: input.context.feeTier
    });
    proposal.suggestedTickLower = normalized.tickLower;
    proposal.suggestedTickUpper = normalized.tickUpper;

    const lastActionAtMs = Date.parse(input.context.lastRebalanceAt ?? input.context.createdAt);
    const cooldownRemainingMs = Math.max(0, STRATEGY_MODE_CONFIG[input.mode].cooldownMs - (nowMs - lastActionAtMs));
    const expectedFeeOpportunityUsd = estimateFeeOpportunityUsd(input.context, market);

    const ilFeeEvaluation = evaluateIlVsFees({
      estimatedImpermanentLossUsd: input.context.analytics.estimatedImpermanentLossUsd,
      estimatedUncollectedFeesUsd: input.context.analytics.estimatedFeesUsd,
      positionValueUsd: input.context.analytics.estimatedPositionValueUsd
    });

    const decision = this.rebalanceDecisionEngine.decide({
      mode: input.mode,
      currentTick: input.context.currentTick,
      currentPrice: input.context.currentPrice,
      currentTickLower: input.context.tickLower,
      currentTickUpper: input.context.tickUpper,
      proposed: proposal,
      market,
      estimatedGasCostUsd: input.context.estimatedGasCostUsd,
      currentUncollectedFeesUsd: input.context.analytics.estimatedFeesUsd ?? 0,
      expectedFeeOpportunityUsd,
      cooldownRemainingMs,
      ilFeeEvaluation: {
        verdict: ilFeeEvaluation.verdict,
        shouldConsiderRebalance: ilFeeEvaluation.shouldConsiderRebalance,
        shouldConsiderExit: ilFeeEvaluation.shouldConsiderExit
      }
    });

    const staleMs = input.recentSnapshots.length
      ? nowMs - Date.parse(input.recentSnapshots[input.recentSnapshots.length - 1].snapshotAt)
      : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(staleMs) || staleMs > 1000 * 60 * 10) {
      riskNotes.push("Market snapshot data is stale; confidence reduced.");
    }
    if (input.recentSnapshots.length < 4) {
      riskNotes.push("Limited snapshot history; detector uses conservative fallback.");
    }
    if (market.marketState === "LOW_LIQUIDITY") {
      riskNotes.push("Low liquidity state may increase slippage and execution risk.");
    }
    if (proposal.suggestedTickUpper - proposal.suggestedTickLower < (tickSpacingForFeeTier(input.context.feeTier) ?? 1) * 4) {
      riskNotes.push("Proposed range is narrow and sensitive to micro-volatility.");
    }
    if (ilFeeEvaluation.shouldConsiderExit) {
      riskNotes.push(`IL vs fee: ${ilFeeEvaluation.rationale}`);
    }

    const explanationLines = [
      ...market.explanationLines,
      ...proposal.explanationLines,
      ...decision.explanationLines
    ];
    const confidence = Number(
      Math.max(0.15, Math.min(0.95, (market.confidence + proposal.confidence + (decision.shouldRebalance ? 0.75 : 0.6)) / 3)).toFixed(3)
    );

    return {
      status: decision.shouldRebalance ? "ok" : "hold",
      mode: input.mode,
      market,
      proposal,
      decision,
      rationale: proposal.rationale,
      explanationLines,
      riskNotes,
      confidence,
      computedAt: new Date(nowMs).toISOString(),
      quality: {
        marketState: "heuristic",
        proposal: inferProposalQuality(input.context.analytics.metricQuality),
        decision: "heuristic"
      },
      ilFeeEvaluation: {
        verdict: ilFeeEvaluation.verdict,
        feeVsIlRatio: ilFeeEvaluation.feeVsIlRatio,
        netFeesOverIl: ilFeeEvaluation.netFeesOverIl,
        rationale: ilFeeEvaluation.rationale,
        shouldConsiderRebalance: ilFeeEvaluation.shouldConsiderRebalance,
        shouldConsiderExit: ilFeeEvaluation.shouldConsiderExit
      },
      pairClassification
    };
  }
}

function estimateFeeOpportunityUsd(context: PositionStrategyContext, market: StrategyRecommendation["market"]): number {
  const positionValue = context.analytics.estimatedPositionValueUsd ?? 0;
  const apr = (context.analytics.estimatedApr ?? 0) / 100;
  const stateBoost =
    market.marketState === "RANGE"
      ? 1.15
      : market.marketState === "UP_TREND" || market.marketState === "DOWN_TREND"
        ? 1.05
        : market.marketState === "HIGH_VOLATILITY"
          ? 0.9
          : 0.7;
  // Heuristic 7-day fee opportunity estimate.
  return Number((positionValue * apr * (7 / 365) * stateBoost).toFixed(2));
}

function inferProposalQuality(analyticsQuality: MetricQuality): MetricQuality {
  if (analyticsQuality === "exact") return "estimated";
  return "heuristic";
}

function runSafetyPrechecks(
  context: PositionStrategyContext,
  snapshots: MarketSnapshotPoint[]
): { rejected: boolean; reasonCodes: string[]; explanationLines: string[] } {
  const reasonCodes: string[] = [];
  const explanationLines: string[] = [];
  if (!tickSpacingForFeeTier(context.feeTier)) {
    reasonCodes.push("UNSUPPORTED_FEE_TIER");
    explanationLines.push("Unsupported fee tier for dynamic tick normalization.");
  }
  if (context.tickLower >= context.tickUpper) {
    reasonCodes.push("INVALID_RANGE");
    explanationLines.push("Current position range is invalid (lower >= upper).");
  }
  if (!context.poolAddress || !context.poolAddress.startsWith("0x")) {
    reasonCodes.push("INVALID_POOL");
    explanationLines.push("Pool address is invalid or missing.");
  }
  if (context.estimatedGasCostUsd <= 0) {
    explanationLines.push("Gas estimate missing; strategy uses conservative assumptions.");
  }
  if (snapshots.length === 0) {
    explanationLines.push("No recent market snapshots available.");
  }
  return { rejected: reasonCodes.length > 0, reasonCodes, explanationLines };
}
