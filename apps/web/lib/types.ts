export type PositionStatus = "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
export type EthereumAddress = `0x${string}`;
export type ISO8601String = string; // ISO 8601 format string (e.g. 2026-03-10T12:34:56.000Z)

export interface PositionDomainModel {
  id: string;
  nftTokenId?: string;
  chainId: number;
  chainName: string;
  walletAddress: EthereumAddress;
  poolAddress: EthereumAddress;
  token0Address: EthereumAddress;
  token1Address: EthereumAddress;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  createdAt: ISO8601String; // ISO 8601
  savedStatus: PositionStatus;
  computedStatus: PositionStatus;
}

export interface PositionViewModel extends PositionDomainModel {
  currentPrice: number | null;
  currentTick: number;
  uncollectedFeesUsd: number;
  valueUsd: number;
  estimatedApr: number;
  sync?: {
    status: "NEVER" | "SUCCESS" | "PARTIAL" | "ERROR";
    lastAttemptAt: ISO8601String | null;
    lastSuccessAt: ISO8601String | null;
    error: string | null;
  };
  isPlaceholderMetrics: true;
  isPlaceholderValuation: true;
  isPlaceholderYieldMetrics: true;
}

export type LpPosition = PositionViewModel;

export interface DashboardMetrics {
  walletAddress: EthereumAddress;
  chainId: number;
  chainName: string;
  ethPrice: number | null;
  totalPositions: number;
  inRange: number;
  outOfRange: number;
  estimatedFeesEarned: number;
  estimatedApr: number;
  estimatedPositionPnlUsd: number; // Estimated position PnL in USD (not realized)
  totalValue: number;
}

export interface RangePreset {
  key: "Conservative" | "Balanced" | "Aggressive" | "Custom";
  widthPercent: number;
  description: string;
}
