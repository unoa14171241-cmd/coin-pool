import { describe, expect, it } from "vitest";
import { estimateGasCostUsd, toStrategyApiPayload } from "../src/services/position-strategy-response";

describe("position strategy response helpers", () => {
  it("estimates gas cost using defaults", () => {
    expect(estimateGasCostUsd({})).toBeGreaterThan(0);
  });

  it("builds strategy API payload with preview when analytics exists", () => {
    const payload = toStrategyApiPayload({
      walletAddress: "0x00000000000000000000000000000000000000AA",
      positionId: "1",
      recommendation: {
        status: "ok",
        mode: "BALANCED",
        market: {
          marketState: "RANGE",
          confidence: 0.7,
          volatility: 0.2,
          trendScore: 0,
          drift: 0,
          explanationLines: ["market"]
        },
        proposal: {
          suggestedCenterPrice: 2000,
          suggestedLowerPrice: 1800,
          suggestedUpperPrice: 2200,
          suggestedTickLower: -100,
          suggestedTickUpper: 100,
          widthPercent: 20,
          confidence: 0.7,
          rationale: "proposal",
          explanationLines: ["proposal"]
        },
        decision: {
          shouldRebalance: true,
          urgency: "HIGH",
          reasonCodes: ["OUT_OF_RANGE"],
          expectedBenefitUsd: 100,
          estimatedGasCostUsd: 5,
          netExpectedBenefitUsd: 95,
          explanationLines: ["decision"]
        },
        rationale: "test",
        explanationLines: ["line1"],
        riskNotes: ["risk1"],
        confidence: 0.8,
        computedAt: new Date().toISOString(),
        quality: {
          marketState: "heuristic",
          proposal: "heuristic",
          decision: "heuristic"
        }
      },
      analyticsRow: {
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
          currentTick: 150,
          currentPrice: 2000,
          sqrtPriceX96: null,
          liquidity: null,
          snapshotUpdatedAt: new Date().toISOString(),
          stale: false,
          source: "fallback"
        },
        analytics: {
          status: "estimated",
          estimatedPositionValueUsd: 1000,
          estimatedPnlUsd: 3,
          estimatedApr: 12,
          estimatedApy: 13,
          estimatedRoiPercent: 2,
          estimatedNetReturnUsd: 3,
          estimatedNetReturnPercent: 2,
          estimatedImpermanentLossUsd: 4,
          estimatedImpermanentLossPercent: 0.4,
          feeState: {
            status: "estimated",
            estimatedUncollectedFeesToken0: null,
            estimatedUncollectedFeesToken1: null,
            estimatedUncollectedFeesUsd: 10,
            note: "estimated"
          }
        },
        tokenAmounts: {
          token0Amount: null,
          token1Amount: null,
          method: "unavailable"
        }
      }
    });
    expect(payload.positionId).toBe("1");
    expect(payload.preview?.distanceFromRangeTicks).toBeGreaterThan(0);
  });
});
