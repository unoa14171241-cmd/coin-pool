export interface AprInput {
  cumulativeFeesUsd: number;
  positionValueUsd: number;
  operatingDays: number;
}

export function calculateEstimatedApr(input: AprInput): number {
  const { cumulativeFeesUsd, positionValueUsd, operatingDays } = input;
  if (cumulativeFeesUsd <= 0 || positionValueUsd <= 0 || operatingDays <= 0) {
    return 0;
  }
  const apr = (cumulativeFeesUsd / positionValueUsd) * (365 / operatingDays) * 100;
  return Number(apr.toFixed(2));
}
