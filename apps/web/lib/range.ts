export interface RangeResult {
  lowerPrice: number;
  upperPrice: number;
}

export function calculateRangeFromPercent(centerPrice: number, percent: number): RangeResult {
  if (centerPrice <= 0) {
    throw new Error("centerPrice must be positive");
  }
  if (percent < 0) {
    throw new Error("percent must be >= 0");
  }

  const ratio = percent / 100;
  return {
    lowerPrice: Number((centerPrice * (1 - ratio)).toFixed(6)),
    upperPrice: Number((centerPrice * (1 + ratio)).toFixed(6))
  };
}
