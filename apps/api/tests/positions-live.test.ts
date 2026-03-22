import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPositionsLiveCachesForTests,
  enrichPositionsWithLiveState,
  type PoolSnapshot,
  type PositionLiveInputRow
} from "../src/services/positions-live";
import { positionsResponseSchema } from "../src/schemas/position";

const poolA = "0x1111111111111111111111111111111111111111" as const;
const poolB = "0x2222222222222222222222222222222222222222" as const;
const tokenA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const tokenB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

function makeRow(overrides: Partial<PositionLiveInputRow> = {}): PositionLiveInputRow {
  return {
    positionId: "1",
    chainId: 42161,
    poolAddress: poolA,
    token0Address: tokenA,
    token1Address: tokenB,
    tickLower: 100,
    tickUpper: 200,
    savedStatus: "IN_RANGE",
    ...overrides
  };
}

function okSnapshot(tick: number): PoolSnapshot {
  return {
    currentTick: tick,
    token1PerToken0: 3000,
    poolToken0: tokenA,
    poolToken1: tokenB,
    sqrtPriceX96: "1",
    liquidity: "1",
    snapshotUpdatedAt: new Date().toISOString(),
    stale: false,
    liveStateSource: "rpc"
  };
}

describe("positions live enrichment", () => {
  beforeEach(async () => {
    await __resetPositionsLiveCachesForTests();
  });

  it("fetches duplicate pools only once", async () => {
    const reader = vi.fn(async () => ({ snapshot: okSnapshot(150), isFallback: false as const }));
    const rows = [
      makeRow({ positionId: "1" }),
      makeRow({ positionId: "2" }),
      makeRow({ positionId: "3", poolAddress: poolB })
    ];
    const out = await enrichPositionsWithLiveState(rows, { poolSnapshotReader: reader });

    expect(reader).toHaveBeenCalledTimes(2);
    expect(out.stats.uniquePools).toBe(2);
    expect(out.stats.livePoolFetches).toBe(2);
  });

  it("falls back for one pool without breaking others", async () => {
    const reader = vi.fn(async (input: { poolAddress: string; chainId: number; context: unknown; stats: unknown }) => {
      if (input.poolAddress.toLowerCase() === poolB.toLowerCase()) {
        return {
          snapshot: {
            currentTick: 0,
            token1PerToken0: null,
            poolToken0: "0x0000000000000000000000000000000000000000" as const,
            poolToken1: "0x0000000000000000000000000000000000000000" as const,
            sqrtPriceX96: null,
            liquidity: null,
            snapshotUpdatedAt: new Date().toISOString(),
            stale: true,
            liveStateSource: "fallback" as const
          },
          isFallback: true as const,
          step: "slot0" as const,
          errorMessage: "rpc down"
        };
      }
      return { snapshot: okSnapshot(150), isFallback: false as const };
    });
    const rows = [
      makeRow({ positionId: "ok", poolAddress: poolA }),
      makeRow({ positionId: "fallback", poolAddress: poolB, tickLower: -100, tickUpper: 50 })
    ];
    const out = await enrichPositionsWithLiveState(rows, { poolSnapshotReader: reader });

    expect(out.byPositionId.get("ok")?.currentTick).toBe(150);
    expect(out.byPositionId.get("ok")?.computedStatus).toBe("IN_RANGE");
    expect(out.byPositionId.get("fallback")?.currentTick).toBe(0);
    expect(out.byPositionId.get("fallback")?.currentPrice).toBeNull();
  });

  it("computes status from live tick", async () => {
    const reader = vi.fn(async () => ({ snapshot: okSnapshot(99), isFallback: false as const }));
    const rows = [makeRow({ tickLower: 100, tickUpper: 200, savedStatus: "IN_RANGE" })];
    const out = await enrichPositionsWithLiveState(rows, { poolSnapshotReader: reader });
    expect(out.byPositionId.get("1")?.computedStatus).toBe("OUT_OF_RANGE");
  });

  it("uses cross-request snapshot cache", async () => {
    const reader = vi.fn(async () => ({ snapshot: okSnapshot(150), isFallback: false as const }));
    const rows = [makeRow({ positionId: "1" })];

    const first = await enrichPositionsWithLiveState(rows, {
      poolSnapshotReader: reader,
      nowMs: 1_000
    });
    const second = await enrichPositionsWithLiveState(rows, {
      poolSnapshotReader: reader,
      nowMs: 1_500
    });

    expect(reader).toHaveBeenCalledTimes(1);
    expect(first.stats.crossRequestSnapshotCacheHits).toBe(0);
    expect(second.stats.crossRequestSnapshotCacheHits).toBe(1);
  });

  it("keeps response schema valid", () => {
    const payload = [
      {
        id: "1",
        nftTokenId: "1",
        chainId: 42161,
        chainName: "Arbitrum",
        walletAddress: "0x1234567890123456789012345678901234567890",
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Symbol: "WETH",
        token1Symbol: "USDC",
        token0Address: tokenA,
        token1Address: tokenB,
        feeTier: 500,
        tickLower: 100,
        tickUpper: 200,
        currentPrice: 3000,
        currentTick: 150,
        savedStatus: "IN_RANGE",
        computedStatus: "IN_RANGE",
        liveState: { currentTick: 150, currentPrice: 3000, computedStatus: "IN_RANGE" },
        isPlaceholderMetrics: true,
        isPlaceholderValuation: true,
        isPlaceholderYieldMetrics: true,
        placeholderMetrics: { isPlaceholderValuation: true, isPlaceholderYieldMetrics: true },
        uncollectedFeesUsd: 1,
        valueUsd: 2,
        estimatedApr: 3,
        createdAt: new Date().toISOString(),
        sync: {
          status: "PARTIAL",
          lastAttemptAt: new Date().toISOString(),
          lastSuccessAt: null,
          error: "rpc timeout"
        },
        status: "IN_RANGE"
      }
    ];
    const parsed = positionsResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

