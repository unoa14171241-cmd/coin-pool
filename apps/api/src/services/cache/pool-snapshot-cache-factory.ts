import type { PoolSnapshotCache } from "../positions-live";
import { InMemoryPoolSnapshotCache } from "../positions-live";
import { RedisPoolSnapshotCache } from "./redis-pool-snapshot-cache";
import { createRedisLikeClient } from "../../auth/challenge-store.redis";
import { env } from "../../config/env";

let cached: PoolSnapshotCache | null = null;

async function createRedisCache(): Promise<PoolSnapshotCache> {
  const url = env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for Redis snapshot cache");
  const client = await createRedisLikeClient(url);
  return new RedisPoolSnapshotCache(client, { ttlMs: 10_000 });
}

/**
 * Returns the cross-request pool snapshot cache.
 * When REDIS_URL and REDIS_SNAPSHOT_CACHE_ENABLED are set, uses Redis for cross-instance sharing.
 * Otherwise uses in-memory cache.
 */
export async function getCrossRequestPoolSnapshotCache(): Promise<PoolSnapshotCache> {
  if (cached) return cached;
  if (env.REDIS_SNAPSHOT_CACHE_ENABLED && env.REDIS_URL) {
    try {
      cached = await createRedisCache();
    } catch (err) {
      console.warn(
        "[pool-snapshot-cache] Redis init failed, falling back to in-memory:",
        err instanceof Error ? err.message : err
      );
      cached = new InMemoryPoolSnapshotCache();
    }
  } else {
    cached = new InMemoryPoolSnapshotCache();
  }
  return cached;
}
