import type { OperatorPermission } from "../automation/operator-permission-types";

export interface OperatorPermissionReadCacheStore {
  getActive(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
    nowMs?: number;
  }): OperatorPermission | null | undefined;
  setActive(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
    value: OperatorPermission | null;
    ttlMs?: number;
    nowMs?: number;
  }): void;
  getOwnerList(input: { ownerWallet: `0x${string}`; nowMs?: number }): OperatorPermission[] | undefined;
  setOwnerList(input: {
    ownerWallet: `0x${string}`;
    value: OperatorPermission[];
    ttlMs?: number;
    nowMs?: number;
  }): void;
  invalidate(input: {
    ownerWallet: `0x${string}`;
    operatorWallet?: `0x${string}`;
  }): number;
  clear(): void;
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_MAX_ENTRIES = 5_000;

export class InMemoryOperatorPermissionReadCacheStore implements OperatorPermissionReadCacheStore {
  private readonly activeCache = new Map<string, CacheEntry<OperatorPermission | null>>();
  private readonly ownerListCache = new Map<string, CacheEntry<OperatorPermission[]>>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      maxEntries?: number;
    } = {}
  ) {}

  getActive(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
    nowMs?: number;
  }): OperatorPermission | null | undefined {
    const key = buildActiveKey(input.ownerWallet, input.operatorWallet);
    const nowMs = input.nowMs ?? Date.now();
    const item = this.activeCache.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= nowMs) {
      this.activeCache.delete(key);
      return undefined;
    }
    return item.value;
  }

  setActive(input: {
    ownerWallet: `0x${string}`;
    operatorWallet: `0x${string}`;
    value: OperatorPermission | null;
    ttlMs?: number;
    nowMs?: number;
  }): void {
    const ttlMs = input.ttlMs ?? this.options.ttlMs ?? DEFAULT_TTL_MS;
    const nowMs = input.nowMs ?? Date.now();
    this.activeCache.set(buildActiveKey(input.ownerWallet, input.operatorWallet), {
      value: input.value,
      expiresAt: nowMs + ttlMs
    });
    evictIfNeeded(this.activeCache, this.options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  getOwnerList(input: { ownerWallet: `0x${string}`; nowMs?: number }): OperatorPermission[] | undefined {
    const key = buildOwnerKey(input.ownerWallet);
    const nowMs = input.nowMs ?? Date.now();
    const item = this.ownerListCache.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= nowMs) {
      this.ownerListCache.delete(key);
      return undefined;
    }
    return item.value;
  }

  setOwnerList(input: {
    ownerWallet: `0x${string}`;
    value: OperatorPermission[];
    ttlMs?: number;
    nowMs?: number;
  }): void {
    const ttlMs = input.ttlMs ?? this.options.ttlMs ?? DEFAULT_TTL_MS;
    const nowMs = input.nowMs ?? Date.now();
    this.ownerListCache.set(buildOwnerKey(input.ownerWallet), {
      value: input.value,
      expiresAt: nowMs + ttlMs
    });
    evictIfNeeded(this.ownerListCache, this.options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  invalidate(input: {
    ownerWallet: `0x${string}`;
    operatorWallet?: `0x${string}`;
  }): number {
    let deleted = 0;
    if (this.ownerListCache.delete(buildOwnerKey(input.ownerWallet))) deleted += 1;
    if (input.operatorWallet && this.activeCache.delete(buildActiveKey(input.ownerWallet, input.operatorWallet))) {
      deleted += 1;
    }
    return deleted;
  }

  clear(): void {
    this.activeCache.clear();
    this.ownerListCache.clear();
  }
}

function buildActiveKey(ownerWallet: `0x${string}`, operatorWallet: `0x${string}`): string {
  return `${ownerWallet.toLowerCase()}:${operatorWallet.toLowerCase()}`;
}

function buildOwnerKey(ownerWallet: `0x${string}`): string {
  return ownerWallet.toLowerCase();
}

function evictIfNeeded<T>(cache: Map<string, CacheEntry<T>>, maxEntries: number) {
  if (cache.size <= maxEntries) return;
  const firstKey = cache.keys().next().value as string | undefined;
  if (firstKey) cache.delete(firstKey);
}

export const operatorPermissionReadCacheStore: OperatorPermissionReadCacheStore =
  new InMemoryOperatorPermissionReadCacheStore();
