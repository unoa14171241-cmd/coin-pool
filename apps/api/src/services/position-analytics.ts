import { getTokenAmountsForPosition } from "../lib/uniswap/liquidity-math";
import type { TokenPriceProvider } from "./token-price";
import { convertOnchainTokensOwedToAmounts, type OnchainFeeInput } from "./analytics/fee-accounting";
import { estimateImpermanentLossFromPriceRatio } from "./analytics/il-calculator";

export type AnalyticsStatus = "placeholder" | "estimated" | "exact";
export type FeeEstimateStatus = "placeholder" | "estimated" | "exact";

export interface SavedPositionData {
  positionId: string;
  chainId: number;
  feeTier: number;
  poolAddress: `0x${string}`;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  token0Symbol: string;
  token1Symbol: string;
  tickLower: number;
  tickUpper: number;
  createdAt: string;
  savedStatus: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
}

export interface LivePoolState {
  currentTick: number;
  currentPrice: number | null;
  sqrtPriceX96: string | null;
  liquidity: string | null;
  snapshotUpdatedAt: string;
  stale: boolean;
  source: "rpc" | "cache" | "fallback";
}

export interface FeeAnalyticsState {
  status: FeeEstimateStatus;
  estimatedUncollectedFeesToken0: number | null;
  estimatedUncollectedFeesToken1: number | null;
  estimatedUncollectedFeesUsd: number | null;
  note?: string;
}

export interface AnalyticsState {
  status: AnalyticsStatus;
  estimatedPositionValueUsd: number | null;
  estimatedPnlUsd: number | null;
  estimatedApr: number | null;
  estimatedApy: number | null;
  estimatedRoiPercent: number | null;
  estimatedNetReturnUsd: number | null;
  estimatedNetReturnPercent: number | null;
  estimatedImpermanentLossUsd: number | null;
  estimatedImpermanentLossPercent: number | null;
  feeState: FeeAnalyticsState;
}

export interface PositionAnalyticsResult {
  saved: SavedPositionData;
  live: LivePoolState;
  analytics: AnalyticsState;
  tokenAmounts: {
    token0Amount: number | null;
    token1Amount: number | null;
    method: "liquidity-math-estimated" | "unavailable";
  };
}

export class PositionAnalyticsEngine {
  constructor(private readonly priceProvider: TokenPriceProvider) {}

  async analyze(input: {
    saved: SavedPositionData;
    live: LivePoolState;
    onchainFee?: OnchainFeeInput;
    referencePrice?: number | null;
  }): Promise<PositionAnalyticsResult> {
    const tokenAmounts = this.estimatePositionTokenAmounts(input);
    const valueUsd = await this.estimatePositionValueUsd({
      saved: input.saved,
      token0Amount: tokenAmounts.token0Amount,
      token1Amount: tokenAmounts.token1Amount
    });
    const feeState = await this.estimateUncollectedFees({
      saved: input.saved,
      onchainFee: input.onchainFee,
      estimatedPositionValueUsd: valueUsd,
      nowMs: Date.now()
    });
    const pnl = this.estimatePositionPnl(valueUsd, feeState.estimatedUncollectedFeesUsd);
    const il = this.estimateImpermanentLoss({
      referencePrice: input.referencePrice ?? null,
      currentPrice: input.live.currentPrice,
      positionValueUsd: valueUsd
    });
    const apr = this.estimateApr({
      positionValueUsd: valueUsd,
      pnlUsd: pnl.estimatedPnlUsd,
      createdAt: input.saved.createdAt
    });

    return {
      saved: input.saved,
      live: input.live,
      tokenAmounts,
      analytics: {
        status: "estimated",
        estimatedPositionValueUsd: valueUsd,
        estimatedPnlUsd: pnl.estimatedPnlUsd,
        estimatedApr: apr.estimatedApr,
        estimatedApy: apr.estimatedApy,
        estimatedRoiPercent: apr.estimatedRoiPercent,
        estimatedNetReturnUsd: pnl.estimatedPnlUsd,
        estimatedNetReturnPercent: apr.estimatedRoiPercent,
        estimatedImpermanentLossUsd: il.estimatedImpermanentLossUsd,
        estimatedImpermanentLossPercent: il.estimatedImpermanentLossPercent,
        feeState
      }
    };
  }

  estimatePositionTokenAmounts(input: { saved: SavedPositionData; live: LivePoolState }): PositionAnalyticsResult["tokenAmounts"] {
    if (!input.live.liquidity) {
      return { token0Amount: null, token1Amount: null, method: "unavailable" };
    }
    try {
      const amounts = getTokenAmountsForPosition({
        currentTick: input.live.currentTick,
        tickLower: input.saved.tickLower,
        tickUpper: input.saved.tickUpper,
        liquidity: BigInt(input.live.liquidity)
      });
      return {
        token0Amount: Number(amounts.amount0) / 1e18,
        token1Amount: Number(amounts.amount1) / 1e6,
        method: "liquidity-math-estimated"
      };
    } catch {
      return { token0Amount: null, token1Amount: null, method: "unavailable" };
    }
  }

  async estimatePositionValueUsd(input: {
    saved: SavedPositionData;
    token0Amount: number | null;
    token1Amount: number | null;
  }): Promise<number | null> {
    if (input.token0Amount == null || input.token1Amount == null) return null;
    const [token0Price, token1Price] = await Promise.all([
      this.priceProvider.getTokenUsdPrice({
        chainId: input.saved.chainId,
        tokenAddress: input.saved.token0Address,
        symbol: input.saved.token0Symbol
      }),
      this.priceProvider.getTokenUsdPrice({
        chainId: input.saved.chainId,
        tokenAddress: input.saved.token1Address,
        symbol: input.saved.token1Symbol
      })
    ]);
    if (token0Price == null || token1Price == null) return null;
    return Number((input.token0Amount * token0Price + input.token1Amount * token1Price).toFixed(2));
  }

