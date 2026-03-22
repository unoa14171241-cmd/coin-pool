import type { PoolSnapshot } from "../positions-live";

const KEY_PREFIX = "lp-manager:pool-snapshot:";
const DEFAULT_TTL_MS = 10_000;

export interface RedisLikeClient {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, options?: { PX?: number; px?: number }): Promise<unknown>;
}

export interface PoolSnapshotCache {
  get(key: string, nowMs: number): Promise<PoolSnapshot | undefined>;
  set(key: string, value: PoolSnapshot, expiresAt: number): Promise<void>;
  clear(): Promise<void>;
}

export class RedisPoolSnapshotCache implements PoolSnapshotCache {
  private readonly ttlMs: number;

  constructor(
    private readonly client: RedisLikeClient,
    options?: { ttlMs?: number }
  ) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  async get(key: string, nowMs: number): Promise<PoolSnapshot | undefined> {
    const raw = await this.client.get(KEY_PREFIX + key);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { value: PoolSnapshot; expiresAt: number };
      if (parsed.expiresAt <= nowMs) return undefined;
      return parsed.value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: PoolSnapshot, expiresAt: number): Promise<void> {
    const ttlMs = Math.max(0, expiresAt - Date.now());
    const payload = JSON.stringify({ value, expiresAt });
    await this.client.set(KEY_PREFIX + key, payload, { px: ttlMs });
  }

  async clear(): Promise<void> {
    // Redis does not support clear by prefix without SCAN. For now no-op.
    // Caller can use a different key prefix per deployment to effectively clear.
  }
}
