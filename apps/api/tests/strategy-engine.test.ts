import { describe, expect, it } from "vitest";
import {
  DefaultRangeStrategyEngine,
  RuleBasedMarketStateDetector,
  RuleBasedRangeProposalEngine,
  RuleBasedRebalanceDecisionEngine
} from "../src/services/strategy";
import type { MarketSnapshotPoint, PositionStrategyContext } from "../src/services/strategy";

function buildSnapshots(): MarketSnapshotPoint[] {
  const out: MarketSnapshotPoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 16; i += 1) {
    out.push({
      snapshotAt: new Date(now - (16 - i) * 60_000).toISOString(),
      currentTick: 1000 + i * 3,
      currentPrice: 3000 + i * 4,
      liquidity: "1000000000",
      volumeProxy: null,
      volatilityScore: null
    });
  }
  return out;
}

function buildContext(): PositionStrategyContext {
  return {
    wallet: "0x1234567890123456789012345678901234567890",
    positionId: "1",
    chainId: 42161,
    poolAddress: "0x1111111111111111111111111111111111111111",
    feeTier: 500,
    tickLower: 800,
    tickUpper: 1100,
    currentTick: 1200,
    currentPrice: 3200,
    createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    analytics: {
      estimatedFeesUsd: 12,
      estimatedApr: 20,
      estimatedImpermanentLossUsd: 4,
      estimatedPositionValueUsd: 5000,
      metricQuality: "estimated"
    },
    estimatedGasCostUsd: 6
  };
}

describe("strategy engine", () => {
  it("detects trend with positive drift", () => {
    const detector = new RuleBasedMarketStateDetector();
    const snapshots = buildSnapshots();
    const out = detector.detect({
      chainId: 42161,
      poolAddress: "0x1111111111111111111111111111111111111111",
      currentTick: 1200,
      currentPrice: 3200,
      recentSnapshots: snapshots,
      feeTier: 500
    });
    expect(["UP_TREND", "RANGE", "HIGH_VOLATILITY"]).toContain(out.marketState);
    expect(out.confidence).toBeGreaterThan(0);
  });

  it("returns normalized proposed ticks", () => {
    const engine = new RuleBasedRangeProposalEngine();
    const proposal = engine.propose({
      mode: "BALANCED",
      market: {
        marketState: "UP_TREND",
        confidence: 0.8,
        volatility: 0.01,
        trendScore: 0.02,
        drift: 0.03,
        explanationLines: []
      },
      currentPrice: 3200,
      currentTick: 1200,
      feeTier: 500
    });
    expect(proposal.suggestedTickLower).toBeLessThan(proposal.suggestedTickUpper);
    expect(proposal.widthPercent).toBeGreaterThan(0);
  });

  it("skips rebalance when net benefit is negative", () => {
    const decisionEngine = new RuleBasedRebalanceDecisionEngine();
    const decision = decisionEngine.decide({
      mode: "CONSERVATIVE",
      currentTick: 1000,
      currentPrice: 3000,
      currentTickLower: 900,
      currentTickUpper: 1100,
      proposed: {
        suggestedCenterPrice: 3000,
        suggestedLowerPrice: 2800,
        suggestedUpperPrice: 3200,
        suggestedTickLower: 900,
        suggestedTickUpper: 1100,
        widthPercent: 8,
        confidence: 0.8,
        rationale: "test",
        explanationLines: []
      },
      market: {
        marketState: "RANGE",
        confidence: 0.7,
        volatility: 0.01,
        trendScore: 0,
        drift: 0,
        explanationLines: []
      },
      estimatedGasCostUsd: 20,
      currentUncollectedFeesUsd: 1,
      expectedFeeOpportunityUsd: 2,
      cooldownRemainingMs: 0
    });
    expect(decision.shouldRebalance).toBe(false);
    expect(decision.netExpectedBenefitUsd).toBeLessThanOrEqual(0);
  });

  it("integrates market/proposal/decision into recommendation", () => {
    const engine = new DefaultRangeStrategyEngine();
    const recommendation = engine.evaluate({
      mode: "BALANCED",
      context: buildContext(),
      recentSnapshots: buildSnapshots()
    });
    expect(recommendation.mode).toBe("BALANCED");
    expect(recommendation.proposal.suggestedTickLower).toBeLessThan(recommendation.proposal.suggestedTickUpper);
    expect(recommendation.explanationLines.length).toBeGreaterThan(0);
  });
});
