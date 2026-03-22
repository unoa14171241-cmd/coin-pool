import { Router } from "express";
import { Prisma } from "@prisma/client";
import { getAddress, isAddress } from "viem";
import {
  createPositionSchema,
  dailyProfitResponseSchema,
  dashboardAnalyticsSchema,
  dashboardSummaryResponseSchema,
  portfolioSummarySchema,
  positionDetailResponseSchema,
  positionHistoryResponseSchema,
  positionsResponseSchema,
  rebalancePreviewRequestSchema,
  strategyRecommendationSchema
} from "../schemas/position";
import { prisma } from "../db/prisma";
import { allowedChainIds, env } from "../config/env";
import { getEthPriceUsd } from "../web3/price";
import { assertBodyWalletMatchesAuth, requireWalletSignature } from "../auth/middleware";
import { canonicalChainName, isChainInputConsistent } from "../utils/chains";
import { type PositionAnalyticsResult } from "../services/position-analytics";
import { aggregateWalletDashboard } from "../services/dashboard-aggregation";
import {
  InMemoryStrategyRecommendationCache,
  type StrategyMode
} from "../services/strategy";
import { normalizeWalletAddress as normalizeWalletAddressCommon } from "../services/auth/wallet-authorization";
import { toStrategyApiPayload } from "../services/position-strategy-response";
import { positionStrategyRecommendationService } from "../services/position-strategy-recommendation";
import {
  positionAnalyticsRowBuilderService,
  type SavedPositionAnalyticsSourceRow
} from "../services/position-analytics-row-builder";
import {
  getPositionsRouteCounters,
  recordPositionHistoryFallbackEmpty,
  recordPositionNotFound,
  recordPositionsInvalidWalletParam,
  recordPositionStrategyCacheHit,
  recordPositionStrategyCacheMiss
} from "../services/observability/positions-observability";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";

const router = Router();
const strategyRecommendationCache = new InMemoryStrategyRecommendationCache();

router.get("/positions/:wallet", async (req, res) => {
  const routeStart = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "GET /positions/:wallet",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const dbStart = Date.now();
  const rows = await loadSavedPositions(wallet);
  const dbDurationMs = Date.now() - dbStart;
  const analyticsStart = Date.now();
  const analyticsBundle = await buildPositionAnalyticsRows(rows);
  const analyticsRows = analyticsBundle.rows;
  const analyticsDurationMs = Date.now() - analyticsStart;

  const responsePayload = positionsResponseSchema.parse(buildPositionResponse(wallet, analyticsRows, rows));
  const totalDurationMs = Date.now() - routeStart;
  const staleCount = analyticsRows.filter((row) => row.live.stale).length;
  console.info(
    JSON.stringify({
      event: "positions_route_metrics",
      wallet,
      positionsLoaded: rows.length,
      uniquePools: analyticsRows.length > 0 ? new Set(analyticsRows.map((row) => `${row.saved.chainId}:${row.saved.poolAddress.toLowerCase()}`)).size : 0,
      ...analyticsBundle.stats,
      ...getPositionsRouteCounters(),
      staleCount,
      dbDurationMs,
      analyticsDurationMs,
      totalDurationMs,
      ...recordAndGetRouteLatency("GET /positions/:wallet", totalDurationMs)
    })
  );
  res.json(responsePayload);
});

