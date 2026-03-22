export interface IlEstimationInput {
  referencePrice: number | null;
  currentPrice: number | null;
  currentPositionValueUsd: number | null;
}

export interface IlEstimationResult {
  estimatedImpermanentLossUsd: number | null;
  estimatedImpermanentLossPercent: number | null;
  note?: string;
}

export function estimateImpermanentLossFromPriceRatio(input: IlEstimationInput): IlEstimationResult {
  if (
    input.referencePrice == null ||
    input.currentPrice == null ||
    input.currentPositionValueUsd == null ||
    input.referencePrice <= 0 ||
    input.currentPrice <= 0 ||
    input.currentPositionValueUsd <= 0
  ) {
    return {
      estimatedImpermanentLossUsd: null,
      estimatedImpermanentLossPercent: null,
      note: "Reference/current price or position value unavailable for IL estimation."
    };
  }

  const ratio = input.currentPrice / input.referencePrice;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return {
      estimatedImpermanentLossUsd: null,
      estimatedImpermanentLossPercent: null,
      note: "Invalid price ratio for IL estimation."
    };
  }

  // Constant product 50/50 benchmark approximation:
  // IL% = 1 - (2 * sqrt(r) / (1 + r))
  const holdVsLpGap = 1 - (2 * Math.sqrt(ratio)) / (1 + ratio);
  const ilPercent = Math.max(0, holdVsLpGap * 100);
  const ilUsd = input.currentPositionValueUsd * (ilPercent / 100);

  return {
    estimatedImpermanentLossUsd: Number(ilUsd.toFixed(2)),
    estimatedImpermanentLossPercent: Number(ilPercent.toFixed(4))
  };
}
