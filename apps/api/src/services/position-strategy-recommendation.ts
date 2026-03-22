import type { PositionAnalyticsResult } from "./position-analytics";
import { estimateGasCostUsd } from "./position-strategy-response";
import {
  DefaultRangeStrategyEngine,
  InMemoryStrategyStateStore,
  PrismaPoolMarketSnapshotStore,
  type PoolMarketSnapshotStore,
  type RangeStrategyEngine,
  type StrategyMode,
  type StrategyRecommendation,
  type StrategyStateStore
} from "./strategy";

type PositionStrategyRecommendationDeps = {
  strategyEngine: RangeStrategyEngine;
  strategyStateStore: StrategyStateStore;
  marketSnapshotStore: PoolMarketSnapshotStore;
};

export class PositionStrategyRecommendationService {
  constructor(
    private readonly deps: PositionStrategyRecommendationDeps = {
      strategyEngine: new DefaultRangeStrategyEngine(),
      strategyStateStore: new InMemoryStrategyStateStore(),
      marketSnapshotStore: new PrismaPoolMarketSnapshotStore()
    }
  ) {}

  async buildRecommendation(input: {
    walletAddress: `0x${string}`;
    positionId: string;
    mode: StrategyMode;
    analyticsRow: PositionAnalyticsResult;
    gasPriceGwei?: number;
    gasUnits?: number;
    persistSnapshot?: boolean;
  }): Promise<StrategyRecommendation> {
    const configuredMode = (await this.deps.strategyStateStore.getPositionMode({
      wallet: input.walletAddress,
      positionId: input.positionId
    })) ?? input.mode;

    const recentSnapshots = await this.deps.marketSnapshotStore.getRecentSnapshots({
      chainId: input.analyticsRow.saved.chainId,
      poolAddress: input.analyticsRow.saved.poolAddress,
      limit: 64
    });
    if (input.persistSnapshot ?? true) {
      await this.deps.marketSnapshotStore.saveSnapshot({
        chainId: input.analyticsRow.saved.chainId,
        poolAddress: input.analyticsRow.saved.poolAddress,
        currentTick: input.analyticsRow.live.currentTick,
        currentPrice: input.analyticsRow.live.currentPrice,
        liquidity: input.analyticsRow.live.liquidity
      });
    }

    const estimatedGasCostUsd = estimateGasCostUsd({
      gasPriceGwei: input.gasPriceGwei,
      gasUnits: input.gasUnits
    });

    return this.deps.strategyEngine.evaluate({
      mode: configuredMode,
      context: {
        wallet: input.walletAddress,
        positionId: input.positionId,
        chainId: input.analyticsRow.saved.chainId,
        poolAddress: input.analyticsRow.saved.poolAddress,
        feeTier: input.analyticsRow.saved.feeTier,
        tickLower: input.analyticsRow.saved.tickLower,
        tickUpper: input.analyticsRow.saved.tickUpper,
        currentTick: input.analyticsRow.live.currentTick,
        currentPrice: input.analyticsRow.live.currentPrice,
        createdAt: input.analyticsRow.saved.createdAt,
        token0Symbol: input.analyticsRow.saved.token0Symbol,
        token1Symbol: input.analyticsRow.saved.token1Symbol,
        analytics: {
          estimatedFeesUsd: input.analyticsRow.analytics.feeState.estimatedUncollectedFeesUsd,
          estimatedApr: input.analyticsRow.analytics.estimatedApr,
          estimatedImpermanentLossUsd: input.analyticsRow.analytics.estimatedImpermanentLossUsd,
          estimatedPositionValueUsd: input.analyticsRow.analytics.estimatedPositionValueUsd,
          metricQuality: "estimated"
        },
        estimatedGasCostUsd
      },
      recentSnapshots
    });
  }
}

export const positionStrategyRecommendationService = new PositionStrategyRecommendationService();
