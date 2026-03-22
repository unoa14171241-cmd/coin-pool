import { allowedChainIds } from "../config/env";
import { prisma } from "../db/prisma";
import { WalletPositionSyncService } from "./indexer/wallet-position-sync";
import {
  DefaultRangeStrategyEngine,
  InProcessStrategyEvaluationWorker as StrategyWorkerRunner,
  PrismaPoolMarketSnapshotStore
} from "./strategy";
import { positionAnalyticsRowBuilderService } from "./position-analytics-row-builder";
export interface TokenPriceCache {
  get(key: string, nowMs: number): number | undefined;
  set(key: string, value: number, expiresAt: number): void;
}

export interface PoolSnapshotCache<TSnapshot> {
  get(key: string, nowMs: number): TSnapshot | undefined;
  set(key: string, value: TSnapshot, expiresAt: number): void;
}

export interface TokenMetadataCache<TMetadata> {
  get(key: string, nowMs: number): TMetadata | undefined;
  set(key: string, value: TMetadata, expiresAt: number): void;
}

export interface PositionAnalyticsCache<T> {
  get(key: string, nowMs: number): T | undefined;
  set(key: string, value: T, expiresAt: number): void;
}

export interface StrategyRecommendationCache<TRecommendation> {
  get(key: string, nowMs: number): TRecommendation | undefined;
  set(key: string, value: TRecommendation, expiresAt: number): void;
}

export interface PositionSnapshotRefresher {
  refreshPositionSnapshots(input: { wallet: string; chainId?: number }): Promise<void>;
}

export interface PositionAnalyticsRefresher {
  refreshPositionAnalytics(input: { wallet: string; chainId?: number }): Promise<void>;
}

export interface PositionEventIndexer {
  syncWalletEvents(input: { wallet: string; chainId?: number }): Promise<void>;
}

export interface StrategyEvaluationWorker {
  evaluateWalletStrategies(input: { wallet: string; chainId?: number }): Promise<void>;
}

export class InProcessSnapshotRefresher implements PositionSnapshotRefresher {
  private readonly indexer = new InProcessEventIndexer();

  async refreshPositionSnapshots(input: { wallet: string; chainId?: number }): Promise<void> {
    await withWalletChainLock(input.wallet, input.chainId, async () => {
      await this.indexer.syncWalletEvents(input);
    });
  }
}

export class InProcessAnalyticsRefresher implements PositionAnalyticsRefresher {
  async refreshPositionAnalytics(input: { wallet: string; chainId?: number }): Promise<void> {
    await withWalletChainLock(input.wallet, input.chainId, async () => {
      const chainFilter = input.chainId != null ? { chainId: input.chainId } : {};
      const positions = await prisma.position.findMany({
        where: {
          wallet: input.wallet.toLowerCase(),
          ...chainFilter
        },
        select: {
          positionId: true,
          chainId: true,
          chainName: true,
          wallet: true,
          poolAddress: true,
          token0Symbol: true,
          token1Symbol: true,
          token0Address: true,
          token1Address: true,
          feeTier: true,
          tickLower: true,
          tickUpper: true,
          createdAt: true,
          status: true
        }
      });
      await positionAnalyticsRowBuilderService.build(positions);
    });
  }
}

export class InProcessEventIndexer implements PositionEventIndexer {
  constructor(private readonly syncService: WalletPositionSyncService = new WalletPositionSyncService()) {}

  async syncWalletEvents(input: { wallet: string; chainId?: number }): Promise<void> {
    const chains = input.chainId != null ? [input.chainId] : allowedChainIds;
    for (const chainId of chains) {
      await this.syncService.syncWalletPositions({
        wallet: input.wallet,
        chainId
      });
    }
  }
}

export class InProcessStrategyEvaluationWorker implements StrategyEvaluationWorker {
  private readonly worker = new StrategyWorkerRunner(new DefaultRangeStrategyEngine(), new PrismaPoolMarketSnapshotStore());

  async evaluateWalletStrategies(input: { wallet: string; chainId?: number }): Promise<void> {
    await withWalletChainLock(input.wallet, input.chainId, async () => {
      await this.worker.evaluateWallet({
        wallet: input.wallet as `0x${string}`,
        mode: "BALANCED"
      });
    });
  }
}

const walletChainLockMap = new Map<string, Promise<void>>();

async function withWalletChainLock(wallet: string, chainId: number | undefined, task: () => Promise<void>) {
  const key = `${wallet.toLowerCase()}:${chainId ?? "all"}`;
  const previous = walletChainLockMap.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (walletChainLockMap.get(key) === current) {
        walletChainLockMap.delete(key);
      }
    });
  walletChainLockMap.set(key, current);
  await current;
}

