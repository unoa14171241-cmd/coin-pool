import { Router } from "express";
import { allowedChainIds } from "../config/env";
import { prisma } from "../db/prisma";
import { requireWalletSignature } from "../auth/middleware";
import { WalletPositionSyncService } from "../services/indexer/wallet-position-sync";
import { authorizeOwnerOrOperatorAction, normalizeWalletAddress } from "../services/auth/wallet-authorization";
import {
  syncOverviewCacheStore,
  type SyncOverviewCore
} from "../services/cache/sync-overview-cache";
import {
  getSyncOverviewCounters,
  recordSyncOverviewCacheHit,
  recordSyncOverviewCacheMiss
} from "../services/observability/sync-observability";
import { getOperatorPermissionCacheCounters } from "../services/observability/operator-permission-observability";
import { getAuthorizationCounters, recordSyncAuthorizationDenied } from "../services/observability/authorization-observability";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";
import {
  syncChainIdSchema,
  syncOverviewResponseSchema,
  syncIndexedPositionsResponseSchema,
  syncRunQuerySchema,
  syncRunResponseSchema,
  syncStatusResponseSchema,
  syncWalletPathSchema
} from "../schemas/sync";

const router = Router();
const syncService = new WalletPositionSyncService();
const SYNC_OVERVIEW_CACHE_TTL_MS = 15_000;

router.get("/sync/:wallet", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeSyncWalletAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeSyncTarget(wallet, res.locals.authWallet);
  if (!auth.ok) {
    recordSyncAuthorizationDenied();
    console.warn(
      JSON.stringify({
        event: "sync_authorization_denied",
        wallet,
        action: "read_status",
        reason: auth.reason,
        ...getAuthorizationCounters()
      })
    );
    return res.status(403).json({ error: "Authenticated wallet is not authorized for this sync status target" });
  }
  const actorRole = auth.actorRole;
  const authWallet = auth.authWallet;
  const parsedQuery = syncRunQuerySchema.safeParse({ chainId: req.query.chainId });
  if (!parsedQuery.success) {
    return res.status(400).json({ error: "Invalid chainId query" });
  }
  const chainIds = resolveTargetChainIds(parsedQuery.data.chainId);
  if (!chainIds) {
    return res.status(400).json({ error: "Unsupported chain ID" });
  }
  const chains = await loadSyncStatusRows(wallet, chainIds);

  console.info(
    JSON.stringify({
      event: "sync_status_read",
      wallet,
      actorRole,
      triggeredByWallet: authWallet,
      chainIds,
      totalChains: chains.length,
      totalPositions: chains.reduce((sum, item) => sum + item.totalPositions, 0),
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /sync/:wallet", Date.now() - startedAt),
      ...getAuthorizationCounters(),
      ...getOperatorPermissionCacheCounters()
    })
  );
  const payload = syncStatusResponseSchema.parse({
    walletAddress: wallet,
    chains
  });
  return res.json(payload);
});

