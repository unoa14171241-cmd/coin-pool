import { describe, expect, it } from "vitest";
import { PositionAnalyticsEngine } from "../src/services/position-analytics";
import type { TokenPriceProvider } from "../src/services/token-price";

class FixedPriceProvider implements TokenPriceProvider {
  async getTokenUsdPrice(input: { tokenAddress: `0x${string}` }): Promise<number | null> {
    if (input.tokenAddress.toLowerCase() === "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") return 3000;
    if (input.tokenAddress.toLowerCase() === "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") return 1;
    return null;
  }
}

describe("PositionAnalyticsEngine", () => {
  it("returns placeholder fee analytics while preserving estimated wrapper", async () => {
    const engine = new PositionAnalyticsEngine(new FixedPriceProvider());
    const result = await engine.analyze({
      saved: {
        positionId: "1",
        chainId: 42161,
        feeTier: 500,
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        token0Symbol: "WETH",
        token1Symbol: "USDC",
        tickLower: -100,
        tickUpper: 100,
        createdAt: new Date().toISOString(),
        savedStatus: "IN_RANGE"
      },
      live: {
        currentTick: 0,
        currentPrice: 3000,
        sqrtPriceX96: "1",
        liquidity: "1000000000000000000",
        snapshotUpdatedAt: new Date().toISOString(),
        stale: false,
        source: "rpc"
      }
    });

    expect(result.analytics.status).toBe("estimated");
    expect(result.analytics.feeState.status).toBe("estimated");
  });

  it("returns exact fee analytics from on-chain owed tokens when available", async () => {
    const engine = new PositionAnalyticsEngine(new FixedPriceProvider());
    const result = await engine.analyze({
      saved: {
        positionId: "1",
        chainId: 42161,
        feeTier: 500,
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        token0Symbol: "WETH",
        token1Symbol: "USDC",
        tickLower: -100,
        tickUpper: 100,
        createdAt: new Date().toISOString(),
        savedStatus: "IN_RANGE"
      },
      live: {
        currentTick: 0,
        currentPrice: 3000,
        sqrtPriceX96: "1",
        liquidity: "1000000000000000000",
        snapshotUpdatedAt: new Date().toISOString(),
        stale: false,
        source: "rpc"
      },
      onchainFee: {
        tokensOwed0Raw: "1000000000000000", // 0.001 WETH
        tokensOwed1Raw: "1500000", // 1.5 USDC
        token0Decimals: 18,
        token1Decimals: 6
      }
    });

    expect(result.analytics.feeState.status).toBe("exact");
    expect(result.analytics.feeState.estimatedUncollectedFeesToken0).toBe(0.001);
    expect(result.analytics.feeState.estimatedUncollectedFeesToken1).toBe(1.5);
    expect(result.analytics.feeState.estimatedUncollectedFeesUsd).toBe(4.5);
  });

  it("estimates IL from reference and current price ratio", async () => {
    const engine = new PositionAnalyticsEngine(new FixedPriceProvider());
    const result = await engine.analyze({
      saved: {
        positionId: "2",
        chainId: 42161,
        feeTier: 500,
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        token0Symbol: "WETH",
        token1Symbol: "USDC",
        tickLower: -100,
        tickUpper: 100,
        createdAt: new Date().toISOString(),
        savedStatus: "IN_RANGE"
      },
      live: {
        currentTick: 0,
        currentPrice: 3000,
        sqrtPriceX96: "1",
        liquidity: "1000000000000000000",
        snapshotUpdatedAt: new Date().toISOString(),
        stale: false,
        source: "rpc"
      },
      referencePrice: 2000
    });

    expect(result.analytics.estimatedImpermanentLossPercent).not.toBeNull();
    expect((result.analytics.estimatedImpermanentLossPercent ?? 0) > 0).toBe(true);
    expect(result.analytics.estimatedImpermanentLossUsd).not.toBeNull();
  });

  it("annualizes APR and APY from holding period", async () => {
    const engine = new PositionAnalyticsEngine(new FixedPriceProvider());
    const createdAt = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const result = await engine.analyze({
      saved: {
        positionId: "3",
        chainId: 42161,
        feeTier: 500,
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        token0Symbol: "WETH",
        token1Symbol: "USDC",
        tickLower: -100,
        tickUpper: 100,
        createdAt,
        savedStatus: "IN_RANGE"
      },
      live: {
        currentTick: 0,
        currentPrice: 3000,
        sqrtPriceX96: "1",
        liquidity: "1000000000000000000",
        snapshotUpdatedAt: new Date().toISOString(),
        stale: false,
        source: "rpc"
      }
    });

    expect(result.analytics.estimatedApr).not.toBeNull();
    expect(result.analytics.estimatedApy).not.toBeNull();
  });
});