router.get("/positions/:wallet/daily-profit", async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "GET /positions/:wallet/daily-profit",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const requestedChainId = Number(req.query.chainId ?? 42161);
  const chainId = allowedChainIds.includes(requestedChainId) ? requestedChainId : 42161;
  const fromRaw = String(req.query.from ?? "");
  const toRaw = String(req.query.to ?? "");
  const now = new Date();
  const defaultTo = new Date(now);
  defaultTo.setUTCHours(0, 0, 0, 0);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);
  const fromDate = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? new Date(fromRaw + "T00:00:00.000Z") : defaultFrom;
  const toDate = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? new Date(toRaw + "T23:59:59.999Z") : defaultTo;
  if (fromDate > toDate) {
    return res.status(400).json({ error: "from must be before or equal to to" });
  }
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        day: Date;
        totalFeesUsd: number;
        totalPnlUsd: number;
        estimatedIlUsd: number;
        positionCount: bigint;
      }>
    >`
      WITH pos AS (
        SELECT "positionId" FROM "Position" WHERE "wallet" = ${wallet}
      ),
      daily_latest AS (
        SELECT DISTINCT ON (ps."positionId", (ps."snapshotAt" AT TIME ZONE 'UTC')::date)
          ps."positionId",
          (ps."snapshotAt" AT TIME ZONE 'UTC')::date as day,
          COALESCE(ps."estimatedFeesUsd", 0) as "estimatedFeesUsd",
          COALESCE(ps."estimatedPnlUsd", 0) as "estimatedPnlUsd",
          COALESCE(ps."estimatedIlUsd", 0) as "estimatedIlUsd"
        FROM "PositionSnapshot" ps
        INNER JOIN pos ON pos."positionId" = ps."positionId"
        WHERE ps."chainId" = ${chainId}
          AND ps."snapshotAt" >= ${fromDate}
          AND ps."snapshotAt" <= ${toDate}
        ORDER BY ps."positionId", (ps."snapshotAt" AT TIME ZONE 'UTC')::date, ps."snapshotAt" DESC
      )
      SELECT
        day,
        SUM("estimatedFeesUsd")::float as "totalFeesUsd",
        SUM("estimatedPnlUsd")::float as "totalPnlUsd",
        SUM("estimatedIlUsd")::float as "estimatedIlUsd",
        COUNT(*)::bigint as "positionCount"
      FROM daily_latest
      GROUP BY day
      ORDER BY day ASC
    `;
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = toDate.toISOString().slice(0, 10);
    const payload = dailyProfitResponseSchema.parse({
      walletAddress: normalizeAddress(wallet),
      chainId,
      from: fromStr,
      to: toStr,
      daily: rows.map((r) => ({
        date: r.day.toISOString().slice(0, 10),
        totalFeesUsd: Number(r.totalFeesUsd),
        totalPnlUsd: Number(r.totalPnlUsd),
        estimatedIlUsd: Number(r.estimatedIlUsd),
        positionCount: Number(r.positionCount),
        note: "estimated" as const
      })),
      metadata: {
        source: "PositionSnapshot" as const,
        quality: "estimated" as const,
        generatedAt: new Date().toISOString()
      }
    });
    console.info(
      JSON.stringify({
        event: "daily_profit_read",
        wallet,
        chainId,
        from: fromStr,
        to: toStr,
        rowCount: payload.daily.length,
        elapsedMs: Date.now() - startedAt,
        ...recordAndGetRouteLatency("GET /positions/:wallet/daily-profit", Date.now() - startedAt)
      })
    );
    return res.json(payload);
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "daily_profit_error",
        wallet,
        chainId,
        error: e instanceof Error ? e.message : "unknown",
        elapsedMs: Date.now() - startedAt
      })
    );
    return res.status(500).json({ error: "Failed to load daily profit data" });
  }
});