router.post("/sync/:wallet", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeSyncWalletAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeSyncTarget(wallet, res.locals.authWallet);
  if (!auth.ok) {
    recordSyncAuthorizationDenied();
    console.warn(
      JSON.stringify({
        event: "sync_authorization_denied",
        wallet,
        action: "run_sync",
        reason: auth.reason,
        ...getAuthorizationCounters()
      })
    );
    return res.status(403).json({ error: "Authenticated wallet is not authorized for this sync target" });
  }
  const actorRole = auth.actorRole;
  const authWallet = auth.authWallet;
  const parsedQuery = syncRunQuerySchema.safeParse({ chainId: req.query.chainId });
  if (!parsedQuery.success) {
    return res.status(400).json({ error: "Invalid chainId query" });
  }
  const chainIds = resolveTargetChainIds(parsedQuery.data.chainId);
  if (!chainIds) {
    return res.status(400).json({ error: "Unsupported chain ID" });
  }

  const results = [];
  for (const chainId of chainIds) {
    const result = await syncService.syncWalletPositions({
      wallet,
      chainId
    });
    results.push(result);
    console.info(
      JSON.stringify({
        event: "wallet_sync_result",
        wallet,
        chainId,
        outcome: result.outcome,
        fetchedPositionsCount: result.fetchedPositionsCount,
        matchedLocalPositionsCount: result.matchedLocalPositionsCount,
        upsertedOnchainStatesCount: result.upsertedOnchainStatesCount,
        errorCount: result.errorCount
      })
    );
    if (result.errors.length > 0) {
      for (const error of result.errors.slice(0, 20)) {
        console.warn(
          JSON.stringify({
            event: "wallet_sync_result_error",
            wallet,
            chainId,
            step: error.step,
            tokenId: error.tokenId ?? null,
            message: error.message
          })
        );
      }
    }
  }
  const payload = syncRunResponseSchema.parse({
    walletAddress: wallet,
    actorRole,
    triggeredByWallet: authWallet,
    requestedChainIds: chainIds,
    results,
    summary: {
      totalChains: results.length,
      successChains: results.filter((item) => item.outcome === "SUCCESS").length,
      partialChains: results.filter((item) => item.outcome === "PARTIAL").length,
      errorChains: results.filter((item) => item.outcome === "ERROR").length,
      totalErrors: results.reduce((sum, item) => sum + item.errorCount, 0)
    }
  });
  console.info(
    JSON.stringify({
      event: "wallet_sync_request_summary",
      wallet,
      actorRole,
      triggeredByWallet: authWallet,
      requestedChainIds: chainIds,
      ...payload.summary,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /sync/:wallet", Date.now() - startedAt),
      ...getAuthorizationCounters(),
      ...getOperatorPermissionCacheCounters()
    })
  );
  const invalidatedCacheKeys = syncOverviewCacheStore.invalidate({
    wallet,
    chainIds
  });
  console.info(
    JSON.stringify({
      event: "sync_overview_cache_invalidate",
      wallet,
      requestedChainIds: chainIds,
      invalidatedCacheKeys,
      ...getSyncOverviewCounters()
    })
  );
  return res.json(payload);
});

router.get("/sync/:wallet/overview", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeSyncWalletAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeSyncTarget(wallet, res.locals.authWallet);
  if (!auth.ok) {
    recordSyncAuthorizationDenied();
    console.warn(
      JSON.stringify({
        event: "sync_authorization_denied",
        wallet,
        action: "read_overview",
        reason: auth.reason,
        ...getAuthorizationCounters()
      })
    );
    return res.status(403).json({ error: "Authenticated wallet is not authorized for this sync overview target" });
  }
  const actorRole = auth.actorRole;
  const authWallet = auth.authWallet;
  const parsedQuery = syncRunQuerySchema.safeParse({ chainId: req.query.chainId });
  if (!parsedQuery.success || parsedQuery.data.chainId == null) {
    return res.status(400).json({ error: "chainId query is required" });
  }
  const chainIds = resolveTargetChainIds(parsedQuery.data.chainId);
  if (!chainIds || chainIds.length !== 1) {
    return res.status(400).json({ error: "Unsupported chain ID" });
  }
  const chainId = chainIds[0];
  const overviewCore = await getSyncOverviewCore(wallet, chainId);
  console.info(
    JSON.stringify({
      event: "sync_overview_read",
      wallet,
      chainId,
      actorRole,
      triggeredByWallet: authWallet,
      cacheHit: overviewCore.cacheHit,
      ...getSyncOverviewCounters(),
      ...getAuthorizationCounters(),
      ...getOperatorPermissionCacheCounters(),
      totalPositions: overviewCore.syncStatus.totalPositions,
      totalIndexed: overviewCore.indexing.totalIndexed,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /sync/:wallet/overview", Date.now() - startedAt)
    })
  );

  return res.json(
    syncOverviewResponseSchema.parse({
      walletAddress: wallet,
      actorRole,
      triggeredByWallet: authWallet,
      chainId,
      syncStatus: overviewCore.syncStatus,
      indexing: overviewCore.indexing
    })
  );
});