  async estimateUncollectedFees(input: {
    saved: SavedPositionData;
    onchainFee?: OnchainFeeInput;
    estimatedPositionValueUsd?: number | null;
    nowMs?: number;
  }): Promise<FeeAnalyticsState> {
    if (input.onchainFee) {
      const converted = convertOnchainTokensOwedToAmounts(input.onchainFee);
      if (converted.exact && converted.token0Amount != null && converted.token1Amount != null) {
        const [token0Price, token1Price] = await Promise.all([
          this.priceProvider.getTokenUsdPrice({
            chainId: input.saved.chainId,
            tokenAddress: input.saved.token0Address,
            symbol: input.saved.token0Symbol
          }),
          this.priceProvider.getTokenUsdPrice({
            chainId: input.saved.chainId,
            tokenAddress: input.saved.token1Address,
            symbol: input.saved.token1Symbol
          })
        ]);
        const estimatedUncollectedFeesUsd =
          token0Price != null && token1Price != null
            ? Number((converted.token0Amount * token0Price + converted.token1Amount * token1Price).toFixed(2))
            : null;
        return {
          status: "exact",
          estimatedUncollectedFeesToken0: converted.token0Amount,
          estimatedUncollectedFeesToken1: converted.token1Amount,
          estimatedUncollectedFeesUsd,
          note:
            estimatedUncollectedFeesUsd == null
              ? "On-chain owed token amounts are exact, but USD conversion price is unavailable."
              : "On-chain owed token amounts from position manager state."
        };
      }
    }
    const valueUsd = input.estimatedPositionValueUsd ?? null;
    if (valueUsd == null || valueUsd <= 0) {
      return {
        status: "estimated",
        estimatedUncollectedFeesToken0: null,
        estimatedUncollectedFeesToken1: null,
        estimatedUncollectedFeesUsd: null,
        note: "Uncollected fee estimate is unavailable because position valuation is unavailable."
      };
    }
    const createdAtMs = Date.parse(input.saved.createdAt);
    const nowMs = input.nowMs ?? Date.now();
    const daysHeld =
      Number.isFinite(createdAtMs) && createdAtMs > 0 && nowMs > createdAtMs
        ? Math.max((nowMs - createdAtMs) / (24 * 60 * 60 * 1000), 1 / 24)
        : 1;
    const accrualWindowDays = Math.min(daysHeld, 14);
    const feeTierRate = input.saved.feeTier / 1_000_000;
    const utilizationFactor = 0.18;
    const estimatedUncollectedFeesUsd = Number((valueUsd * feeTierRate * utilizationFactor * (accrualWindowDays / 365)).toFixed(2));
    return {
      status: "estimated",
      estimatedUncollectedFeesToken0: null,
      estimatedUncollectedFeesToken1: null,
      estimatedUncollectedFeesUsd,
      note: "Heuristic estimate based on position value, fee tier, and recent accrual window."
    };
  }

  estimatePositionPnl(positionValueUsd: number | null, feeUsd: number | null): { estimatedPnlUsd: number | null } {
    if (positionValueUsd == null) return { estimatedPnlUsd: null };
    return { estimatedPnlUsd: Number((positionValueUsd + (feeUsd ?? 0)).toFixed(2)) };
  }

  estimateImpermanentLoss(input: {
    referencePrice: number | null;
    currentPrice: number | null;
    positionValueUsd: number | null;
  }): { estimatedImpermanentLossUsd: number | null; estimatedImpermanentLossPercent: number | null } {
    const estimated = estimateImpermanentLossFromPriceRatio({
      referencePrice: input.referencePrice,
      currentPrice: input.currentPrice,
      currentPositionValueUsd: input.positionValueUsd
    });
    return {
      estimatedImpermanentLossUsd: estimated.estimatedImpermanentLossUsd,
      estimatedImpermanentLossPercent: estimated.estimatedImpermanentLossPercent
    };
  }

  estimateApr(input: {
    positionValueUsd: number | null;
    pnlUsd: number | null;
    createdAt: string;
  }): { estimatedApr: number | null; estimatedApy: number | null; estimatedRoiPercent: number | null } {
    if (input.positionValueUsd == null || input.positionValueUsd <= 0 || input.pnlUsd == null) {
      return { estimatedApr: null, estimatedApy: null, estimatedRoiPercent: null };
    }
    const createdAtMs = Date.parse(input.createdAt);
    const nowMs = Date.now();
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0 || nowMs <= createdAtMs) {
      return { estimatedApr: null, estimatedApy: null, estimatedRoiPercent: null };
    }
    const daysHeld = Math.max((nowMs - createdAtMs) / (24 * 60 * 60 * 1000), 1 / 24);
    const roiDecimal = input.pnlUsd / input.positionValueUsd;
    const annualizationFactor = 365 / daysHeld;
    const aprDecimal = roiDecimal * annualizationFactor;
    let apyDecimal: number | null = null;
    if (roiDecimal > -1) {
      const compounded = (1 + roiDecimal) ** annualizationFactor - 1;
      if (Number.isFinite(compounded)) apyDecimal = compounded;
    }
    if (!Number.isFinite(aprDecimal)) {
      return { estimatedApr: null, estimatedApy: null, estimatedRoiPercent: null };
    }
    return {
      estimatedApr: Number((aprDecimal * 100).toFixed(2)),
      estimatedApy: apyDecimal == null ? null : Number((apyDecimal * 100).toFixed(2)),
      estimatedRoiPercent: Number((roiDecimal * 100).toFixed(2))
    };
  }
}