router.post("/positions", requireWalletSignature, async (req, res) => {
  if (!assertBodyWalletMatchesAuth(req, res)) return;
  const parsed = createPositionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const input = parsed.data;
  if (!allowedChainIds.includes(input.chainId)) {
    return res.status(400).json({ error: "Unsupported chain ID" });
  }
  if (!isChainInputConsistent(input.chainId, input.chainName)) {
    return res.status(400).json({
      error: `chain mismatch: chainId ${input.chainId} requires chain name ${canonicalChainName(input.chainId)}`
    });
  }

  const minValueUsd = env.MIN_POSITION_VALUE_USD;
  if (minValueUsd > 0) {
    if (input.estimatedValueUsd == null) {
      return res.status(400).json({
        error: `Estimated position value is required. Minimum position value is $${minValueUsd}.`
      });
    }
    if (input.estimatedValueUsd < minValueUsd) {
      return res.status(400).json({
        error: `Position value $${input.estimatedValueUsd.toFixed(2)} is below minimum $${minValueUsd}. Minimum position value required.`
      });
    }
  }

  const existing = await prisma.position.findUnique({
    where: { positionId: input.positionId }
  });
  if (existing) {
    return res.status(409).json({
      error: "positionId already exists",
      existing: {
        wallet: existing.wallet,
        chainName: existing.chainName,
        positionId: existing.positionId
      }
    });
  }

  try {
    await prisma.position.create({
      data: {
        wallet: input.wallet.toLowerCase(),
        positionId: input.positionId,
        chainId: input.chainId,
        chainName: input.chainName,
        poolAddress: input.poolAddress,
        token0Address: input.token0Address,
        token1Address: input.token1Address,
        token0Symbol: input.token0Symbol,
        token1Symbol: input.token1Symbol,
        feeTier: input.feeTier,
        tickLower: input.tickLower,
        tickUpper: input.tickUpper,
        createdTx: input.createdTx,
        status: input.status,
        lastCheck: new Date()
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "positionId already exists (race detected)" });
    }
    throw e;
  }
  await prisma.activityLog.create({
    data: {
      wallet: input.wallet.toLowerCase(),
      positionId: input.positionId,
      type: "Position created",
      source: "user-action",
      tx: input.createdTx,
      message: `Position ${input.positionId} created on ${input.chainName}`
    } as any
  });

  return res.status(201).json({ ok: true });
});

router.get("/positions/:wallet/:positionId", async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "GET /positions/:wallet/:positionId",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const positionId = req.params.positionId;
  const rows = await loadSavedPositions(wallet);
  const target = rows.find((row) => row.positionId === positionId);
  if (!target) {
    logPositionNotFound({
      route: "GET /positions/:wallet/:positionId",
      wallet,
      positionId
    });
    return res.status(404).json({ error: "Position not found" });
  }
  const analyticsBundle = await buildPositionAnalyticsRows([target]);
  const row = analyticsBundle.rows[0];
  const responsePayload = positionDetailResponseSchema.parse({
    id: row.saved.positionId,
    walletAddress: normalizeAddress(wallet),
    savedState: {
      chainId: row.saved.chainId,
      poolAddress: row.saved.poolAddress,
      token0Address: row.saved.token0Address,
      token1Address: row.saved.token1Address,
      token0Symbol: row.saved.token0Symbol,
      token1Symbol: row.saved.token1Symbol,
      feeTier: row.saved.feeTier,
      tickLower: row.saved.tickLower,
      tickUpper: row.saved.tickUpper,
      createdAt: row.saved.createdAt,
      savedStatus: row.saved.savedStatus
    },
    liveState: {
      currentTick: row.live.currentTick,
      currentPrice: row.live.currentPrice,
      sqrtPriceX96: row.live.sqrtPriceX96,
      liquidity: row.live.liquidity,
      snapshotUpdatedAt: row.live.snapshotUpdatedAt,
      stale: row.live.stale,
      source: row.live.source
    },
    analyticsState: row.analytics,
    placeholderFlags: {
      isPlaceholderValuation: row.analytics.status === "placeholder",
      isPlaceholderYieldMetrics: row.analytics.feeState.status === "placeholder"
    },
    syncMetadata: buildSyncMetadataFromSavedRow(target)
  });
  console.info(
    JSON.stringify({
      event: "position_detail_read",
      wallet,
      positionId,
      elapsedMs: Date.now() - startedAt,
      ...analyticsBundle.stats,
      ...getPositionsRouteCounters(),
      ...recordAndGetRouteLatency("GET /positions/:wallet/:positionId", Date.now() - startedAt)
    })
  );
  res.json(responsePayload);
});

