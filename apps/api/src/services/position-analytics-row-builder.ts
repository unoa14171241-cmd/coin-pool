import { Prisma } from "@prisma/client";
import { createPublicClient, http } from "viem";
import { getAddress, isAddress } from "viem";
import { prisma } from "../db/prisma";
import { chainMap, rpcUrlByChain } from "../web3/chains";
import { NONFUNGIBLE_POSITION_MANAGER_BY_CHAIN, USDC_BY_CHAIN, WETH_BY_CHAIN } from "../web3/contracts";
import { DefaultPositionLiveStateLoader, type PositionLiveStateLoader } from "./positions-live";
import {
  ChainlinkPriceProvider,
  CompositeTokenPriceProvider,
  StaticStablecoinPriceProvider
} from "./token-price";
import {
  PositionAnalyticsEngine,
  type PositionAnalyticsResult,
  type SavedPositionData
} from "./position-analytics";
import { nonfungiblePositionManagerAbi } from "./onchain/abis/nonfungible-position-manager";

export type SavedPositionAnalyticsSourceRow = {
  positionId: string;
  chainId: number;
  chainName: string;
  wallet: string;
  poolAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Address: string;
  token1Address: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  createdAt: Date;
  status: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
};

type PositionAnalyticsRowBuilderDeps = {
  liveStateLoader: PositionLiveStateLoader;
  analyticsEngine: PositionAnalyticsEngine;
};

export class PositionAnalyticsRowBuilderService {
  constructor(
    private readonly deps: PositionAnalyticsRowBuilderDeps = {
      liveStateLoader: new DefaultPositionLiveStateLoader(),
      analyticsEngine: new PositionAnalyticsEngine(
        new CompositeTokenPriceProvider([new StaticStablecoinPriceProvider(), new ChainlinkPriceProvider()])
      )
    }
  ) {}

  async build(
    rows: SavedPositionAnalyticsSourceRow[],
    input?: {
      warnLogger?: (entry: Record<string, unknown>) => void;
    }
  ): Promise<{ rows: PositionAnalyticsResult[]; stats: Record<string, unknown> }> {
    if (rows.length === 0) return { rows: [], stats: {} };
    const overallStartedAt = Date.now();
    const onchainStartedAt = Date.now();
    const onchainByPositionId = await loadOnchainStatesByPositionIds(rows.map((row) => row.positionId));
    const missingRows = rows.filter((row) => {
      const item = onchainByPositionId.get(row.positionId);
      return !item || (item.tokensOwed0 == null && item.tokensOwed1 == null);
    });
    if (missingRows.length > 0) {
      const liveOnchain = await loadLiveOnchainFeeStatesByRows(missingRows);
      for (const [positionId, fee] of liveOnchain.entries()) {
        onchainByPositionId.set(positionId, fee);
      }
    }
    const onchainDurationMs = Date.now() - onchainStartedAt;
    const referencePriceStartedAt = Date.now();
    const referencePriceByPositionId = await loadReferencePriceByPositionIds(rows.map((row) => row.positionId));
    const referencePriceDurationMs = Date.now() - referencePriceStartedAt;
    const liveEnrichStartedAt = Date.now();
    const live = await this.deps.liveStateLoader.enrich(
      rows.map((row) => ({
        positionId: row.positionId,
        chainId: row.chainId,
        poolAddress: row.poolAddress,
        token0Address: row.token0Address,
        token1Address: row.token1Address,
        tickLower: row.tickLower,
        tickUpper: row.tickUpper,
        savedStatus: row.status
      })),
      {
        logger: (entry) => {
          input?.warnLogger?.(entry);
        }
      }
    );
    const liveEnrichDurationMs = Date.now() - liveEnrichStartedAt;

    const analyticsComputeStartedAt = Date.now();
    const results = await Promise.all(
      rows.map(async (row) => {
        const liveState = live.byPositionId.get(row.positionId) ?? {
          currentTick: 0,
          currentPrice: null,
          computedStatus: row.status === "CLOSED" ? "CLOSED" : "OUT_OF_RANGE",
          token1PerToken0: null,
          sqrtPriceX96: null,
          liquidity: null,
          snapshotUpdatedAt: new Date().toISOString(),
          stale: true,
          liveStateSource: "fallback" as const
        };
        const saved: SavedPositionData = {
          positionId: row.positionId,
          chainId: row.chainId,
          feeTier: row.feeTier,
          poolAddress: row.poolAddress as `0x${string}`,
          token0Address: row.token0Address as `0x${string}`,
          token1Address: row.token1Address as `0x${string}`,
          token0Symbol: row.token0Symbol,
          token1Symbol: row.token1Symbol,
          tickLower: row.tickLower,
          tickUpper: row.tickUpper,
          createdAt: row.createdAt.toISOString(),
          savedStatus: row.status
        };
        const onchain = onchainByPositionId.get(row.positionId);
        return this.deps.analyticsEngine.analyze({
          saved,
          live: {
            currentTick: liveState.currentTick,
            currentPrice: liveState.currentPrice,
            sqrtPriceX96: liveState.sqrtPriceX96,
            liquidity: liveState.liquidity,
            snapshotUpdatedAt: liveState.snapshotUpdatedAt,
            stale: liveState.stale,
            source: liveState.liveStateSource
          },
          onchainFee: onchain
            ? {
                tokensOwed0Raw: onchain.tokensOwed0,
                tokensOwed1Raw: onchain.tokensOwed1,
                token0Decimals: inferKnownTokenDecimals(row.chainId, row.token0Address),
                token1Decimals: inferKnownTokenDecimals(row.chainId, row.token1Address)
              }
            : undefined,
          referencePrice: referencePriceByPositionId.get(row.positionId) ?? null
        });
      })
    );
    const analyticsComputeDurationMs = Date.now() - analyticsComputeStartedAt;
    const totalDurationMs = Date.now() - overallStartedAt;

    return {
      rows: results,
      stats: {
        ...(live.stats as unknown as Record<string, unknown>),
        onchainReadDurationMs: onchainDurationMs,
        referencePriceReadDurationMs: referencePriceDurationMs,
        liveEnrichDurationMs,
        analyticsComputeDurationMs,
        analyticsTotalDurationMs: totalDurationMs
      }
    };
  }
}

