import { getAddress, isAddress } from "viem";
import { prisma } from "../../db/prisma";
import { UniswapPositionReader, type WalletOnchainPosition, type WalletOnchainPositionsReadResult } from "../onchain/uniswap-position-reader";
import { SaveOnchainSnapshotService, type LocalPositionForSnapshot } from "../snapshots/save-onchain-snapshot";
import type { WalletPositionSyncInput, WalletPositionSyncResult } from "./types";

type LocalPositionRow = {
  id: string;
  positionId: string;
  chainId: number;
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  tickLower: number;
  tickUpper: number;
  status: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
};

export interface WalletSyncStore {
  listWalletPositions(input: { walletLower: string; chainId: number }): Promise<LocalPositionRow[]>;
  markSyncAttempt(input: { ids: string[]; attemptedAt: Date }): Promise<void>;
  markSyncError(input: { ids: string[]; attemptedAt: Date; errorMessage: string }): Promise<void>;
  markPositionSynced(input: {
    positionId: string;
    attemptedAt: Date;
    successAt: Date;
    status: "SUCCESS" | "PARTIAL";
    errorMessage: string | null;
  }): Promise<void>;
  upsertOnchainPosition(input: { chainId: number; position: WalletOnchainPosition }): Promise<void>;
}

class PrismaWalletSyncStore implements WalletSyncStore {
  async listWalletPositions(input: { walletLower: string; chainId: number }): Promise<LocalPositionRow[]> {
    return prisma.position.findMany({
      where: {
        wallet: input.walletLower,
        chainId: input.chainId
      },
      select: {
        id: true,
        positionId: true,
        chainId: true,
        poolAddress: true,
        token0Address: true,
        token1Address: true,
        tickLower: true,
        tickUpper: true,
        status: true
      }
    });
  }

  async markSyncAttempt(input: { ids: string[]; attemptedAt: Date }): Promise<void> {
    if (input.ids.length === 0) return;
    await prisma.position.updateMany({
      where: { id: { in: input.ids } },
      data: {
        lastSyncAttemptAt: input.attemptedAt
      }
    });
  }

  async markSyncError(input: { ids: string[]; attemptedAt: Date; errorMessage: string }): Promise<void> {
    if (input.ids.length === 0) return;
    await prisma.position.updateMany({
      where: { id: { in: input.ids } },
      data: {
        lastSyncAttemptAt: input.attemptedAt,
        syncStatus: "ERROR",
        lastSyncError: input.errorMessage
      }
    });
  }

  async markPositionSynced(input: {
    positionId: string;
    attemptedAt: Date;
    successAt: Date;
    status: "SUCCESS" | "PARTIAL";
    errorMessage: string | null;
  }): Promise<void> {
    await prisma.position.updateMany({
      where: { positionId: input.positionId },
      data: {
        lastSyncAttemptAt: input.attemptedAt,
        lastSyncSuccessAt: input.successAt,
        syncStatus: input.status,
        lastSyncError: input.errorMessage
      }
    });
  }

  async upsertOnchainPosition(input: { chainId: number; position: WalletOnchainPosition }): Promise<void> {
    await prisma.onchainPositionState.upsert({
      where: { positionId: input.position.tokenId },
      update: {
        chainId: input.chainId,
        owner: input.position.owner,
        operator: input.position.operator,
        token0: input.position.token0,
        token1: input.position.token1,
        fee: input.position.fee,
        tickLower: input.position.tickLower,
        tickUpper: input.position.tickUpper,
        liquidity: input.position.liquidity,
        tokensOwed0: input.position.tokensOwed0,
        tokensOwed1: input.position.tokensOwed1
      },
      create: {
        positionId: input.position.tokenId,
        chainId: input.chainId,
        owner: input.position.owner,
        operator: input.position.operator,
        token0: input.position.token0,
        token1: input.position.token1,
        fee: input.position.fee,
        tickLower: input.position.tickLower,
        tickUpper: input.position.tickUpper,
        liquidity: input.position.liquidity,
        tokensOwed0: input.position.tokensOwed0,
        tokensOwed1: input.position.tokensOwed1
      }
    });
  }
}

export class WalletPositionSyncService {
  constructor(
    private readonly deps: {
      reader?: Pick<UniswapPositionReader, "readWalletPositions">;
      store?: WalletSyncStore;
      snapshotService?: Pick<SaveOnchainSnapshotService, "saveForPositions">;
      logger?: (entry: Record<string, unknown>) => void;
    } = {}
  ) {}

