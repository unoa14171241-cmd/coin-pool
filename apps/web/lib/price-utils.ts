/**
 * Uniswap V3 tick to price conversion utilities.
 * Price = token1 per token0 (e.g. USDC per 1 WETH).
 */

/** Price point for chart time series */
export type PricePoint = {
  timestamp: string;
  price: number;
};

/**
 * Convert tick to price (token1 per token0) relative to a reference.
 * Uses Uniswap V3 formula: price = refPrice * 1.0001^(tick - refTick)
 */
export function tickToPriceFromReference(params: {
  tick: number;
  refTick: number;
  refPrice: number;
}): number {
  const { tick, refTick, refPrice } = params;
  if (refPrice <= 0 || !Number.isFinite(refPrice)) return 0;
  const exponent = tick - refTick;
  const ratio = Math.pow(1.0001, exponent);
  const price = refPrice * ratio;
  return Number.isFinite(price) ? price : 0;
}

/**
 * Compute min and max price from tick range, using current price as reference.
 */
export function getRangePrices(params: {
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  currentPrice: number | null;
}): { minPrice: number; maxPrice: number } | null {
  const { tickLower, tickUpper, currentTick, currentPrice } = params;
  if (currentPrice == null || currentPrice <= 0 || !Number.isFinite(currentPrice)) {
    return null;
  }
  const minPrice = tickToPriceFromReference({
    tick: tickLower,
    refTick: currentTick,
    refPrice: currentPrice
  });
  const maxPrice = tickToPriceFromReference({
    tick: tickUpper,
    refTick: currentTick,
    refPrice: currentPrice
  });
  return {
    minPrice: Math.min(minPrice, maxPrice),
    maxPrice: Math.max(minPrice, maxPrice)
  };
}

/** Format price for display (compact for chart labels) */
export function formatPriceCompact(price: number): string {
  if (price >= 1e6) return `${(price / 1e6).toFixed(2)}M`;
  if (price >= 1e3) return `${(price / 1e3).toFixed(2)}K`;
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

/** Format price for summary display */
export function formatPriceSummary(price: number): string {
  if (price >= 1e6) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}
