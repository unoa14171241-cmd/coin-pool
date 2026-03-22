import { createPublicClient, getAddress, http, isAddress } from "viem";
import { chainMap, rpcUrlByChain } from "../web3/chains";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const DEFAULT_SNAPSHOT_TTL_MS = 10_000;
const DEFAULT_DECIMALS_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_SNAPSHOT_CACHE = 2_000;
const DEFAULT_MAX_DECIMALS_CACHE = 10_000;
const DEFAULT_CONCURRENCY = 8;

const poolAbi = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      { internalType: "uint16", name: "observationCardinality", type: "uint16" },
      { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

const erc20DecimalsAbi = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

export interface PoolSnapshot {
  currentTick: number;
  token1PerToken0: number | null;
  sqrtPriceX96: string | null;
  liquidity: string | null;
  poolToken0: `0x${string}`;
  poolToken1: `0x${string}`;
  snapshotUpdatedAt: string;
  stale: boolean;
  liveStateSource: "rpc" | "cache" | "fallback";
}

export interface PositionLiveInputRow {
  positionId: string;
  chainId: number;
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  tickLower: number;
  tickUpper: number;
  savedStatus: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type ViemClientLike = {
  multicall: (args: unknown) => Promise<any[]>;
  readContract: (args: unknown) => Promise<any>;
};

type SnapshotReadFailureStep = "invalid_pool_address" | "slot0" | "token0_token1" | "decimals" | "price_calc";

type SnapshotReadResult = {
  snapshot: PoolSnapshot;
  isFallback: boolean;
  step?: SnapshotReadFailureStep;
  errorMessage?: string;
};

type RequestContext = {
  chainClients: Map<number, ViemClientLike>;
  requestDecimals: Map<string, number>;
};

export type PoolSnapshotReader = (input: {
  chainId: number;
  poolAddress: string;
  context: RequestContext;
  stats: EnrichPositionsStats;
}) => Promise<SnapshotReadResult>;

export interface EnrichPositionsOptions {
  nowMs?: number;
  concurrency?: number;
  logger?: (entry: Record<string, unknown>) => void;
  poolSnapshotReader?: PoolSnapshotReader;
  /** Override cross-request cache. When not set, uses default (in-memory or Redis when enabled). */
  crossRequestPoolSnapshotCache?: PoolSnapshotCache;
}

export interface EnrichPositionsStats {
  uniquePools: number;
  livePoolFetches: number;
  requestSnapshotCacheHits: number;
  crossRequestSnapshotCacheHits: number;
  snapshotCacheMisses: number;
  decimalsRequestCacheHits: number;
  decimalsCrossRequestCacheHits: number;
  decimalsCacheMisses: number;
  multicallCount: number;
  fallbackCount: number;
}

export interface PoolSnapshotCache {
  get(key: string, nowMs: number): Promise<PoolSnapshot | undefined>;
  set(key: string, value: PoolSnapshot, expiresAt: number): Promise<void>;
  clear(): Promise<void>;
}

export interface TokenMetadataCache {
  getDecimals(key: string, nowMs: number): number | undefined;
  setDecimals(key: string, value: number, expiresAt: number): void;
  clear(): void;
}

export interface PositionLiveStateLoader {
  enrich(
    rows: PositionLiveInputRow[],
    options?: EnrichPositionsOptions
  ): ReturnType<typeof enrichPositionsWithLiveState>;
}

export class DefaultPositionLiveStateLoader implements PositionLiveStateLoader {
  async enrich(rows: PositionLiveInputRow[], options: EnrichPositionsOptions = {}) {
    return enrichPositionsWithLiveState(rows, options);
  }
}

export class InMemoryPoolSnapshotCache implements PoolSnapshotCache {
  private readonly cache = new Map<string, CacheEntry<PoolSnapshot>>();
  async get(key: string, nowMs: number): Promise<PoolSnapshot | undefined> {
    return getCachedEntry(this.cache, key, nowMs);
  }
  async set(key: string, value: PoolSnapshot, expiresAt: number): Promise<void> {
    setCachedEntry(this.cache, key, value, expiresAt, DEFAULT_MAX_SNAPSHOT_CACHE);
  }
  async clear(): Promise<void> {
    this.cache.clear();
  }
}

class InMemoryTokenMetadataCache implements TokenMetadataCache {
  private readonly cache = new Map<string, CacheEntry<number>>();
  getDecimals(key: string, nowMs: number): number | undefined {
    return getCachedEntry(this.cache, key, nowMs);
  }
  setDecimals(key: string, value: number, expiresAt: number): void {
    setCachedEntry(this.cache, key, value, expiresAt, DEFAULT_MAX_DECIMALS_CACHE);
  }
  clear(): void {
    this.cache.clear();
  }
}

let crossRequestPoolSnapshotCachePromise: Promise<PoolSnapshotCache> | null = null;

function getCrossRequestPoolSnapshotCache(): Promise<PoolSnapshotCache> {
  if (crossRequestPoolSnapshotCachePromise) return crossRequestPoolSnapshotCachePromise;
  crossRequestPoolSnapshotCachePromise = import("./cache/pool-snapshot-cache-factory").then((m) =>
    m.getCrossRequestPoolSnapshotCache()
  );
  return crossRequestPoolSnapshotCachePromise;
}

const crossRequestTokenMetadataCache: TokenMetadataCache = new InMemoryTokenMetadataCache();

export async function __resetPositionsLiveCachesForTests() {
  const cache = await getCrossRequestPoolSnapshotCache();
  await cache.clear();
  crossRequestTokenMetadataCache.clear();
  crossRequestPoolSnapshotCachePromise = null;
}

export async function enrichPositionsWithLiveState(
  rows: PositionLiveInputRow[],
  options: EnrichPositionsOptions = {}
): Promise<{
  byPositionId: Map<
    string,
    {
      currentTick: number;
      currentPrice: number | null;
      computedStatus: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
      token1PerToken0: number | null;
      sqrtPriceX96: string | null;
      liquidity: string | null;
      snapshotUpdatedAt: string;
      stale: boolean;
      liveStateSource: "rpc" | "cache" | "fallback";
    }
  >;
  stats: EnrichPositionsStats;
}> {
  const nowMs = options.nowMs ?? Date.now();
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const logger = options.logger ?? (() => undefined);
  const reader = options.poolSnapshotReader ?? readPoolSnapshotLive;
  const crossRequestCache =
    options.crossRequestPoolSnapshotCache ?? (await getCrossRequestPoolSnapshotCache());

  const requestSnapshotCache = new Map<string, PoolSnapshot>();
  const context: RequestContext = {
    chainClients: new Map<number, ViemClientLike>(),
    requestDecimals: new Map<string, number>()
  };

  const uniquePoolTargets = new Map<string, { chainId: number; poolAddress: string }>();
  for (const row of rows) {
    const key = toSnapshotKey(row.chainId, row.poolAddress);
    if (!uniquePoolTargets.has(key)) {
      uniquePoolTargets.set(key, { chainId: row.chainId, poolAddress: row.poolAddress });
    }
  }

  const stats: EnrichPositionsStats = {
    uniquePools: uniquePoolTargets.size,
    livePoolFetches: 0,
    requestSnapshotCacheHits: 0,
    crossRequestSnapshotCacheHits: 0,
    snapshotCacheMisses: 0,
    decimalsRequestCacheHits: 0,
    decimalsCrossRequestCacheHits: 0,
    decimalsCacheMisses: 0,
    multicallCount: 0,
    fallbackCount: 0
  };

  await mapWithConcurrency(Array.from(uniquePoolTargets.entries()), concurrency, async ([snapshotKey, target]) => {
    const requestCached = requestSnapshotCache.get(snapshotKey);
    if (requestCached) {
      stats.requestSnapshotCacheHits += 1;
      return;
    }
    const crossRequestCached = await crossRequestCache.get(snapshotKey, nowMs);
    if (crossRequestCached) {
      requestSnapshotCache.set(snapshotKey, {
        ...crossRequestCached,
        liveStateSource: "cache",
        stale: true
      });
      stats.crossRequestSnapshotCacheHits += 1;
      return;
    }

    stats.snapshotCacheMisses += 1;
    stats.livePoolFetches += 1;
    let readResult: SnapshotReadResult;
    try {
      readResult = await reader({
        chainId: target.chainId,
        poolAddress: target.poolAddress,
        context,
        stats
      });
    } catch (error) {
      readResult = {
        snapshot: fallbackPoolSnapshot(),
        isFallback: true,
        step: "slot0",
        errorMessage: error instanceof Error ? error.message : "unknown read error"
      };
    }
    requestSnapshotCache.set(snapshotKey, readResult.snapshot);
    if (!readResult.isFallback) {
      await crossRequestCache.set(snapshotKey, readResult.snapshot, nowMs + DEFAULT_SNAPSHOT_TTL_MS);
    } else {
      stats.fallbackCount += 1;
      logger({
        event: "positions_pool_snapshot_fallback",
        chainId: target.chainId,
        poolAddress: target.poolAddress.toLowerCase(),
        step: readResult.step ?? "unknown",
        error: readResult.errorMessage ?? "unknown"
      });
    }
  });

  const byPositionId = new Map<
    string,
    {
      currentTick: number;
      currentPrice: number | null;
      computedStatus: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
      token1PerToken0: number | null;
      sqrtPriceX96: string | null;
      liquidity: string | null;
      snapshotUpdatedAt: string;
      stale: boolean;
      liveStateSource: "rpc" | "cache" | "fallback";
    }
  >();

  for (const row of rows) {
    const snapshot = requestSnapshotCache.get(toSnapshotKey(row.chainId, row.poolAddress)) ?? fallbackPoolSnapshot();
    const currentPrice = deriveCurrentPriceFromSnapshot({
      snapshot,
      responseToken0Address: row.token0Address,
      responseToken1Address: row.token1Address
    });
    const computedStatus =
      row.savedStatus === "CLOSED"
        ? "CLOSED"
        : row.tickLower <= snapshot.currentTick && snapshot.currentTick < row.tickUpper
          ? "IN_RANGE"
          : "OUT_OF_RANGE";

    byPositionId.set(row.positionId, {
      currentTick: snapshot.currentTick,
      currentPrice,
      computedStatus,
      token1PerToken0: snapshot.token1PerToken0,
      sqrtPriceX96: snapshot.sqrtPriceX96,
      liquidity: snapshot.liquidity,
      snapshotUpdatedAt: snapshot.snapshotUpdatedAt,
      stale: snapshot.stale,
      liveStateSource: snapshot.liveStateSource
    });
  }

  return { byPositionId, stats };
}

async function readPoolSnapshotLive(input: {
  chainId: number;
  poolAddress: string;
  context: RequestContext;
  stats: EnrichPositionsStats;
}): Promise<SnapshotReadResult> {
  if (!isAddress(input.poolAddress)) {
    return {
      snapshot: fallbackPoolSnapshot(),
      isFallback: true,
      step: "invalid_pool_address",
      errorMessage: "invalid pool address"
    };
  }

  const client = getChainClient(input.chainId, input.context.chainClients);
  const poolAddress = getAddress(input.poolAddress);

  const poolRead = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: poolAddress, abi: poolAbi, functionName: "slot0" },
      { address: poolAddress, abi: poolAbi, functionName: "token0" },
      { address: poolAddress, abi: poolAbi, functionName: "token1" },
      { address: poolAddress, abi: poolAbi, functionName: "liquidity" }
    ]
  });
  input.stats.multicallCount += 1;

  const slot0Result = poolRead[0];
  if (slot0Result.status !== "success") {
    return {
      snapshot: fallbackPoolSnapshot(),
      isFallback: true,
      step: "slot0",
      errorMessage: slot0Result.error?.message ?? "slot0 multicall failed"
    };
  }
  const token0Result = poolRead[1];
  const token1Result = poolRead[2];
  const liquidityResult = poolRead[3];
  if (token0Result.status !== "success" || token1Result.status !== "success" || liquidityResult.status !== "success") {
    return {
      snapshot: fallbackPoolSnapshot(),
      isFallback: true,
      step: "token0_token1",
      errorMessage:
        token0Result.status !== "success"
          ? token0Result.error?.message ?? "token0 read failed"
          : token1Result.status !== "success"
            ? token1Result.error?.message ?? "token1 read failed"
            : liquidityResult.error?.message ?? "liquidity read failed"
    };
  }

  const [sqrtPriceX96, tick] = slot0Result.result;
  const poolToken0 = getAddress(token0Result.result);
  const poolToken1 = getAddress(token1Result.result);
  const decimals = await readDecimalsWithCaches({
    chainId: input.chainId,
    client,
    tokenAddresses: [poolToken0, poolToken1],
    requestDecimals: input.context.requestDecimals,
    stats: input.stats
  });
  if (!decimals) {
    return {
      snapshot: fallbackPoolSnapshot(),
      isFallback: true,
      step: "decimals",
      errorMessage: "token decimals read failed"
    };
  }

  const token1PerToken0 = sqrtPriceX96ToToken1PerToken0(sqrtPriceX96, decimals[0], decimals[1]);
  if (token1PerToken0 == null) {
    return {
      snapshot: fallbackPoolSnapshot(),
      isFallback: true,
      step: "price_calc",
      errorMessage: "price conversion failed"
    };
  }

  return {
    snapshot: {
      currentTick: Number(tick),
      token1PerToken0,
      sqrtPriceX96: sqrtPriceX96.toString(),
      liquidity: liquidityResult.result.toString(),
      poolToken0,
      poolToken1,
      snapshotUpdatedAt: new Date().toISOString(),
      stale: false,
      liveStateSource: "rpc"
    },
    isFallback: false
  };
}

