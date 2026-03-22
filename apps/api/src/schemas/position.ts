import { z } from "zod";
import { positiveIntegerStringSchema } from "@lp-manager/shared";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
export const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid tx hash");
export const positionStatusSchema = z.enum(["IN_RANGE", "OUT_OF_RANGE", "CLOSED"]);
export const syncStatusSchema = z.enum(["NEVER", "SUCCESS", "PARTIAL", "ERROR"]);

export const createPositionSchema = z
  .object({
    wallet: addressSchema,
    positionId: positiveIntegerStringSchema,
    chainId: z.number().int(),
    chainName: z.string().min(1),
    poolAddress: addressSchema,
    token0Address: addressSchema,
    token1Address: addressSchema,
    token0Symbol: z.string().min(1),
    token1Symbol: z.string().min(1),
    feeTier: z.number().int().positive(),
    tickLower: z.number().int(),
    tickUpper: z.number().int(),
    createdTx: txHashSchema,
    slippageBps: z.number().int().min(1).max(100),
    status: positionStatusSchema.default("IN_RANGE"),
    estimatedValueUsd: z.number().nonnegative().optional()
  })
  .superRefine((value, ctx) => {
    if (value.tickLower >= value.tickUpper) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tickLower"],
        message: "tickLower must be less than tickUpper"
      });
    }
  });

export const createLogSchema = z.object({
  wallet: addressSchema,
  positionId: z.string().min(1).optional(),
  type: z.enum([
    "Mint",
    "Burn",
    "Collect",
    "Rebalance",
    "Approve",
    "Position created",
    "Position synced",
    "Snapshot refreshed",
    "Error"
  ]),
  source: z.enum(["user-action", "chain-sync", "worker"]).default("user-action"),
  tx: z.string().optional(),
  message: z.string().min(1)
});

export const positionResponseItemSchema = z.object({
  id: positiveIntegerStringSchema,
  nftTokenId: positiveIntegerStringSchema,
  chainId: z.number().int(),
  chainName: z.string().min(1),
  walletAddress: addressSchema,
  poolAddress: addressSchema,
  token0Symbol: z.string().min(1),
  token1Symbol: z.string().min(1),
  token0Address: addressSchema,
  token1Address: addressSchema,
  feeTier: z.number().int().positive(),
  tickLower: z.number().int(),
  tickUpper: z.number().int(),
  currentPrice: z.number().nullable(),
  currentTick: z.number().int(),
  savedStatus: positionStatusSchema,
  computedStatus: positionStatusSchema,
  analyticsState: z.lazy(() => analyticsStateSchema).optional(),
  liveState: z
    .object({
      currentTick: z.number().int(),
      currentPrice: z.number().nullable(),
      computedStatus: positionStatusSchema,
      sqrtPriceX96: z.string().nullable().optional(),
      liquidity: z.string().nullable().optional(),
      token1PerToken0: z.number().nullable().optional(),
      snapshotUpdatedAt: z.string().datetime().optional(),
      stale: z.boolean().optional(),
      source: z.enum(["rpc", "cache", "fallback"]).optional()
    }),
  isPlaceholderMetrics: z.boolean(),
  isPlaceholderValuation: z.boolean(),
  isPlaceholderYieldMetrics: z.boolean(),
  placeholderMetrics: z
    .object({
      isPlaceholderValuation: z.boolean(),
      isPlaceholderYieldMetrics: z.boolean()
    }),
  uncollectedFeesUsd: z.number(),
  valueUsd: z.number(),
  estimatedApr: z.number(),
  createdAt: z.string().datetime(),
  sync: z
    .object({
      status: syncStatusSchema,
      lastAttemptAt: z.string().datetime().nullable(),
      lastSuccessAt: z.string().datetime().nullable(),
      error: z.string().nullable()
    })
    .optional(),
  status: positionStatusSchema.optional() // Deprecated compatibility field.
});

export const positionsResponseSchema = z.array(positionResponseItemSchema);

export const savedStateSchema = z.object({
  chainId: z.number().int(),
  poolAddress: addressSchema,
  token0Address: addressSchema,
  token1Address: addressSchema,
  token0Symbol: z.string().min(1),
  token1Symbol: z.string().min(1),
  feeTier: z.number().int().positive(),
  tickLower: z.number().int(),
  tickUpper: z.number().int(),
  createdAt: z.string().datetime(),
  savedStatus: positionStatusSchema
});