router.get("/positions/:wallet/:positionId/strategy", async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "GET /positions/:wallet/:positionId/strategy",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const mode = parseStrategyMode(req.query.mode);
  const positionId = req.params.positionId;
  const row = await loadPositionForStrategy(wallet, positionId);
  if (!row) {
    logPositionNotFound({
      route: "GET /positions/:wallet/:positionId/strategy",
      wallet,
      positionId
    });
    return res.status(404).json({ error: "Position not found" });
  }

  const cacheKey = `${wallet}:${positionId}:${mode}`;
  const nowMs = Date.now();
  const cached = strategyRecommendationCache.get(cacheKey, nowMs);
  if (cached) {
    recordPositionStrategyCacheHit();
    console.info(
      JSON.stringify({
        event: "position_strategy_read_cache_hit",
        wallet,
        positionId,
        mode,
        elapsedMs: Date.now() - startedAt,
        ...getPositionsRouteCounters(),
        ...recordAndGetRouteLatency("GET /positions/:wallet/:positionId/strategy", Date.now() - startedAt)
      })
    );
    return res.json(
      strategyRecommendationSchema.parse(
        toStrategyApiPayload({
          walletAddress: normalizeAddress(wallet),
          positionId,
          recommendation: cached
        })
      )
    );
  }

  const { analyticsBundle, recommendation } = await buildStrategyRecommendationForPosition({
    wallet,
    positionId,
    mode,
    row
  });
  recordPositionStrategyCacheMiss();
  strategyRecommendationCache.set(cacheKey, recommendation, nowMs + 15_000);
  console.info(
    JSON.stringify({
      event: "position_strategy_read_cache_miss",
      wallet,
      positionId,
      mode,
      elapsedMs: Date.now() - startedAt,
        ...analyticsBundle.stats,
      ...getPositionsRouteCounters(),
      ...recordAndGetRouteLatency("GET /positions/:wallet/:positionId/strategy", Date.now() - startedAt)
    })
  );
  return res.json(
    strategyRecommendationSchema.parse(
      toStrategyApiPayload({
        walletAddress: normalizeAddress(wallet),
        positionId,
        recommendation
      })
    )
  );
});

router.post("/positions/:wallet/:positionId/rebalance-preview", async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "POST /positions/:wallet/:positionId/rebalance-preview",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const parsed = rebalancePreviewRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const positionId = req.params.positionId;
  const mode = parsed.data.mode;
  const row = await loadPositionForStrategy(wallet, positionId);
  if (!row) {
    logPositionNotFound({
      route: "POST /positions/:wallet/:positionId/rebalance-preview",
      wallet,
      positionId
    });
    return res.status(404).json({ error: "Position not found" });
  }

  const { analyticsBundle, analyticsRow, recommendation } = await buildStrategyRecommendationForPosition({
    wallet,
    positionId,
    mode,
    row,
    gasPriceGwei: parsed.data.gasPriceGwei,
    gasUnits: parsed.data.gasUnits
  });
  console.info(
    JSON.stringify({
      event: "position_rebalance_preview_read",
      wallet,
      positionId,
      mode,
      elapsedMs: Date.now() - startedAt,
      ...analyticsBundle.stats,
      ...recordAndGetRouteLatency("POST /positions/:wallet/:positionId/rebalance-preview", Date.now() - startedAt)
    })
  );
  return res.json(
    strategyRecommendationSchema.parse(
      toStrategyApiPayload({
        walletAddress: normalizeAddress(wallet),
        positionId,
        recommendation,
        analyticsRow
      })
    )
  );
});

router.get("/positions/:wallet/:positionId/history", async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "GET /positions/:wallet/:positionId/history",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const positionId = req.params.positionId;
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        chainId: number;
        positionId: string;
        snapshotAt: Date;
        currentTick: number;
        currentPrice: number | null;
        token0Amount: number | null;
        token1Amount: number | null;
        estimatedValueUsd: number | null;
        estimatedFeesUsd: number | null;
        estimatedPnlUsd: number | null;
        estimatedIlUsd: number | null;
        estimatedApr: number | null;
        staleFlag: boolean;
      }>
    >`SELECT "chainId","positionId","snapshotAt","currentTick","currentPrice","token0Amount","token1Amount","estimatedValueUsd","estimatedFeesUsd","estimatedPnlUsd","estimatedIlUsd","estimatedApr","staleFlag" FROM "PositionSnapshot" WHERE "positionId" = ${positionId} ORDER BY "snapshotAt" DESC LIMIT 500`;
    const payload = positionHistoryResponseSchema.parse(
      rows.map((row) => ({
        ...row,
        snapshotAt: row.snapshotAt.toISOString()
      }))
    );
    console.info(
      JSON.stringify({
        event: "position_history_read",
        wallet,
        positionId,
        rows: payload.length,
        elapsedMs: Date.now() - startedAt,
        ...recordAndGetRouteLatency("GET /positions/:wallet/:positionId/history", Date.now() - startedAt)
      })
    );
    return res.json(payload);
  } catch {
    // Table may not be migrated yet; preserve API behavior.
    recordPositionHistoryFallbackEmpty();
    console.warn(
      JSON.stringify({
        event: "position_history_fallback_empty",
        wallet,
        positionId,
        elapsedMs: Date.now() - startedAt,
        ...getPositionsRouteCounters(),
        ...recordAndGetRouteLatency("GET /positions/:wallet/:positionId/history", Date.now() - startedAt)
      })
    );
    return res.json(positionHistoryResponseSchema.parse([]));
  }
});