async function readDecimalsWithCaches(input: {
  chainId: number;
  client: ViemClientLike;
  tokenAddresses: [`0x${string}`, `0x${string}`];
  requestDecimals: Map<string, number>;
  stats: EnrichPositionsStats;
}): Promise<[number, number] | null> {
  const nowMs = Date.now();
  const [token0, token1] = input.tokenAddresses;
  const key0 = toDecimalsKey(input.chainId, token0);
  const key1 = toDecimalsKey(input.chainId, token1);

  const requestCached0 = input.requestDecimals.get(key0);
  const requestCached1 = input.requestDecimals.get(key1);
  if (requestCached0 != null && requestCached1 != null) {
    input.stats.decimalsRequestCacheHits += 2;
    return [requestCached0, requestCached1];
  }

  const crossCached0 = requestCached0 ?? crossRequestTokenMetadataCache.getDecimals(key0, nowMs);
  const crossCached1 = requestCached1 ?? crossRequestTokenMetadataCache.getDecimals(key1, nowMs);
  if (crossCached0 != null && crossCached1 != null) {
    input.requestDecimals.set(key0, crossCached0);
    input.requestDecimals.set(key1, crossCached1);
    input.stats.decimalsCrossRequestCacheHits += 2;
    return [crossCached0, crossCached1];
  }

  const missingContracts: { index: 0 | 1; address: `0x${string}` }[] = [];
  if (crossCached0 == null) missingContracts.push({ index: 0, address: token0 });
  if (crossCached1 == null) missingContracts.push({ index: 1, address: token1 });
  input.stats.decimalsCacheMisses += missingContracts.length;

  if (missingContracts.length > 0) {
    const readResults = await input.client.multicall({
      allowFailure: true,
      contracts: missingContracts.map((item) => ({
        address: item.address,
        abi: erc20DecimalsAbi,
        functionName: "decimals" as const
      }))
    });
    input.stats.multicallCount += 1;

    const resolved: [number | undefined, number | undefined] = [crossCached0, crossCached1];
    for (let i = 0; i < missingContracts.length; i += 1) {
      const result = readResults[i];
      if (!result || result.status !== "success") return null;
      resolved[missingContracts[i].index] = Number(result.result);
    }

    if (resolved[0] == null || resolved[1] == null) return null;
    input.requestDecimals.set(key0, resolved[0]);
    input.requestDecimals.set(key1, resolved[1]);
    crossRequestTokenMetadataCache.setDecimals(key0, resolved[0], nowMs + DEFAULT_DECIMALS_TTL_MS);
    crossRequestTokenMetadataCache.setDecimals(key1, resolved[1], nowMs + DEFAULT_DECIMALS_TTL_MS);
    return [resolved[0], resolved[1]];
  }

  return null;
}