export const liveStateSchema = z.object({
  currentTick: z.number().int(),
  currentPrice: z.number().nullable(),
  sqrtPriceX96: z.string().nullable(),
  liquidity: z.string().nullable(),
  token1PerToken0: z.number().nullable(),
  snapshotUpdatedAt: z.string().datetime(),
  stale: z.boolean(),
  source: z.enum(["rpc", "cache", "fallback"])
});

export const analyticsStateSchema = z.object({
  status: z.enum(["placeholder", "estimated", "exact"]),
  estimatedPositionValueUsd: z.number().nullable(),
  estimatedPnlUsd: z.number().nullable(),
  estimatedApr: z.number().nullable(),
  estimatedApy: z.number().nullable().optional(),
  estimatedRoiPercent: z.number().nullable(),
  estimatedNetReturnUsd: z.number().nullable(),
  estimatedNetReturnPercent: z.number().nullable(),
  estimatedImpermanentLossUsd: z.number().nullable(),
  estimatedImpermanentLossPercent: z.number().nullable(),
  feeState: z.object({
    status: z.enum(["placeholder", "estimated", "exact"]),
    estimatedUncollectedFeesToken0: z.number().nullable(),
    estimatedUncollectedFeesToken1: z.number().nullable(),
    estimatedUncollectedFeesUsd: z.number().nullable(),
    note: z.string().optional()
  })
});

export const positionDetailResponseSchema = z.object({
  id: positiveIntegerStringSchema,
  walletAddress: addressSchema,
  savedState: savedStateSchema,
  liveState: liveStateSchema,
  analyticsState: analyticsStateSchema,
  placeholderFlags: z.object({
    isPlaceholderValuation: z.boolean(),
    isPlaceholderYieldMetrics: z.boolean()
  }),
  syncMetadata: z
    .object({
      status: syncStatusSchema,
      lastAttemptAt: z.string().datetime().nullable(),
      lastSuccessAt: z.string().datetime().nullable(),
      error: z.string().nullable()
    })
    .optional()
});

export const positionHistoryItemSchema = z.object({
  chainId: z.number().int(),
  positionId: positiveIntegerStringSchema,
  snapshotAt: z.string().datetime(),
  currentTick: z.number().int(),
  currentPrice: z.number().nullable(),
  token0Amount: z.number().nullable(),
  token1Amount: z.number().nullable(),
  estimatedValueUsd: z.number().nullable(),
  estimatedFeesUsd: z.number().nullable(),
  estimatedPnlUsd: z.number().nullable(),
  estimatedIlUsd: z.number().nullable(),
  estimatedApr: z.number().nullable(),
  staleFlag: z.boolean()
});

export const positionHistoryResponseSchema = z.array(positionHistoryItemSchema);

export const dashboardAnalyticsSchema = z.object({
  walletAddress: addressSchema,
  chainId: z.number().int(),
  chainName: z.string().min(1),
  totalPositions: z.number().int(),
  inRange: z.number().int(),
  outOfRange: z.number().int(),
  totalEstimatedValueUsd: z.number(),
  totalEstimatedFeesUsd: z.number(),
  totalEstimatedPnlUsd: z.number(),
  totalEstimatedImpermanentLossUsd: z.number(),
  averageEstimatedApr: z.number().nullable(),
  stalePositionsCount: z.number().int(),
  placeholderFlags: z.object({
    isPlaceholderValuation: z.boolean(),
    isPlaceholderYieldMetrics: z.boolean()
  })
});

const strategyModeSchema = z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]);
const marketStateSchema = z.enum(["RANGE", "UP_TREND", "DOWN_TREND", "HIGH_VOLATILITY", "LOW_LIQUIDITY", "UNKNOWN"]);
const urgencySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const qualityLevelSchema = z.enum(["exact", "estimated", "heuristic", "placeholder"]);
const sourceSchema = z.enum(["rpc", "cache", "fallback", "strategy-engine", "prisma", "aggregator", "worker", "user-action", "chain-sync"]);

