import { describe, expect, it, vi } from "vitest";
import { PositionStrategyRecommendationService } from "../src/services/position-strategy-recommendation";
import type { PositionAnalyticsResult } from "../src/services/position-analytics";

function sampleAnalyticsRow(): PositionAnalyticsResult {
  return {
    saved: {
      positionId: "1",
      chainId: 42161,
      feeTier: 500,
      poolAddress: "0x00000000000000000000000000000000000000aa",
      token0Address: "0x00000000000000000000000000000000000000bb",
      token1Address: "0x00000000000000000000000000000000000000cc",
      token0Symbol: "WETH",
      token1Symbol: "USDC",
      tickLower: -100,
      tickUpper: 100,
      createdAt: new Date().toISOString(),
      savedStatus: "IN_RANGE"
    },
    live: {
      currentTick: 120,
      currentPrice: 2100,
      sqrtPriceX96: null,
      liquidity: null,
      snapshotUpdatedAt: new Date().toISOString(),
      stale: false,
      source: "rpc"
    },
    analytics: {
      status: "estimated",
      estimatedPositionValueUsd: 1000,
      estimatedPnlUsd: 10,
      estimatedApr: 12,
      estimatedApy: 13,
      estimatedRoiPercent: 2,
      estimatedNetReturnUsd: 10,
      estimatedNetReturnPercent: 2,
      estimatedImpermanentLossUsd: 5,
      estimatedImpermanentLossPercent: 0.5,
      feeState: {
        status: "estimated",
        estimatedUncollectedFeesToken0: null,
        estimatedUncollectedFeesToken1: null,
        estimatedUncollectedFeesUsd: 20
      }
    },
    tokenAmounts: {
      token0Amount: null,
      token1Amount: null,
      method: "unavailable"
    }
  };
}

describe("PositionStrategyRecommendationService", () => {
  it("uses configured mode from strategy state store", async () => {
    const strategyEngine = {
      evaluate: vi.fn(() => ({
        status: "hold",
        mode: "AGGRESSIVE",
        market: {
          marketState: "RANGE",
          confidence: 0.7,
          volatility: 0.2,
          trendScore: 0,
          drift: 0,
          explanationLines: []
        },
        proposal: {
          suggestedCenterPrice: 2000,
          suggestedLowerPrice: 1800,
          suggestedUpperPrice: 2200,
          suggestedTickLower: -100,
          suggestedTickUpper: 100,
          widthPercent: 20,
          confidence: 0.7,
          rationale: "test",
          explanationLines: []
        },
        decision: {
          shouldRebalance: false,
          urgency: "LOW",
          reasonCodes: [],
          expectedBenefitUsd: 0,
          estimatedGasCostUsd: 0,
          netExpectedBenefitUsd: 0,
          explanationLines: []
        },
        rationale: "test",
        explanationLines: [],
        riskNotes: [],
        confidence: 0.6,
        computedAt: new Date().toISOString(),
        quality: {
          marketState: "heuristic",
          proposal: "heuristic",
          decision: "heuristic"
        }
      }))
    };
    const strategyStateStore = {
      getPositionMode: vi.fn(async () => "AGGRESSIVE" as const),
      setPositionMode: vi.fn(async () => undefined)
    };
    const marketSnapshotStore = {
      getRecentSnapshots: vi.fn(async () => []),
      saveSnapshot: vi.fn(async () => undefined)
    };
    const svc = new PositionStrategyRecommendationService({
      strategyEngine: strategyEngine as any,
      strategyStateStore: strategyStateStore as any,
      marketSnapshotStore: marketSnapshotStore as any
    });

    await svc.buildRecommendation({
      walletAddress: "0x00000000000000000000000000000000000000AA",
      positionId: "1",
      mode: "BALANCED",
      analyticsRow: sampleAnalyticsRow()
    });

    expect((strategyEngine.evaluate as any).mock.calls.length).toBe(1);
    expect((strategyEngine.evaluate as any).mock.calls[0][0].mode).toBe("AGGRESSIVE");
    expect((marketSnapshotStore.saveSnapshot as any).mock.calls.length).toBe(1);
  });
});