router.get("/sync/:wallet/indexed", requireWalletSignature, async (req, res) => {
  const wallet = normalizeSyncWalletAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeSyncTarget(wallet, res.locals.authWallet);
  if (!auth.ok) {
    recordSyncAuthorizationDenied();
    console.warn(
      JSON.stringify({
        event: "sync_authorization_denied",
        wallet,
        action: "read_indexed",
        reason: auth.reason,
        ...getAuthorizationCounters()
      })
    );
    return res.status(403).json({ error: "Authenticated wallet is not authorized for this indexed view target" });
  }
  const parsedQuery = syncRunQuerySchema.safeParse({ chainId: req.query.chainId });
  if (!parsedQuery.success || parsedQuery.data.chainId == null) {
    return res.status(400).json({ error: "chainId query is required" });
  }
  const chainIds = resolveTargetChainIds(parsedQuery.data.chainId);
  if (!chainIds || chainIds.length !== 1) {
    return res.status(400).json({ error: "Unsupported chain ID" });
  }
  const chainId = chainIds[0];
  const indexedRows = await loadIndexedDetailed(wallet, chainId);
  return res.json(
    syncIndexedPositionsResponseSchema.parse({
      walletAddress: wallet,
      chainId,
      total: indexedRows.length,
      indexedAt: new Date().toISOString(),
      positions: indexedRows.map((row) => ({
        tokenId: row.positionId,
        chainId: row.chainId,
        owner: row.owner,
        operator: row.operator,
        token0: row.token0,
        token1: row.token1,
        fee: row.fee,
        tickLower: row.tickLower,
        tickUpper: row.tickUpper,
        liquidity: row.liquidity,
        tokensOwed0: row.tokensOwed0,
        tokensOwed1: row.tokensOwed1,
        updatedAt: row.updatedAt.toISOString(),
        matchedLocalPosition: row.matchedLocalPosition
      }))
    })
  );
});

export default router;

function resolveTargetChainIds(chainId: number | undefined): number[] | null {
  if (chainId == null) return allowedChainIds;
  const parsed = syncChainIdSchema.safeParse(chainId);
  if (!parsed.success) return null;
  if (!allowedChainIds.includes(parsed.data)) return null;
  return [parsed.data];
}

function normalizeSyncWalletAddress(value: string): `0x${string}` | null {
  const parsed = syncWalletPathSchema.safeParse(value);
  if (!parsed.success) return null;
  return normalizeWalletAddress(parsed.data);
}

async function authorizeSyncTarget(
  targetWallet: `0x${string}`,
  authWalletRaw: unknown
): Promise<{ ok: true; actorRole: "owner" | "operator"; authWallet: `0x${string}` } | { ok: false; reason: string }> {
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: targetWallet,
    authWalletRaw,
    requireCanEvaluate: true,
    requireCanExecute: false
  });
  if (!auth.ok) return { ok: false, reason: auth.reason };
  return { ok: true, actorRole: auth.actorRole, authWallet: auth.authWallet };
}

async function loadSyncStatusRows(wallet: `0x${string}`, chainIds: number[]) {
  const walletLower = wallet.toLowerCase();
  const positions = await prisma.position.findMany({
    where: {
      wallet: walletLower,
      chainId: { in: chainIds }
    },
    select: {
      chainId: true,
      syncStatus: true,
      lastSyncAttemptAt: true,
      lastSyncSuccessAt: true,
      lastSyncError: true
    }
  });
  const ownedStates = await prisma.onchainPositionState.findMany({
    where: {
      owner: wallet,
      chainId: { in: chainIds }
    },
    select: {
      chainId: true
    }
  });
  const ownedCountByChain = new Map<number, number>();
  for (const item of ownedStates) {
    ownedCountByChain.set(item.chainId, (ownedCountByChain.get(item.chainId) ?? 0) + 1);
  }
  return chainIds.map((chainId) => {
    const rows = positions.filter((row) => row.chainId === chainId);
    const latestAttempt = maxDate(rows.map((row) => row.lastSyncAttemptAt));
    const latestSuccess = maxDate(rows.map((row) => row.lastSyncSuccessAt));
    const latestError = rows
      .filter((row) => typeof row.lastSyncError === "string" && row.lastSyncError.length > 0)
      .sort((a, b) => (b.lastSyncAttemptAt?.getTime() ?? 0) - (a.lastSyncAttemptAt?.getTime() ?? 0))[0]?.lastSyncError;
    return {
      chainId,
      totalPositions: rows.length,
      neverCount: rows.filter((row) => row.syncStatus == null || row.syncStatus === "NEVER").length,
      successCount: rows.filter((row) => row.syncStatus === "SUCCESS").length,
      partialCount: rows.filter((row) => row.syncStatus === "PARTIAL").length,
      errorCount: rows.filter((row) => row.syncStatus === "ERROR").length,
      lastSyncAttemptAt: latestAttempt ? latestAttempt.toISOString() : null,
      lastSyncSuccessAt: latestSuccess ? latestSuccess.toISOString() : null,
      latestSyncError: latestError ?? null,
      onchainStatesOwnedCount: ownedCountByChain.get(chainId) ?? 0
    };
  });
}