export const strategyRecommendationSchema = z.object({
  positionId: positiveIntegerStringSchema,
  walletAddress: addressSchema,
  mode: strategyModeSchema,
  marketState: marketStateSchema,
  marketConfidence: z.number().min(0).max(1),
  marketVolatility: z.number(),
  marketTrendScore: z.number(),
  suggestion: z.object({
    suggestedCenterPrice: z.number().nullable(),
    suggestedLowerPrice: z.number().nullable(),
    suggestedUpperPrice: z.number().nullable(),
    suggestedTickLower: z.number().int(),
    suggestedTickUpper: z.number().int(),
    widthPercent: z.number(),
    confidence: z.number().min(0).max(1)
  }),
  decision: z.object({
    shouldRebalance: z.boolean(),
    urgency: urgencySchema,
    reasonCodes: z.array(z.string()),
    expectedBenefitUsd: z.number(),
    estimatedGasCostUsd: z.number(),
    netExpectedBenefitUsd: z.number()
  }),
  rationale: z.string().min(1),
  explanationLines: z.array(z.string()),
  riskNotes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  quality: z.object({
    marketState: z.enum(["exact", "estimated", "heuristic"]),
    proposal: z.enum(["exact", "estimated", "heuristic"]),
    decision: z.enum(["exact", "estimated", "heuristic"])
  }),
  source: sourceSchema,
  generatedAt: z.string().datetime(),
  stale: z.boolean(),
  preview: z
    .object({
      currentRange: z.object({
        tickLower: z.number().int(),
        tickUpper: z.number().int()
      }),
      proposedRange: z.object({
        tickLower: z.number().int(),
        tickUpper: z.number().int()
      }),
      currentPrice: z.number().nullable(),
      distanceFromRangeTicks: z.number().int(),
      expectedFeeImprovementUsd: z.number(),
      confidenceScore: z.number().min(0).max(1),
      riskNotes: z.array(z.string())
    })
    .optional(),
  computedAt: z.string().datetime(),
  ilFeeEvaluation: z
    .object({
      verdict: z.enum(["CONTINUE", "REBALANCE_CONSIDER", "EXIT_CONSIDER"]),
      feeVsIlRatio: z.number().nullable(),
      netFeesOverIl: z.number().nullable(),
      rationale: z.string(),
      shouldConsiderRebalance: z.boolean(),
      shouldConsiderExit: z.boolean()
    })
    .optional(),
  pairClassification: z.enum(["VOLATILE", "STABLE"]).optional()
});

export const rebalancePreviewRequestSchema = z.object({
  mode: strategyModeSchema.default("BALANCED"),
  gasPriceGwei: z.number().positive().optional(),
  gasUnits: z.number().int().positive().optional()
});

export const responseMetadataSchema = z.object({
  source: sourceSchema,
  generatedAt: z.string().datetime(),
  stale: z.boolean(),
  quality: qualityLevelSchema
});

export const dashboardSummaryResponseSchema = dashboardAnalyticsSchema.extend({
  ethPrice: z.number().nullable(),
  estimatedFeesEarned: z.number(),
  estimatedApr: z.number(),
  estimatedPositionPnlUsd: z.number(),
  totalValue: z.number(),
  metadata: z.object({
    valuation: responseMetadataSchema,
    yieldMetrics: responseMetadataSchema,
    liveState: responseMetadataSchema
  })
});

export const portfolioSummarySchema = z.object({
  walletAddress: addressSchema,
  chainId: z.number().int(),
  totalEstimatedValueUsd: z.number(),
  totalEstimatedFeesUsd: z.number(),
  totalEstimatedPnlUsd: z.number(),
  totalEstimatedImpermanentLossUsd: z.number(),
  averageEstimatedApr: z.number().nullable(),
  positionsCount: z.number().int(),
  outOfRangeCount: z.number().int(),
  highVolatilityPoolsCount: z.number().int(),
  rangePoolsCount: z.number().int(),
  negativeNetBenefitPositionsCount: z.number().int(),
  metadata: z.object({
    valuation: responseMetadataSchema,
    yieldMetrics: responseMetadataSchema,
    strategy: responseMetadataSchema
  })
});

export const dailyProfitItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalFeesUsd: z.number(),
  totalPnlUsd: z.number(),
  estimatedIlUsd: z.number(),
  positionCount: z.number().int(),
  note: z.enum(["estimated", "cumulative"]).optional()
});

export const dailyProfitResponseSchema = z.object({
  walletAddress: addressSchema,
  chainId: z.number().int(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daily: z.array(dailyProfitItemSchema),
  metadata: z.object({
    source: z.literal("PositionSnapshot"),
    quality: z.enum(["estimated", "placeholder"]),
    generatedAt: z.string().datetime()
  })
});

export const activityResponseItemSchema = z.object({
  id: z.string(),
  wallet: addressSchema,
  positionId: z.string().nullable(),
  type: z.string(),
  source: z.string(),
  tx: z.string().nullable(),
  message: z.string(),
  createdAt: z.string().datetime(),
  quality: qualityLevelSchema,
  generatedAt: z.string().datetime(),
  stale: z.boolean(),
  success: z.boolean(),
  error: z.string().nullable(),
  chainId: z.number().int().nullable()
});

export const activityResponseSchema = z.array(activityResponseItemSchema);
