import type { EthereumAddress, PositionStatus } from "@/lib/types";
import type { StrategyMode, StrategyUrgency } from "@/lib/strategy/types";

export interface SavedState {
  positionId: string;
  chainId: number;
  walletAddress: EthereumAddress;
  poolAddress: EthereumAddress;
  token0Address: EthereumAddress;
  token1Address: EthereumAddress;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  savedStatus: PositionStatus;
  createdAt: string;
}

export interface LiveState {
  currentTick: number | null;
  currentPrice: number | null;
  snapshotUpdatedAt: string;
  source: "rpc" | "cache" | "fallback";
  stale: boolean;
}

export interface AnalyticsState {
  estimatedValueUsd: number | null;
  estimatedFeesUsd: number | null;
  estimatedPnlUsd: number | null;
  estimatedApr: number | null;
  estimatedRoi: number | null;
  estimatedImpermanentLossUsd: number | null;
  estimatedImpermanentLossPercent: number | null;
}

export interface StrategyState {
  marketState: "RANGE" | "UP_TREND" | "DOWN_TREND" | "HIGH_VOLATILITY" | "LOW_LIQUIDITY" | "UNKNOWN";
  strategyMode: StrategyMode;
  shouldRebalance: boolean;
  urgency: StrategyUrgency;
  proposedTickLower: number | null;
  proposedTickUpper: number | null;
  expectedGasCostUsd: number | null;
  expectedBenefitUsd: number | null;
  netExpectedBenefitUsd: number | null;
  confidence: number;
  explanationLines: string[];
}

export interface ExecutionState {
  approvals: Array<{
    token: EthereumAddress;
    spender: EthereumAddress;
    status: "PENDING" | "SUCCESS" | "FAILED";
    txHash?: string;
    errorMessage?: string;
  }>;
  txHashes: {
    create?: string;
    collect?: string;
    rebalance?: string;
  };
  executionResults: Array<{
    step: "CREATE" | "COLLECT" | "REBALANCE" | "APPROVE";
    success: boolean;
    txHash?: string;
    detail?: string;
  }>;
  failures: Array<{
    step: string;
    reason: string;
    at: string;
  }>;
}