router.get("/dashboard/:wallet", async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "GET /dashboard/:wallet",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const requestedChainId = Number(req.query.chainId ?? 42161);
  const chainId = allowedChainIds.includes(requestedChainId) ? requestedChainId : 42161;
  const rows = await loadSavedPositions(wallet);
  const analyticsBundle = await buildPositionAnalyticsRows(rows);
  const analyticsRows = analyticsBundle.rows;
  const agg = aggregateWalletDashboard(analyticsRows);

  const payload = dashboardAnalyticsSchema.parse({
    walletAddress: normalizeAddress(wallet),
    chainId,
    chainName: canonicalChainName(chainId),
    totalPositions: agg.totalPositions,
    inRange: agg.inRange,
    outOfRange: agg.outOfRange,
    totalEstimatedValueUsd: agg.totalEstimatedValueUsd,
    totalEstimatedFeesUsd: agg.totalEstimatedFeesUsd,
    totalEstimatedPnlUsd: agg.totalEstimatedPnlUsd,
    totalEstimatedImpermanentLossUsd: agg.totalEstimatedImpermanentLossUsd,
    averageEstimatedApr: agg.averageEstimatedApr,
    stalePositionsCount: agg.stalePositionsCount,
    placeholderFlags: {
      isPlaceholderValuation: false,
      isPlaceholderYieldMetrics: false
    }
  });

  const dashboard = dashboardSummaryResponseSchema.parse({
    ...payload,
    ethPrice: await getEthPriceUsd(chainId),
    // Backward compatibility fields for existing dashboard clients.
    estimatedFeesEarned: payload.totalEstimatedFeesUsd,
    estimatedApr: payload.averageEstimatedApr ?? 0,
    estimatedPositionPnlUsd: payload.totalEstimatedPnlUsd,
    totalValue: payload.totalEstimatedValueUsd,
    metadata: {
      valuation: {
        source: "aggregator",
        generatedAt: new Date().toISOString(),
        stale: agg.stalePositionsCount > 0,
        quality: "estimated"
      },
      yieldMetrics: {
        source: "aggregator",
        generatedAt: new Date().toISOString(),
        stale: agg.stalePositionsCount > 0,
        quality: "estimated"
      },
      liveState: {
        source: "aggregator",
        generatedAt: new Date().toISOString(),
        stale: agg.stalePositionsCount > 0,
        quality: "exact"
      }
    }
  });
  console.info(
    JSON.stringify({
      event: "dashboard_summary_read",
      wallet,
      chainId,
      totalPositions: agg.totalPositions,
      stalePositionsCount: agg.stalePositionsCount,
      elapsedMs: Date.now() - startedAt,
      ...analyticsBundle.stats,
      ...recordAndGetRouteLatency("GET /dashboard/:wallet", Date.now() - startedAt)
    })
  );
  res.json(dashboard);
});