function deriveCurrentPriceFromSnapshot(input: {
  snapshot: PoolSnapshot;
  responseToken0Address: string;
  responseToken1Address: string;
}): number | null {
  const { snapshot } = input;
  if (!isAddress(input.responseToken0Address) || !isAddress(input.responseToken1Address)) {
    return null;
  }
  if (snapshot.token1PerToken0 == null) {
    return null;
  }
  const responseToken0 = getAddress(input.responseToken0Address);
  const responseToken1 = getAddress(input.responseToken1Address);
  const poolToken0 = snapshot.poolToken0;
  const poolToken1 = snapshot.poolToken1;

  if (responseToken0.toLowerCase() === poolToken0.toLowerCase() && responseToken1.toLowerCase() === poolToken1.toLowerCase()) {
    return snapshot.token1PerToken0;
  }
  if (responseToken0.toLowerCase() === poolToken1.toLowerCase() && responseToken1.toLowerCase() === poolToken0.toLowerCase()) {
    if (snapshot.token1PerToken0 === 0) return null;
    return Number((1 / snapshot.token1PerToken0).toFixed(8));
  }
  return null;
}

function getChainClient(chainId: number, cache: Map<number, ViemClientLike>): ViemClientLike {
  const cached = cache.get(chainId);
  if (cached) return cached;
  const chain = chainMap[chainId as keyof typeof chainMap];
  const rpcUrl = rpcUrlByChain[chainId];
  if (!chain || !rpcUrl) {
    throw new Error(`Unsupported chain or missing RPC URL: ${chainId}`);
  }
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl)
  }) as unknown as ViemClientLike;
  cache.set(chainId, client);
  return client;
}

