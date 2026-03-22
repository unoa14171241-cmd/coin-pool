import type { PositionAnalyticsResult } from "./position-analytics";

export interface WalletDashboardAggregation {
  totalPositions: number;
  inRange: number;
  outOfRange: number;
  totalEstimatedValueUsd: number;
  totalEstimatedFeesUsd: number;
  totalEstimatedPnlUsd: number;
  totalEstimatedImpermanentLossUsd: number;
  averageEstimatedApr: number | null;
  stalePositionsCount: number;
}

export function aggregateWalletDashboard(rows: PositionAnalyticsResult[]): WalletDashboardAggregation {
  const totalPositions = rows.length;
  const inRange = rows.filter((row) => row.live.currentTick >= row.saved.tickLower && row.live.currentTick < row.saved.tickUpper).length;
  const outOfRange = totalPositions - inRange;
  const totalEstimatedValueUsd = sum(rows.map((row) => row.analytics.estimatedPositionValueUsd));
  const totalEstimatedFeesUsd = sum(rows.map((row) => row.analytics.feeState.estimatedUncollectedFeesUsd));
  const totalEstimatedPnlUsd = sum(rows.map((row) => row.analytics.estimatedPnlUsd));
  const totalEstimatedImpermanentLossUsd = sum(rows.map((row) => row.analytics.estimatedImpermanentLossUsd));
  const aprValues = rows.map((row) => row.analytics.estimatedApr).filter((value): value is number => value != null);
  const averageEstimatedApr = aprValues.length > 0 ? Number((aprValues.reduce((acc, value) => acc + value, 0) / aprValues.length).toFixed(2)) : null;
  const stalePositionsCount = rows.filter((row) => row.live.stale).length;

  return {
    totalPositions,
    inRange,
    outOfRange,
    totalEstimatedValueUsd,
    totalEstimatedFeesUsd,
    totalEstimatedPnlUsd,
    totalEstimatedImpermanentLossUsd,
    averageEstimatedApr,
    stalePositionsCount
  };
}

function sum(values: Array<number | null>): number {
  return Number(
    values
      .filter((v): v is number => v != null)
      .reduce((acc, value) => acc + value, 0)
      .toFixed(2)
  );
}