router.get("/portfolio/:wallet", async (req, res) => {
  const startedAt = Date.now();
  const wallet = normalizeWalletPathAddress(String(req.params.wallet ?? ""));
  if (!wallet) {
    logInvalidWalletParam({
      route: "GET /portfolio/:wallet",
      walletRaw: req.params.wallet
    });
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const requestedChainId = Number(req.query.chainId ?? 42161);
  const chainId = allowedChainIds.includes(requestedChainId) ? requestedChainId : 42161;
  const rows = await loadSavedPositions(wallet);
  const analyticsBundle = await buildPositionAnalyticsRows(rows);
  const analyticsRows = analyticsBundle.rows;
  const agg = aggregateWalletDashboard(analyticsRows);
  const strategySummary = await buildPortfolioStrategySummary(wallet, analyticsRows);
  const highVolatilityPoolsCount = strategySummary.highVolatilityPoolsCount;
  const rangePoolsCount = strategySummary.rangePoolsCount;
  const negativeNetBenefitPositionsCount = strategySummary.negativeNetBenefitPositionsCount;
  const payload = portfolioSummarySchema.parse({
    walletAddress: normalizeAddress(wallet),
    chainId,
    totalEstimatedValueUsd: agg.totalEstimatedValueUsd,
    totalEstimatedFeesUsd: agg.totalEstimatedFeesUsd,
    totalEstimatedPnlUsd: agg.totalEstimatedPnlUsd,
    totalEstimatedImpermanentLossUsd: agg.totalEstimatedImpermanentLossUsd,
    averageEstimatedApr: agg.averageEstimatedApr,
    positionsCount: agg.totalPositions,
    outOfRangeCount: agg.outOfRange,
    highVolatilityPoolsCount,
    rangePoolsCount,
    negativeNetBenefitPositionsCount,
    metadata: {
      valuation: {
        source: "aggregator",
        generatedAt: new Date().toISOString(),
        stale: agg.stalePositionsCount > 0,
        quality: "estimated"
      },
      yieldMetrics: {
        source: "aggregator",
        generatedAt: new Date().toISOString(),
        stale: agg.stalePositionsCount > 0,
        quality: "estimated"
      },
      strategy: {
        source: "strategy-engine",
        generatedAt: new Date().toISOString(),
        stale: strategySummary.partialFailure,
        quality: "heuristic"
      }
    }
  });
  console.info(
    JSON.stringify({
      event: "portfolio_summary_read",
      wallet,
      chainId,
      positionsCount: agg.totalPositions,
      outOfRangeCount: agg.outOfRange,
      highVolatilityPoolsCount,
      rangePoolsCount,
      negativeNetBenefitPositionsCount,
      elapsedMs: Date.now() - startedAt,
      ...analyticsBundle.stats,
      ...recordAndGetRouteLatency("GET /portfolio/:wallet", Date.now() - startedAt)
    })
  );
  res.json(payload);
});

export default router;

function normalizeWalletPathAddress(value: string): string | null {
  const normalized = normalizeWalletAddressCommon(value);
  if (!normalized) return null;
  return normalized.toLowerCase();
}

function logInvalidWalletParam(input: { route: string; walletRaw: string | undefined }) {
  recordPositionsInvalidWalletParam();
  console.warn(
    JSON.stringify({
      event: "positions_invalid_wallet_param",
      route: input.route,
      walletRaw: input.walletRaw ?? null,
      ...getPositionsRouteCounters()
    })
  );
}

function logPositionNotFound(input: { route: string; wallet: string; positionId: string }) {
  recordPositionNotFound();
  console.info(
    JSON.stringify({
      event: "position_not_found",
      route: input.route,
      wallet: input.wallet,
      positionId: input.positionId,
      ...getPositionsRouteCounters()
    })
  );
}

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}

function normalizeAddress(value: string): `0x${string}` {
  if (isAddress(value)) {
    return getAddress(value);
  }
  return "0x0000000000000000000000000000000000000000";
}

type SavedPositionRow = Awaited<ReturnType<typeof loadSavedPositions>>[number];
const strategyPositionSelect = {
  positionId: true,
  chainId: true,
  chainName: true,
  wallet: true,
  poolAddress: true,
  token0Address: true,
  token1Address: true,
  token0Symbol: true,
  token1Symbol: true,
  feeTier: true,
  tickLower: true,
  tickUpper: true,
  createdAt: true,
  status: true,
  syncStatus: true,
  lastSyncAttemptAt: true,
  lastSyncSuccessAt: true,
  lastSyncError: true
} satisfies Prisma.PositionSelect;
type StrategyPositionRow = Prisma.PositionGetPayload<{ select: typeof strategyPositionSelect }>;