  async syncWalletPositions(input: WalletPositionSyncInput): Promise<WalletPositionSyncResult> {
    if (!isAddress(input.wallet)) {
      throw new Error("Invalid wallet address");
    }
    const wallet = getAddress(input.wallet);
    const walletLower = wallet.toLowerCase();
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const reader = this.deps.reader ?? new UniswapPositionReader();
    const store = this.deps.store ?? new PrismaWalletSyncStore();
    const snapshotService = this.deps.snapshotService ?? new SaveOnchainSnapshotService();
    const logger = this.deps.logger ?? ((entry: Record<string, unknown>) => console.info(JSON.stringify(entry)));

    const localRows = await store.listWalletPositions({
      walletLower,
      chainId: input.chainId
    });
    await store.markSyncAttempt({
      ids: localRows.map((row) => row.id),
      attemptedAt: startedAtDate
    });

    const readResult = await reader.readWalletPositions({
      wallet,
      chainId: input.chainId
    });
    const byPositionId = new Set(localRows.map((row) => row.positionId));
    const tokenErrors = buildTokenErrorMap(readResult);
    let matchedLocalPositionsCount = 0;
    let upsertedOnchainStatesCount = 0;
    const matchedPositionIds = new Set<string>();
    const successAt = new Date();

    for (const position of readResult.positions) {
      await store.upsertOnchainPosition({
        chainId: input.chainId,
        position
      });
      upsertedOnchainStatesCount += 1;
      if (!byPositionId.has(position.tokenId)) continue;
      matchedLocalPositionsCount += 1;
      matchedPositionIds.add(position.tokenId);
      const tokenError = tokenErrors.get(position.tokenId);
      await store.markPositionSynced({
        positionId: position.tokenId,
        attemptedAt: startedAtDate,
        successAt,
        status: tokenError ? "PARTIAL" : "SUCCESS",
        errorMessage: tokenError ?? null
      });
    }

    const snapshotRows: LocalPositionForSnapshot[] = localRows
      .filter((row) => matchedPositionIds.has(row.positionId))
      .map((row) => ({
        positionId: row.positionId,
        chainId: row.chainId,
        poolAddress: row.poolAddress,
        token0Address: row.token0Address,
        token1Address: row.token1Address,
        tickLower: row.tickLower,
        tickUpper: row.tickUpper,
        savedStatus: row.status
      }));

    const SNAPSHOT_MAX_RETRIES = 3;
    let snapshotResult = await snapshotService.saveForPositions(snapshotRows);
    for (let attempt = 1; snapshotResult.status === "incomplete" && attempt < SNAPSHOT_MAX_RETRIES; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      snapshotResult = await snapshotService.saveForPositions(snapshotRows);
    }

    if (snapshotResult.status === "incomplete") {
      logger({
        event: "wallet_sync_snapshot_incomplete",
        wallet,
        chainId: input.chainId,
        attempts: SNAPSHOT_MAX_RETRIES,
        errors: snapshotResult.errors,
        skippedFallback: snapshotResult.skippedFallback
      });
    }
    if (snapshotResult.skippedFallback > 0 && snapshotResult.status === "complete") {
      logger({
        event: "wallet_sync_snapshot_fallback_skipped",
        wallet,
        chainId: input.chainId,
        skippedFallback: snapshotResult.skippedFallback,
        attemptedPositions: snapshotResult.attemptedPositions
      });
    }
    for (const error of snapshotResult.errors) {
      if (!error.positionId) continue;
      await store.markPositionSynced({
        positionId: error.positionId,
        attemptedAt: startedAtDate,
        successAt,
        status: "PARTIAL",
        errorMessage: error.message
      });
    }

    const combinedErrors = [
      ...readResult.errors.map((error) => ({
        step: error.step,
        message: error.message,
        tokenId: error.tokenId
      })),
      ...snapshotResult.errors.map((error) => ({
        step: error.step,
        message: error.message,
        tokenId: error.positionId
      }))
    ];
    for (const error of combinedErrors) {
      logger({
        event: "wallet_sync_error",
        wallet,
        chainId: input.chainId,
        step: error.step,
        tokenId: error.tokenId ?? null,
        message: error.message
      });
    }
    const outcome = computeOutcome(readResult, combinedErrors.length);
    if (outcome === "ERROR" && localRows.length > 0) {
      const fallbackError = combinedErrors[0]?.message ?? "on-chain sync failed";
      await store.markSyncError({
        ids: localRows.map((row) => row.id),
        attemptedAt: startedAtDate,
        errorMessage: fallbackError
      });
    }

    const snapshotStatus = snapshotResult.status;
    const payload = {
      wallet,
      chainId: input.chainId,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome,
      snapshotStatus,
      discoveredTokenIds: readResult.tokenIds,
      fetchedPositionsCount: readResult.positions.length,
      matchedLocalPositionsCount,
      upsertedOnchainStatesCount,
      errorCount: combinedErrors.length,
      errors: combinedErrors
    };
    logger({
      event: "wallet_sync_summary",
      wallet,
      chainId: input.chainId,
      outcome: payload.outcome,
      discoveredTokenIds: payload.discoveredTokenIds.length,
      fetchedPositionsCount: payload.fetchedPositionsCount,
      matchedLocalPositionsCount: payload.matchedLocalPositionsCount,
      upsertedOnchainStatesCount: payload.upsertedOnchainStatesCount,
      errorCount: payload.errorCount
    });
    return payload;
  }
}

function buildTokenErrorMap(readResult: WalletOnchainPositionsReadResult): Map<string, string> {
  const map = new Map<string, string>();
  for (const error of readResult.errors) {
    if (!error.tokenId) continue;
    if (!map.has(error.tokenId)) {
      map.set(error.tokenId, error.message);
    }
  }
  return map;
}

function computeOutcome(readResult: WalletOnchainPositionsReadResult, totalErrors: number): "SUCCESS" | "PARTIAL" | "ERROR" {
  if (totalErrors === 0) return "SUCCESS";
  if (readResult.positions.length > 0 || readResult.tokenIds.length > 0) return "PARTIAL";
  return "ERROR";
}