async function loadIndexedDetailed(wallet: `0x${string}`, chainId: number) {
  const indexedRows = await prisma.onchainPositionState.findMany({
    where: {
      chainId,
      owner: wallet
    },
    select: {
      positionId: true,
      chainId: true,
      owner: true,
      operator: true,
      token0: true,
      token1: true,
      fee: true,
      tickLower: true,
      tickUpper: true,
      liquidity: true,
      tokensOwed0: true,
      tokensOwed1: true,
      updatedAt: true
    },
    orderBy: {
      updatedAt: "desc"
    },
    take: 500
  });
  const matchedSet = await loadMatchedLocalPositionIdSet(wallet, chainId, indexedRows.map((row) => row.positionId));
  return indexedRows.map((row) => ({
    ...row,
    matchedLocalPosition: matchedSet.has(row.positionId)
  }));
}

async function loadIndexedCompact(wallet: `0x${string}`, chainId: number) {
  const indexedRows = await prisma.onchainPositionState.findMany({
    where: { chainId, owner: wallet },
    select: { positionId: true },
    take: 2000
  });
  const matchedSet = await loadMatchedLocalPositionIdSet(wallet, chainId, indexedRows.map((row) => row.positionId));
  const totalIndexed = indexedRows.length;
  const matchedLocalCount = matchedSet.size;
  return {
    totalIndexed,
    matchedLocalCount,
    unmatchedDiscoveredCount: Math.max(0, totalIndexed - matchedLocalCount),
    indexedAt: new Date().toISOString()
  };
}

async function loadMatchedLocalPositionIdSet(wallet: `0x${string}`, chainId: number, tokenIds: string[]) {
  const matchedRows = await prisma.position.findMany({
    where: {
      wallet: wallet.toLowerCase(),
      chainId,
      positionId: { in: tokenIds.length > 0 ? tokenIds : ["__none__"] }
    },
    select: {
      positionId: true
    }
  });
  return new Set(matchedRows.map((row) => row.positionId));
}

async function getSyncOverviewCore(wallet: `0x${string}`, chainId: number): Promise<{
  syncStatus: {
    totalPositions: number;
    neverCount: number;
    successCount: number;
    partialCount: number;
    errorCount: number;
    lastSyncAttemptAt: string | null;
    lastSyncSuccessAt: string | null;
    latestSyncError: string | null;
    onchainStatesOwnedCount: number;
  };
  indexing: {
    totalIndexed: number;
    matchedLocalCount: number;
    unmatchedDiscoveredCount: number;
    indexedAt: string;
  };
  cacheHit: boolean;
}> {
  const now = Date.now();
  const cached = syncOverviewCacheStore.get({ wallet, chainId, nowMs: now });
  if (cached) {
    recordSyncOverviewCacheHit();
    return {
      ...cached,
      cacheHit: true
    };
  }
  recordSyncOverviewCacheMiss();
  const chainSummary = (await loadSyncStatusRows(wallet, [chainId]))[0];
  const indexedCompact = await loadIndexedCompact(wallet, chainId);
  const value: SyncOverviewCore = {
    syncStatus: {
      totalPositions: chainSummary.totalPositions,
      neverCount: chainSummary.neverCount,
      successCount: chainSummary.successCount,
      partialCount: chainSummary.partialCount,
      errorCount: chainSummary.errorCount,
      lastSyncAttemptAt: chainSummary.lastSyncAttemptAt,
      lastSyncSuccessAt: chainSummary.lastSyncSuccessAt,
      latestSyncError: chainSummary.latestSyncError,
      onchainStatesOwnedCount: chainSummary.onchainStatesOwnedCount
    },
    indexing: indexedCompact
  };
  syncOverviewCacheStore.set({
    wallet,
    chainId,
    value,
    ttlMs: SYNC_OVERVIEW_CACHE_TTL_MS,
    nowMs: now
  });
  return {
    ...value,
    cacheHit: false
  };
}

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}

function maxDate(values: Array<Date | null>): Date | null {
  const valid = values.filter((value): value is Date => value instanceof Date);
  if (valid.length === 0) return null;
  return valid.reduce((max, current) => (current.getTime() > max.getTime() ? current : max));
}