async function loadOnchainStatesByPositionIds(positionIds: string[]) {
  if (positionIds.length === 0) return new Map<string, { tokensOwed0: string | null; tokensOwed1: string | null }>();
  const rows = await prisma.onchainPositionState.findMany({
    where: {
      positionId: {
        in: positionIds
      }
    },
    select: {
      positionId: true,
      tokensOwed0: true,
      tokensOwed1: true
    }
  });
  const map = new Map(rows.map((row) => [row.positionId, { tokensOwed0: row.tokensOwed0, tokensOwed1: row.tokensOwed1 }]));
  return map;
}

async function loadReferencePriceByPositionIds(positionIds: string[]): Promise<Map<string, number>> {
  if (positionIds.length === 0) return new Map();
  try {
    const rows = await prisma.$queryRaw<Array<{ positionId: string; currentPrice: number | null }>>`
      SELECT DISTINCT ON ("positionId") "positionId", "currentPrice"
      FROM "PositionSnapshot"
      WHERE "positionId" IN (${Prisma.join(positionIds)})
        AND "currentPrice" IS NOT NULL
      ORDER BY "positionId", "snapshotAt" ASC
    `;
    return new Map(
      rows
        .filter((row) => typeof row.currentPrice === "number" && Number.isFinite(row.currentPrice))
        .map((row) => [row.positionId, row.currentPrice as number])
    );
  } catch {
    // Keep route behavior resilient when snapshot table/query is unavailable.
    return new Map();
  }
}

function inferKnownTokenDecimals(chainId: number, tokenAddress: string): number | null {
  if (!isAddress(tokenAddress)) return null;
  const normalized = getAddress(tokenAddress).toLowerCase();
  const weth = WETH_BY_CHAIN[chainId];
  const usdc = USDC_BY_CHAIN[chainId];
  if (weth && weth.toLowerCase() === normalized) return 18;
  if (usdc && usdc.toLowerCase() === normalized) return 6;
  return null;
}

async function loadLiveOnchainFeeStatesByRows(
  rows: SavedPositionAnalyticsSourceRow[]
): Promise<Map<string, { tokensOwed0: string | null; tokensOwed1: string | null }>> {
  const byChain = new Map<number, string[]>();
  for (const row of rows) {
    const list = byChain.get(row.chainId) ?? [];
    list.push(row.positionId);
    byChain.set(row.chainId, list);
  }
  const out = new Map<string, { tokensOwed0: string | null; tokensOwed1: string | null }>();
  await Promise.all(
    [...byChain.entries()].map(async ([chainId, positionIds]) => {
      const client = getChainClient(chainId);
      const manager = NONFUNGIBLE_POSITION_MANAGER_BY_CHAIN[chainId];
      if (!client || !manager) return;
      const contracts = positionIds.map((positionId) => ({
        address: manager,
        abi: nonfungiblePositionManagerAbi,
        functionName: "positions" as const,
        args: [BigInt(positionId)] as const
      }));
      const result = await client.multicall({
        allowFailure: true,
        contracts
      });
      for (let i = 0; i < result.length; i += 1) {
        const item = result[i];
        const positionId = positionIds[i];
        if (item.status !== "success") continue;
        const tuple = item.result as readonly [bigint, `0x${string}`, `0x${string}`, `0x${string}`, number, number, number, bigint, bigint, bigint, bigint, bigint];
        out.set(positionId, {
          tokensOwed0: tuple[10].toString(),
          tokensOwed1: tuple[11].toString()
        });
      }
    })
  );
  return out;
}

type ViemClientLike = {
  multicall: (args: unknown) => Promise<any[]>;
};
const chainClientCache = new Map<number, ViemClientLike>();
function getChainClient(chainId: number): ViemClientLike | null {
  const cached = chainClientCache.get(chainId);
  if (cached) return cached;
  const chain = chainMap[chainId as keyof typeof chainMap];
  const rpc = rpcUrlByChain[chainId];
  if (!chain || !rpc) return null;
  const client = createPublicClient({
    chain,
    transport: http(rpc)
  }) as unknown as ViemClientLike;
  chainClientCache.set(chainId, client);
  return client;
}

export const positionAnalyticsRowBuilderService = new PositionAnalyticsRowBuilderService();