function fallbackPoolSnapshot(): PoolSnapshot {
  return {
    currentTick: 0,
    token1PerToken0: null,
    sqrtPriceX96: null,
    liquidity: null,
    poolToken0: ZERO_ADDRESS,
    poolToken1: ZERO_ADDRESS,
    snapshotUpdatedAt: new Date().toISOString(),
    stale: true,
    liveStateSource: "fallback"
  };
}

function sqrtPriceX96ToToken1PerToken0(sqrtPriceX96: bigint, token0Decimals: number, token1Decimals: number): number | null {
  // Uniswap V3 price formula (token1 per token0):
  // price = (sqrtPriceX96^2 / 2^192) * 10^(decimals0 - decimals1)
  // decimals adjustment normalizes raw ratio into token display units.
  const q192 = 2n ** 192n;
  const numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(token0Decimals);
  const denominator = q192 * 10n ** BigInt(token1Decimals);
  const value = Number(numerator) / Number(denominator);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Number(value.toFixed(8));
}

function toSnapshotKey(chainId: number, poolAddress: string): string {
  return `${chainId}:${poolAddress.toLowerCase()}`;
}

function toDecimalsKey(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function getCachedEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, nowMs: number): T | undefined {
  const item = cache.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= nowMs) {
    cache.delete(key);
    return undefined;
  }
  return item.value;
}

function setCachedEntry<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  expiresAt: number,
  maxEntries: number
) {
  cache.set(key, { value, expiresAt });
  if (cache.size <= maxEntries) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey) cache.delete(oldestKey);
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const size = Math.max(1, concurrency);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

