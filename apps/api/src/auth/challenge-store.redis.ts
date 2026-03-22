import type { ChallengeMatchInput, ChallengeRecord, ChallengeStore } from "./challenge-store";

interface RedisSetOptions {
  px?: number;
}

export interface RedisLikeClient {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<unknown>;
  del(key: string): Promise<number>;
}

export interface RedisChallengeStoreOptions {
  ttlMs: number;
  keyPrefix?: string;
}

/**
 * Redis-backed challenge store scaffold.
 * - Uses TTL on each key, so expired records are auto-evicted by Redis.
 * - Key format: <prefix>:<wallet>:<nonce>
 *
 * Note:
 * - This class is intentionally client-agnostic; pass any Redis client that
 *   matches RedisLikeClient (node-redis, ioredis adapter, etc).
 */
export class RedisChallengeStore implements ChallengeStore {
  private readonly ttlMs: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly client: RedisLikeClient,
    options: RedisChallengeStoreOptions
  ) {
    this.ttlMs = options.ttlMs;
    this.keyPrefix = options.keyPrefix ?? "lp-manager:challenge";
  }

  async create(wallet: string, action: string): Promise<ChallengeRecord> {
    const normalizedWallet = wallet.toLowerCase();
    const nonce = randomNonceHex(24);
    const issuedAt = new Date().toISOString();
    const expiresAt = Date.now() + this.ttlMs;
    const record: ChallengeRecord = {
      wallet: normalizedWallet,
      nonce,
      issuedAt,
      action,
      expiresAt
    };
    const key = this.keyFor(normalizedWallet, nonce);
    await this.client.set(key, JSON.stringify(record), { px: this.ttlMs });
    return record;
  }

  async isValid(wallet: string, input: ChallengeMatchInput): Promise<boolean> {
    const normalizedWallet = wallet.toLowerCase();
    const key = this.keyFor(normalizedWallet, input.nonce);
    const raw = await this.client.get(key);
    if (!raw) return false;

    const record = this.parseRecord(raw);
    if (!record) return false;
    if (record.wallet !== normalizedWallet) return false;
    if (record.issuedAt !== input.issuedAt) return false;
    if (record.action !== input.action) return false;
    if (Date.now() > record.expiresAt) {
      await this.client.del(key);
      return false;
    }
    return true;
  }

  async consume(wallet: string, input: ChallengeMatchInput): Promise<boolean> {
    const normalizedWallet = wallet.toLowerCase();
    const key = this.keyFor(normalizedWallet, input.nonce);
    const raw = await this.client.get(key);
    if (!raw) return false;

    const record = this.parseRecord(raw);
    if (!record) return false;
    if (record.wallet !== normalizedWallet) return false;
    if (record.issuedAt !== input.issuedAt) return false;
    if (record.action !== input.action) return false;
    if (Date.now() > record.expiresAt) {
      await this.client.del(key);
      return false;
    }
    await this.client.del(key);
    return true;
  }

  async cleanupExpired(): Promise<number> {
    // Redis key TTL handles expiration cleanup automatically.
    return 0;
  }

  private keyFor(wallet: string, nonce: string): string {
    return `${this.keyPrefix}:${wallet}:${nonce}`;
  }

  private parseRecord(raw: string): ChallengeRecord | null {
    try {
      const v = JSON.parse(raw) as ChallengeRecord;
      if (!v?.wallet || !v?.nonce || !v?.issuedAt || !v?.action || typeof v?.expiresAt !== "number") {
        return null;
      }
      return v;
    } catch {
      return null;
    }
  }
}

function randomNonceHex(byteLength = 24): string {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(byteLength).toString("hex");
}

export async function createRedisLikeClient(redisUrl: string): Promise<RedisLikeClient> {
  const req = eval("require") as NodeRequire;
  let redisModule: { createClient: (args: { url: string }) => any };
  try {
    redisModule = req("redis");
  } catch {
    throw new Error("Redis backend requires `redis` package. Install with: npm install redis -w apps/api");
  }
  const rawClient = redisModule.createClient({ url: redisUrl });
  if (typeof rawClient.connect === "function") {
    await rawClient.connect();
  }
  return {
    get: (key) => rawClient.get(key),
    set: (key, value, options) => rawClient.set(key, value, options),
    del: (key) => rawClient.del(key)
  };
}
