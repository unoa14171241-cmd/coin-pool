import { describe, expect, it, vi } from "vitest";
import { WalletPositionSyncService, type WalletSyncStore } from "../src/services/indexer/wallet-position-sync";

function createStoreMock(overrides: Partial<WalletSyncStore> = {}): WalletSyncStore {
  return {
    listWalletPositions: vi.fn(async () => []),
    markSyncAttempt: vi.fn(async () => undefined),
    markSyncError: vi.fn(async () => undefined),
    markPositionSynced: vi.fn(async () => undefined),
    upsertOnchainPosition: vi.fn(async () => undefined),
    ...overrides
  };
}

function localRow(positionId: string) {
  return {
    id: `row-${positionId}`,
    positionId,
    chainId: 42161,
    poolAddress: "0x1111111111111111111111111111111111111111",
    token0Address: "0x00000000000000000000000000000000000000b0",
    token1Address: "0x00000000000000000000000000000000000000c0",
    tickLower: -100,
    tickUpper: 100,
    status: "IN_RANGE" as const
  };
}

describe("WalletPositionSyncService", () => {
  it("returns SUCCESS when chain reads have no errors", async () => {
    const store = createStoreMock({
      listWalletPositions: vi.fn(async () => [localRow("11")])
    });
    const reader = {
      readWalletPositions: vi.fn(async () => ({
        wallet: "0x00000000000000000000000000000000000000ff" as `0x${string}`,
        chainId: 42161,
        positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as `0x${string}`,
        tokenIds: ["11"],
        positions: [
          {
            chainId: 42161,
            tokenId: "11",
            owner: "0x00000000000000000000000000000000000000ff" as `0x${string}`,
            positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as `0x${string}`,
            operator: "0x00000000000000000000000000000000000000aa" as `0x${string}`,
            token0: "0x00000000000000000000000000000000000000b0" as `0x${string}`,
            token1: "0x00000000000000000000000000000000000000c0" as `0x${string}`,
            fee: 500,
            tickLower: -100,
            tickUpper: 100,
            liquidity: "123",
            tokensOwed0: "1",
            tokensOwed1: "2",
            readAt: new Date().toISOString()
          }
        ],
        readAt: new Date().toISOString(),
        source: "rpc" as const,
        partialFailure: false,
        errors: []
      }))
    };
    const snapshotService = {
      saveForPositions: vi.fn(async () => ({
        attemptedPositions: 1,
        savedSnapshots: 1,
        skippedFallback: 0,
        errors: [],
        status: "complete" as const
      }))
    };
    const svc2 = new WalletPositionSyncService({ reader, store, snapshotService });
    const out = await svc2.syncWalletPositions({
      wallet: "0x00000000000000000000000000000000000000ff",
      chainId: 42161
    });

    expect(out.outcome).toBe("SUCCESS");
    expect(out.matchedLocalPositionsCount).toBe(1);
    expect(out.upsertedOnchainStatesCount).toBe(1);
    expect((store.markPositionSynced as any).mock.calls[0][0].status).toBe("SUCCESS");
  });

  it("returns PARTIAL when token-level errors exist", async () => {
    const store = createStoreMock({
      listWalletPositions: vi.fn(async () => [localRow("11")])
    });
    const reader = {
      readWalletPositions: vi.fn(async () => ({
        wallet: "0x00000000000000000000000000000000000000ff" as `0x${string}`,
        chainId: 42161,
        positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as `0x${string}`,
        tokenIds: ["11"],
        positions: [
          {
            chainId: 42161,
            tokenId: "11",
            owner: "0x00000000000000000000000000000000000000ff" as `0x${string}`,
            positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as `0x${string}`,
            operator: "0x00000000000000000000000000000000000000aa" as `0x${string}`,
            token0: "0x00000000000000000000000000000000000000b0" as `0x${string}`,
            token1: "0x00000000000000000000000000000000000000c0" as `0x${string}`,
            fee: 500,
            tickLower: -100,
            tickUpper: 100,
            liquidity: "123",
            tokensOwed0: "1",
            tokensOwed1: "2",
            readAt: new Date().toISOString()
          }
        ],
        readAt: new Date().toISOString(),
        source: "fallback" as const,
        partialFailure: true,
        errors: [{ step: "positions_multicall" as const, tokenId: "11", message: "multicall failed" }]
      }))
    };
    const snapshotService = {
      saveForPositions: vi.fn(async () => ({
        attemptedPositions: 1,
        savedSnapshots: 1,
        skippedFallback: 0,
        errors: [],
        status: "complete" as const
      }))
    };
    const svc = new WalletPositionSyncService({ reader, store, snapshotService });
    const out = await svc.syncWalletPositions({
      wallet: "0x00000000000000000000000000000000000000ff",
      chainId: 42161
    });

    expect(out.outcome).toBe("PARTIAL");
    expect((store.markPositionSynced as any).mock.calls[0][0].status).toBe("PARTIAL");
    expect((store.markPositionSynced as any).mock.calls[0][0].errorMessage).toBe("multicall failed");
  });

  it("returns ERROR and marks local rows on full read failure", async () => {
    const store = createStoreMock({
      listWalletPositions: vi.fn(async () => [localRow("11")])
    });
    const reader = {
      readWalletPositions: vi.fn(async () => ({
        wallet: "0x00000000000000000000000000000000000000ff" as `0x${string}`,
        chainId: 42161,
        positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as `0x${string}`,
        tokenIds: [],
        positions: [],
        readAt: new Date().toISOString(),
        source: "fallback" as const,
        partialFailure: true,
        errors: [{ step: "balanceOf" as const, message: "rpc down" }]
      }))
    };
    const snapshotService = {
      saveForPositions: vi.fn(async () => ({
        attemptedPositions: 0,
        savedSnapshots: 0,
        skippedFallback: 0,
        errors: [],
        status: "complete" as const
      }))
    };
    const svc = new WalletPositionSyncService({ reader, store, snapshotService });
    const out = await svc.syncWalletPositions({
      wallet: "0x00000000000000000000000000000000000000ff",
      chainId: 42161
    });

    expect(out.outcome).toBe("ERROR");
    expect((store.markSyncError as any).mock.calls.length).toBe(1);
    expect((store.markSyncError as any).mock.calls[0][0].errorMessage).toBe("rpc down");
  });
});