async function loadSavedPositions(wallet: string) {
  return prisma.position.findMany({
    where: { wallet },
    orderBy: { createdAt: "desc" },
    select: {
      positionId: true,
      chainId: true,
      chainName: true,
      wallet: true,
      poolAddress: true,
      token0Symbol: true,
      token1Symbol: true,
      token0Address: true,
      token1Address: true,
      feeTier: true,
      tickLower: true,
      tickUpper: true,
      createdAt: true,
      status: true,
      syncStatus: true,
      lastSyncAttemptAt: true,
      lastSyncSuccessAt: true,
      lastSyncError: true
    }
  });
}

async function loadPositionForStrategy(wallet: string, positionId: string): Promise<StrategyPositionRow | null> {
  return prisma.position.findFirst({
    where: { wallet, positionId },
    select: strategyPositionSelect
  });
}

async function buildStrategyRecommendationForPosition(input: {
  wallet: string;
  positionId: string;
  mode: StrategyMode;
  row: StrategyPositionRow;
  gasPriceGwei?: number;
  gasUnits?: number;
}) {
  const analyticsBundle = await buildPositionAnalyticsRows([input.row]);
  const analyticsRow = analyticsBundle.rows[0];
  const recommendation = await positionStrategyRecommendationService.buildRecommendation({
    walletAddress: normalizeAddress(input.wallet),
    positionId: input.positionId,
    mode: input.mode,
    analyticsRow,
    gasPriceGwei: input.gasPriceGwei,
    gasUnits: input.gasUnits
  });
  return { analyticsBundle, analyticsRow, recommendation };
}

async function buildPositionAnalyticsRows(rows: SavedPositionRow[]): Promise<{
  rows: PositionAnalyticsResult[];
  stats: Record<string, unknown>;
}> {
  return positionAnalyticsRowBuilderService.build(rows as SavedPositionAnalyticsSourceRow[], {
    warnLogger: (entry) => {
      console.warn(
        JSON.stringify({
          event: "positions_pool_read_warning",
          ...entry
        })
      );
    }
  });
}

function buildPositionResponse(wallet: string, rows: PositionAnalyticsResult[], savedRows: SavedPositionRow[]) {
  const savedByPositionId = new Map(savedRows.map((row) => [row.positionId, row]));
  return rows.map((row) => {
    const savedRow = savedByPositionId.get(row.saved.positionId);
    return {
      id: row.saved.positionId,
      nftTokenId: row.saved.positionId,
      chainId: row.saved.chainId,
      chainName: canonicalChainName(row.saved.chainId),
      walletAddress: normalizeAddress(wallet),
      poolAddress: normalizeAddress(row.saved.poolAddress),
      token0Symbol: row.saved.token0Symbol,
      token1Symbol: row.saved.token1Symbol,
      token0Address: row.saved.token0Address,
      token1Address: row.saved.token1Address,
      feeTier: row.saved.feeTier,
      tickLower: row.saved.tickLower,
      tickUpper: row.saved.tickUpper,
      currentPrice: row.live.currentPrice,
      currentTick: row.live.currentTick,
      savedStatus: row.saved.savedStatus,
      computedStatus:
        row.live.currentTick >= row.saved.tickLower && row.live.currentTick < row.saved.tickUpper
          ? "IN_RANGE"
          : row.saved.savedStatus === "CLOSED"
            ? "CLOSED"
            : "OUT_OF_RANGE",
      liveState: {
        currentTick: row.live.currentTick,
        currentPrice: row.live.currentPrice,
        computedStatus:
          row.live.currentTick >= row.saved.tickLower && row.live.currentTick < row.saved.tickUpper
            ? "IN_RANGE"
            : row.saved.savedStatus === "CLOSED"
              ? "CLOSED"
              : "OUT_OF_RANGE",
        sqrtPriceX96: row.live.sqrtPriceX96,
        liquidity: row.live.liquidity,
        snapshotUpdatedAt: row.live.snapshotUpdatedAt,
        stale: row.live.stale,
        source: row.live.source
      },
      analyticsState: row.analytics,
      isPlaceholderMetrics: row.analytics.status === "placeholder",
      isPlaceholderValuation: row.analytics.status === "placeholder",
      isPlaceholderYieldMetrics: row.analytics.feeState.status === "placeholder",
      placeholderMetrics: {
        isPlaceholderValuation: row.analytics.status === "placeholder",
        isPlaceholderYieldMetrics: row.analytics.feeState.status === "placeholder"
      },
      uncollectedFeesUsd: row.analytics.feeState.estimatedUncollectedFeesUsd ?? 0,
      valueUsd: row.analytics.estimatedPositionValueUsd ?? 0,
      estimatedApr: row.analytics.estimatedApr ?? 0,
      createdAt: row.saved.createdAt,
      sync: savedRow ? buildSyncMetadataFromSavedRow(savedRow) : undefined,
      status: row.saved.savedStatus // Deprecated compatibility field for existing clients.
    };
  });
}

