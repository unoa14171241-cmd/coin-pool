import { describe, expect, it, vi } from "vitest";
import { WalletPositionSyncService, type WalletSyncStore } from "../src/services/indexer/wallet-position-sync";

function makeStore(): WalletSyncStore {
  return {
    listWalletPositions: vi.fn(async () => [
      {
        id: "row-1",
        positionId: "1",
        chainId: 42161,
        poolAddress: "0x1111111111111111111111111111111111111111",
        token0Address: "0x00000000000000000000000000000000000000b0",
        token1Address: "0x00000000000000000000000000000000000000c0",
        tickLower: -100,
        tickUpper: 100,
        status: "IN_RANGE" as const
      }
    ]),
    markSyncAttempt: vi.fn(async () => undefined),
    markSyncError: vi.fn(async () => undefined),
    markPositionSynced: vi.fn(async () => undefined),
    upsertOnchainPosition: vi.fn(async () => undefined)
  };
}

describe("sync fallback behavior", () => {
  it("keeps PARTIAL outcome when snapshot write fails for one position", async () => {
    const store = makeStore();
    const reader = {
      readWalletPositions: vi.fn(async () => ({
        wallet: "0x00000000000000000000000000000000000000ff" as `0x${string}`,
        chainId: 42161,
        positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as `0x${string}`,
        tokenIds: ["1"],
        positions: [
          {
            chainId: 42161,
            tokenId: "1",
            owner: "0x00000000000000000000000000000000000000ff" as `0x${string}`,
            positionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as `0x${string}`,
            operator: "0x00000000000000000000000000000000000000aa" as `0x${string}`,
            token0: "0x00000000000000000000000000000000000000b0" as `0x${string}`,
            token1: "0x00000000000000000000000000000000000000c0" as `0x${string}`,
            fee: 500,
            tickLower: -100,
            tickUpper: 100,
            liquidity: "100",
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
        savedSnapshots: 0,
        skippedFallback: 0,
        errors: [{ step: "snapshot_write" as const, positionId: "1", message: "write timeout" }]
      }))
    };
    const logger = vi.fn();
    const svc = new WalletPositionSyncService({
      reader,
      store,
      snapshotService,
      logger
    });

    const out = await svc.syncWalletPositions({
      wallet: "0x00000000000000000000000000000000000000ff",
      chainId: 42161
    });

    expect(out.outcome).toBe("PARTIAL");
    expect(out.errorCount).toBe(1);
    expect(out.errors[0]?.step).toBe("snapshot_write");
    expect((store.markSyncError as any).mock.calls.length).toBe(0);
    expect((store.markPositionSynced as any).mock.calls.length).toBeGreaterThan(0);
    expect(logger).toHaveBeenCalled();
  });
});
