import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { randomUUID } from "node:crypto";
import type { MarketSnapshotPoint, StrategyRecommendation, StrategyMode } from "./types";

export interface StrategyStateStore {
  getPositionMode(input: { wallet: `0x${string}`; positionId: string }): Promise<StrategyMode | null>;
  setPositionMode(input: { wallet: `0x${string}`; positionId: string; mode: StrategyMode }): Promise<void>;
}

export interface PoolMarketSnapshotStore {
  getRecentSnapshots(input: { chainId: number; poolAddress: `0x${string}`; limit: number }): Promise<MarketSnapshotPoint[]>;
  saveSnapshot(input: {
    chainId: number;
    poolAddress: `0x${string}`;
    currentTick: number;
    currentPrice: number | null;
    liquidity: string | null;
    volatilityScore?: number | null;
    volumeProxy?: number | null;
    snapshotAt?: Date;
  }): Promise<void>;
}

export interface StrategyRecommendationCache {
  get(key: string, nowMs: number): StrategyRecommendation | undefined;
  set(key: string, value: StrategyRecommendation, expiresAt: number): void;
  clear(): void;
}

type CacheEntry<T> = { value: T; expiresAt: number };

export class InMemoryStrategyStateStore implements StrategyStateStore {
  private readonly map = new Map<string, StrategyMode>();
  async getPositionMode(input: { wallet: `0x${string}`; positionId: string }): Promise<StrategyMode | null> {
    return this.map.get(`${input.wallet.toLowerCase()}:${input.positionId}`) ?? null;
  }
  async setPositionMode(input: { wallet: `0x${string}`; positionId: string; mode: StrategyMode }): Promise<void> {
    this.map.set(`${input.wallet.toLowerCase()}:${input.positionId}`, input.mode);
  }
}

export class InMemoryStrategyRecommendationCache implements StrategyRecommendationCache {
  private readonly cache = new Map<string, CacheEntry<StrategyRecommendation>>();
  get(key: string, nowMs: number): StrategyRecommendation | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= nowMs) {
      this.cache.delete(key);
      return undefined;
    }
    return item.value;
  }
  set(key: string, value: StrategyRecommendation, expiresAt: number): void {
    this.cache.set(key, { value, expiresAt });
    if (this.cache.size > 5000) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }
  clear(): void {
    this.cache.clear();
  }
}

export class PrismaPoolMarketSnapshotStore implements PoolMarketSnapshotStore {
  async getRecentSnapshots(input: { chainId: number; poolAddress: `0x${string}`; limit: number }): Promise<MarketSnapshotPoint[]> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{
          snapshotAt: Date;
          currentTick: number;
          currentPrice: number | null;
          liquidity: string | null;
          volatilityScore: number | null;
          volumeProxy: number | null;
        }>
      >`SELECT "snapshotAt","currentTick","currentPrice","liquidity","volatilityScore","volumeProxy"
         FROM "PoolMarketSnapshot"
         WHERE "chainId" = ${input.chainId} AND "poolAddress" = ${input.poolAddress.toLowerCase()}
         ORDER BY "snapshotAt" DESC
         LIMIT ${Math.max(1, Math.min(500, input.limit))}`;
      return rows.reverse().map((row) => ({
        snapshotAt: row.snapshotAt.toISOString(),
        currentTick: row.currentTick,
        currentPrice: row.currentPrice,
        liquidity: row.liquidity,
        volatilityScore: row.volatilityScore,
        volumeProxy: row.volumeProxy
      }));
    } catch {
      // Keep graceful behavior when migrations are not applied yet.
      return [];
    }
  }

  async saveSnapshot(input: {
    chainId: number;
    poolAddress: `0x${string}`;
    currentTick: number;
    currentPrice: number | null;
    liquidity: string | null;
    volatilityScore?: number | null;
    volumeProxy?: number | null;
    snapshotAt?: Date;
  }): Promise<void> {
    try {
      await prisma.$executeRaw`
        INSERT INTO "PoolMarketSnapshot" ("id","chainId","poolAddress","snapshotAt","currentTick","currentPrice","liquidity","volatilityScore","volumeProxy")
        VALUES (${randomUUID()}, ${input.chainId}, ${input.poolAddress.toLowerCase()}, ${input.snapshotAt ?? new Date()}, ${input.currentTick}, ${input.currentPrice}, ${input.liquidity}, ${input.volatilityScore ?? null}, ${input.volumeProxy ?? null})
      `;
    } catch {
      await enqueuePendingSnapshotWrite({
        chainId: input.chainId,
        poolAddress: input.poolAddress,
        currentTick: input.currentTick,
        currentPrice: input.currentPrice,
        liquidity: input.liquidity,
        volatilityScore: input.volatilityScore ?? null,
        volumeProxy: input.volumeProxy ?? null,
        snapshotAt: (input.snapshotAt ?? new Date()).toISOString()
      });
    }
  }
}

