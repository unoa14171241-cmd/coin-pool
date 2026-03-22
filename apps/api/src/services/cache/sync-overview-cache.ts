export interface SyncOverviewCore {
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
}

export interface SyncOverviewCacheStore {
  get(input: { wallet: `0x${string}`; chainId: number; nowMs?: number }): SyncOverviewCore | undefined;
  set(input: { wallet: `0x${string}`; chainId: number; value: SyncOverviewCore; ttlMs?: number; nowMs?: number }): void;
  invalidate(input: { wallet: `0x${string}`; chainIds: number[] }): number;
}

type CacheEntry = {
  value: SyncOverviewCore;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_MAX_ENTRIES = 5_000;

export class InMemorySyncOverviewCacheStore implements SyncOverviewCacheStore {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      maxEntries?: number;
    } = {}
  ) {}

  get(input: { wallet: `0x${string}`; chainId: number; nowMs?: number }): SyncOverviewCore | undefined {
    const key = buildKey(input.wallet, input.chainId);
    const nowMs = input.nowMs ?? Date.now();
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= nowMs) {
      this.cache.delete(key);
      return undefined;
    }
    return item.value;
  }

  set(input: { wallet: `0x${string}`; chainId: number; value: SyncOverviewCore; ttlMs?: number; nowMs?: number }): void {
    const ttlMs = input.ttlMs ?? this.options.ttlMs ?? DEFAULT_TTL_MS;
    const nowMs = input.nowMs ?? Date.now();
    this.cache.set(buildKey(input.wallet, input.chainId), {
      value: input.value,
      expiresAt: nowMs + ttlMs
    });
    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (this.cache.size > maxEntries) {
      const firstKey = this.cache.keys().next().value as string | undefined;
      if (firstKey) this.cache.delete(firstKey);
    }
  }

  invalidate(input: { wallet: `0x${string}`; chainIds: number[] }): number {
    let deleted = 0;
    for (const chainId of input.chainIds) {
      if (this.cache.delete(buildKey(input.wallet, chainId))) deleted += 1;
    }
    return deleted;
  }
}

function buildKey(wallet: `0x${string}`, chainId: number): string {
  return `${wallet.toLowerCase()}:${chainId}`;
}

export const syncOverviewCacheStore: SyncOverviewCacheStore = new InMemorySyncOverviewCacheStore();
