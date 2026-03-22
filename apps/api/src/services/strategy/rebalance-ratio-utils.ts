/**
 * 50:50 rebalance utilities.
 *
 * When rebalancing a Uniswap V3 position, we aim for equal value (50% token0 / 50% token1)
 * by centering the new range around the current price. At the current price, liquidity
 * in a concentrated range is approximately balanced in value.
 *
 * This module provides explicit helpers for the 50:50 rebalance logic.
 */

/**
 * Target ratio for rebalance: 50% token0 value, 50% token1 value.
 */
export const TARGET_RATIO_50_50 = { token0Share: 0.5, token1Share: 0.5 } as const;

/**
 * Checks if the proposed center price achieves approximately 50:50 value ratio
 * when adding liquidity at the current price.
 *
 * When centerPrice === currentPrice, the new position will have roughly equal
 * value in both tokens (assuming symmetric range around center).
 *
 * @param centerPrice - Proposed center of the new range
 * @param currentPrice - Current pool price (token1 per token0)
 * @param toleranceBps - Allowed deviation in bps (default 500 = 5%)
 * @returns true if center is close enough to current for ~50:50
 */
export function isCenterPriceSuitableFor50_50(
  centerPrice: number,
  currentPrice: number,
  toleranceBps = 500
): boolean {
  if (!Number.isFinite(centerPrice) || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return false;
  }
  const ratio = centerPrice / currentPrice;
  const deviationBps = Math.abs(ratio - 1) * 10_000;
  return deviationBps <= toleranceBps;
}

/**
 * Suggests a center price for 50:50 rebalance.
 * Uses current price as the target so that the new range is centered
 * and liquidity will be approximately 50/50 by value.
 *
 * @param currentPrice - Current pool price
 * @param optionalBias - Optional small bias (e.g. 0.01 for 1% up)
 * @returns Suggested center price for equal-weight rebalance
 */
export function calculateOptimalCenterFor50_50(
  currentPrice: number,
  optionalBias = 0
): number {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return 0;
  }
  return currentPrice * (1 + optionalBias);
}

/**
 * Rebalance-to-equal-weight: ensures the proposed range centers around current price
 * so that the reminted position has ~50% token0 and ~50% token1 by value.
 *
 * If the proposed center deviates too much from current price, returns the
 * adjusted center (current price) to achieve 50:50.
 *
 * @param proposedCenterPrice - Center from range proposal
 * @param currentPrice - Current pool price
 * @param maxDeviationBps - Max allowed deviation before forcing current price (default 1000 = 10%)
 * @returns Center price suitable for 50:50 rebalance
 */
export function rebalanceToEqualWeight(
  proposedCenterPrice: number | null,
  currentPrice: number,
  maxDeviationBps = 1000
): number | null {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (proposedCenterPrice == null || !Number.isFinite(proposedCenterPrice)) {
    return currentPrice;
  }
  const ratio = proposedCenterPrice / currentPrice;
  const deviationBps = Math.abs(ratio - 1) * 10_000;
  if (deviationBps > maxDeviationBps) {
    return currentPrice;
  }
  return proposedCenterPrice;
}