type PendingSnapshotWrite = {
  chainId: number;
  poolAddress: `0x${string}`;
  currentTick: number;
  currentPrice: number | null;
  liquidity: string | null;
  volatilityScore: number | null;
  volumeProxy: number | null;
  snapshotAt: string;
};

const pendingSnapshotWrites: PendingSnapshotWrite[] = [];
const MAX_PENDING_SNAPSHOT_WRITES = 5000;

async function enqueuePendingSnapshotWrite(item: PendingSnapshotWrite) {
  const persisted = await persistPendingSnapshotWriteToDb(item);
  if (persisted) return;
  pendingSnapshotWrites.push(item);
  if (pendingSnapshotWrites.length > MAX_PENDING_SNAPSHOT_WRITES) {
    pendingSnapshotWrites.splice(0, pendingSnapshotWrites.length - MAX_PENDING_SNAPSHOT_WRITES);
  }
}

export function getPendingSnapshotWriteCount(): number {
  return pendingSnapshotWrites.length;
}

export function drainPendingSnapshotWrites(limit = 100): PendingSnapshotWrite[] {
  const safeLimit = Math.max(1, Math.min(1000, limit));
  return pendingSnapshotWrites.splice(0, safeLimit);
}

export async function getPendingSnapshotWriteCountDurable(): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint as count FROM "PendingSnapshotWrite"`;
    const value = rows[0]?.count;
    return typeof value === "bigint" ? Number(value) : null;
  } catch {
    return null;
  }
}

export async function drainPendingSnapshotWritesDurable(limit = 100): Promise<PendingSnapshotWrite[]> {
  const safeLimit = Math.max(1, Math.min(1000, limit));
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        chainId: number;
        poolAddress: string;
        currentTick: number;
        currentPrice: number | null;
        liquidity: string | null;
        volatilityScore: number | null;
        volumeProxy: number | null;
        snapshotAt: Date;
      }>
    >`SELECT "id","chainId","poolAddress","currentTick","currentPrice","liquidity","volatilityScore","volumeProxy","snapshotAt"
       FROM "PendingSnapshotWrite"
       ORDER BY "createdAt" ASC
       LIMIT ${safeLimit}`;
    if (rows.length === 0) return [];
    await prisma.$executeRaw`
      DELETE FROM "PendingSnapshotWrite"
      WHERE "id" IN (${Prisma.join(rows.map((row) => row.id))})
    `;
    return rows.map((row) => ({
      chainId: row.chainId,
      poolAddress: row.poolAddress as `0x${string}`,
      currentTick: row.currentTick,
      currentPrice: row.currentPrice,
      liquidity: row.liquidity,
      volatilityScore: row.volatilityScore,
      volumeProxy: row.volumeProxy,
      snapshotAt: row.snapshotAt.toISOString()
    }));
  } catch {
    return [];
  }
}

async function persistPendingSnapshotWriteToDb(item: PendingSnapshotWrite): Promise<boolean> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "PendingSnapshotWrite"
      ("id","chainId","poolAddress","currentTick","currentPrice","liquidity","volatilityScore","volumeProxy","snapshotAt","createdAt","retryCount")
      VALUES
      (${randomUUID()}, ${item.chainId}, ${item.poolAddress.toLowerCase()}, ${item.currentTick}, ${item.currentPrice}, ${item.liquidity}, ${item.volatilityScore}, ${item.volumeProxy}, ${new Date(item.snapshotAt)}, NOW(), 0)
    `;
    return true;
  } catch {
    return false;
  }
}
