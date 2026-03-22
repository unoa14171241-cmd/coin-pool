import { z } from "zod";

export const syncWalletPathSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address");

export const syncChainIdSchema = z.coerce.number().int().positive();

export const syncRunQuerySchema = z.object({
  chainId: syncChainIdSchema.optional()
});

const syncErrorItemSchema = z.object({
  step: z.string(),
  message: z.string(),
  tokenId: z.string().optional()
});

const syncRunResultItemSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  outcome: z.enum(["SUCCESS", "PARTIAL", "ERROR"]),
  discoveredTokenIds: z.array(z.string()),
  fetchedPositionsCount: z.number().int().nonnegative(),
  matchedLocalPositionsCount: z.number().int().nonnegative(),
  upsertedOnchainStatesCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(syncErrorItemSchema)
});

export const syncRunResponseSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  actorRole: z.enum(["owner", "operator"]),
  triggeredByWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  requestedChainIds: z.array(z.number().int()),
  results: z.array(syncRunResultItemSchema),
  summary: z.object({
    totalChains: z.number().int().nonnegative(),
    successChains: z.number().int().nonnegative(),
    partialChains: z.number().int().nonnegative(),
    errorChains: z.number().int().nonnegative(),
    totalErrors: z.number().int().nonnegative()
  })
});

export const syncIndexedPositionsResponseSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int(),
  total: z.number().int().nonnegative(),
  indexedAt: z.string().datetime(),
  positions: z.array(
    z.object({
      tokenId: z.string(),
      chainId: z.number().int(),
      owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
      operator: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
      token0: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
      token1: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
      fee: z.number().int().nullable(),
      tickLower: z.number().int().nullable(),
      tickUpper: z.number().int().nullable(),
      liquidity: z.string().nullable(),
      tokensOwed0: z.string().nullable(),
      tokensOwed1: z.string().nullable(),
      updatedAt: z.string().datetime(),
      matchedLocalPosition: z.boolean()
    })
  )
});

export const syncOverviewResponseSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  actorRole: z.enum(["owner", "operator"]),
  triggeredByWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int(),
  syncStatus: z.object({
    totalPositions: z.number().int().nonnegative(),
    neverCount: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    partialCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    lastSyncAttemptAt: z.string().datetime().nullable(),
    lastSyncSuccessAt: z.string().datetime().nullable(),
    latestSyncError: z.string().nullable(),
    onchainStatesOwnedCount: z.number().int().nonnegative()
  }),
  indexing: z.object({
    totalIndexed: z.number().int().nonnegative(),
    matchedLocalCount: z.number().int().nonnegative(),
    unmatchedDiscoveredCount: z.number().int().nonnegative(),
    indexedAt: z.string().datetime()
  })
});

export const syncStatusResponseSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chains: z.array(
    z.object({
      chainId: z.number().int(),
      totalPositions: z.number().int().nonnegative(),
      neverCount: z.number().int().nonnegative(),
      successCount: z.number().int().nonnegative(),
      partialCount: z.number().int().nonnegative(),
      errorCount: z.number().int().nonnegative(),
      lastSyncAttemptAt: z.string().datetime().nullable(),
      lastSyncSuccessAt: z.string().datetime().nullable(),
      latestSyncError: z.string().nullable(),
      onchainStatesOwnedCount: z.number().int().nonnegative()
    })
  )
});
