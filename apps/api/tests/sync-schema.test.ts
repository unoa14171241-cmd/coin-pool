import { describe, expect, it } from "vitest";
import {
  syncIndexedPositionsResponseSchema,
  syncOverviewResponseSchema,
  syncRunResponseSchema,
  syncStatusResponseSchema
} from "../src/schemas/sync";

describe("sync schemas", () => {
  it("accepts sync run response payload", () => {
    const payload = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      actorRole: "owner",
      triggeredByWallet: "0x1111111111111111111111111111111111111111",
      requestedChainIds: [42161],
      results: [
        {
          wallet: "0x1111111111111111111111111111111111111111",
          chainId: 42161,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          outcome: "PARTIAL",
          discoveredTokenIds: ["1"],
          fetchedPositionsCount: 1,
          matchedLocalPositionsCount: 1,
          upsertedOnchainStatesCount: 1,
          errorCount: 1,
          errors: [{ step: "positions_multicall", message: "rpc timeout", tokenId: "1" }]
        }
      ],
      summary: {
        totalChains: 1,
        successChains: 0,
        partialChains: 1,
        errorChains: 0,
        totalErrors: 1
      }
    };
    expect(syncRunResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts sync status payload", () => {
    const payload = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      chains: [
        {
          chainId: 42161,
          totalPositions: 3,
          neverCount: 1,
          successCount: 1,
          partialCount: 1,
          errorCount: 0,
          lastSyncAttemptAt: new Date().toISOString(),
          lastSyncSuccessAt: new Date().toISOString(),
          latestSyncError: null,
          onchainStatesOwnedCount: 2
        }
      ]
    };
    expect(syncStatusResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts indexed positions payload", () => {
    const payload = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 42161,
      total: 1,
      indexedAt: new Date().toISOString(),
      positions: [
        {
          tokenId: "123",
          chainId: 42161,
          owner: "0x1111111111111111111111111111111111111111",
          operator: "0x2222222222222222222222222222222222222222",
          token0: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          token1: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          fee: 500,
          tickLower: -100,
          tickUpper: 100,
          liquidity: "1000",
          tokensOwed0: "10",
          tokensOwed1: "20",
          updatedAt: new Date().toISOString(),
          matchedLocalPosition: true
        }
      ]
    };
    expect(syncIndexedPositionsResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts sync overview payload", () => {
    const payload = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      actorRole: "owner",
      triggeredByWallet: "0x1111111111111111111111111111111111111111",
      chainId: 42161,
      syncStatus: {
        totalPositions: 3,
        neverCount: 1,
        successCount: 1,
        partialCount: 1,
        errorCount: 0,
        lastSyncAttemptAt: new Date().toISOString(),
        lastSyncSuccessAt: new Date().toISOString(),
        latestSyncError: null,
        onchainStatesOwnedCount: 2
      },
      indexing: {
        totalIndexed: 2,
        matchedLocalCount: 1,
        unmatchedDiscoveredCount: 1,
        indexedAt: new Date().toISOString()
      }
    };
    expect(syncOverviewResponseSchema.safeParse(payload).success).toBe(true);
  });
});