function buildSyncMetadataFromSavedRow(row: SavedPositionRow):
  | {
      status: "NEVER" | "SUCCESS" | "PARTIAL" | "ERROR";
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      error: string | null;
    }
  | undefined {
  const status = row.syncStatus ?? "NEVER";
  const hasAnySyncField = row.syncStatus != null || row.lastSyncAttemptAt != null || row.lastSyncSuccessAt != null || row.lastSyncError != null;
  if (!hasAnySyncField) return undefined;
  return {
    status,
    lastAttemptAt: row.lastSyncAttemptAt ? row.lastSyncAttemptAt.toISOString() : null,
    lastSuccessAt: row.lastSyncSuccessAt ? row.lastSyncSuccessAt.toISOString() : null,
    error: row.lastSyncError ?? null
  };
}

function parseStrategyMode(value: unknown): StrategyMode {
  if (value === "CONSERVATIVE" || value === "AGGRESSIVE" || value === "BALANCED") return value;
  return "BALANCED";
}

async function buildPortfolioStrategySummary(
  wallet: string,
  analyticsRows: PositionAnalyticsResult[]
): Promise<{
  highVolatilityPoolsCount: number;
  rangePoolsCount: number;
  negativeNetBenefitPositionsCount: number;
  partialFailure: boolean;
}> {
  if (analyticsRows.length === 0) {
    return {
      highVolatilityPoolsCount: 0,
      rangePoolsCount: 0,
      negativeNetBenefitPositionsCount: 0,
      partialFailure: false
    };
  }
  const walletAddress = normalizeAddress(wallet);
  const recommendations = await Promise.all(
    analyticsRows.map(async (row) => {
      try {
        const recommendation = await positionStrategyRecommendationService.buildRecommendation({
          walletAddress,
          positionId: row.saved.positionId,
          mode: "BALANCED",
          analyticsRow: row,
          persistSnapshot: false
        });
        return { row, recommendation };
      } catch {
        return null;
      }
    })
  );
  const successful = recommendations.filter((item): item is NonNullable<typeof item> => item != null);
  const poolMarketState = new Map<string, string>();
  for (const item of successful) {
    const poolKey = `${item.row.saved.chainId}:${item.row.saved.poolAddress.toLowerCase()}`;
    if (!poolMarketState.has(poolKey)) {
      poolMarketState.set(poolKey, item.recommendation.market.marketState);
    }
  }
  const highVolatilityPoolsCount = [...poolMarketState.values()].filter((state) => state === "HIGH_VOLATILITY").length;
  const rangePoolsCount = [...poolMarketState.values()].filter((state) => state === "RANGE").length;
  const negativeNetBenefitPositionsCount = successful.filter(
    (item) => item.recommendation.decision.netExpectedBenefitUsd < 0
  ).length;
  return {
    highVolatilityPoolsCount,
    rangePoolsCount,
    negativeNetBenefitPositionsCount,
    partialFailure: successful.length !== recommendations.length
  };
}

