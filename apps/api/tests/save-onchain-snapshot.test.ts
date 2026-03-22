import { describe, expect, it, vi } from "vitest";
import { SaveOnchainSnapshotService, type PositionSnapshotStore } from "../src/services/snapshots/save-onchain-snapshot";
import type { PositionLiveStateLoader } from "../src/services/positions-live";

describe("SaveOnchainSnapshotService", () => {
  it("saves snapshots for non-fallback live states", async () => {
    const liveLoader: PositionLiveStateLoader = {
      enrich: vi.fn(async () => ({
        byPositionId: new Map([
          [
            "1",
            {
              currentTick: 123,
              currentPrice: 3000,
              computedStatus: "IN_RANGE" as const,
              token1PerToken0: 3000,
              sqrtPriceX96: "1",
              liquidity: "10",
              snapshotUpdatedAt: new Date().toISOString(),
              stale: false,
              liveStateSource: "rpc" as const
            }
          ]
        ]),
        stats: {
          uniquePools: 1,
          livePoolFetches: 1,
          requestSnapshotCacheHits: 0,
          crossRequestSnapshotCacheHits: 0,
          snapshotCacheMisses: 1,
          decimalsRequestCacheHits: 0,
          decimalsCrossRequestCacheHits: 0,
          decimalsCacheMisses: 1,
          multicallCount: 1,
          fallbackCount: 0
        }
      }))
    };
    const snapshotStore: PositionSnapshotStore = {
      save: vi.fn(async () => undefined),
      saveBatch: vi.fn(async () => { /* テストではDB接続不要 */ })
    };
    const service = new SaveOnchainSnapshotService({
      liveLoader,
      snapshotStore
    });
    const out = await service.saveForPositions([
      {
        positionId: "1",
        chainId: 42161,
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Address: "0x00000000000000000000000000000000000000b0",
        token1Address: "0x00000000000000000000000000000000000000c0",
        tickLower: -100,
        tickUpper: 100,
        savedStatus: "IN_RANGE"
      }
    ]);

    expect(out.savedSnapshots).toBe(1);
    expect(out.skippedFallback).toBe(0);
    expect(out.errors).toEqual([]);
    expect(out.status).toBe("complete");
  });

  it("skips fallback snapshots", async () => {
    const liveLoader: PositionLiveStateLoader = {
      enrich: vi.fn(async () => ({
        byPositionId: new Map([
          [
            "1",
            {
              currentTick: 0,
              currentPrice: null,
              computedStatus: "OUT_OF_RANGE" as const,
              token1PerToken0: null,
              sqrtPriceX96: null,
              liquidity: null,
              snapshotUpdatedAt: new Date().toISOString(),
              stale: true,
              liveStateSource: "fallback" as const
            }
          ]
        ]),
        stats: {
          uniquePools: 1,
          livePoolFetches: 1,
          requestSnapshotCacheHits: 0,
          crossRequestSnapshotCacheHits: 0,
          snapshotCacheMisses: 1,
          decimalsRequestCacheHits: 0,
          decimalsCrossRequestCacheHits: 0,
          decimalsCacheMisses: 1,
          multicallCount: 1,
          fallbackCount: 1
        }
      }))
    };
    const snapshotStore: PositionSnapshotStore = {
      save: vi.fn(async () => undefined)
    };
    const service = new SaveOnchainSnapshotService({
      liveLoader,
      snapshotStore
    });
    const out = await service.saveForPositions([
      {
        positionId: "1",
        chainId: 42161,
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Address: "0x00000000000000000000000000000000000000b0",
        token1Address: "0x00000000000000000000000000000000000000c0",
        tickLower: -100,
        tickUpper: 100,
        savedStatus: "IN_RANGE"
      }
    ]);

    expect(out.savedSnapshots).toBe(0);
    expect(out.skippedFallback).toBe(1);
    expect(out.status).toBe("incomplete");
    expect((snapshotStore.save as any).mock.calls.length).toBe(0);
  });
});
