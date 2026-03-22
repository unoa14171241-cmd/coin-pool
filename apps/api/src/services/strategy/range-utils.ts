/** Converts a price (token1 per token0) to Uniswap V3 tick. */
export function tickFromPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(Math.log(price) / Math.log(1.0001));
}

const TICK_SPACING_BY_FEE_TIER: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200
};

const MIN_TICK = -887272;
const MAX_TICK = 887272;

export function tickSpacingForFeeTier(feeTier: number): number | null {
  return TICK_SPACING_BY_FEE_TIER[feeTier] ?? null;
}

export function floorToUsableTick(tick: number, tickSpacing: number): number {
  const floored = Math.floor(tick / tickSpacing) * tickSpacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, floored));
}

export function ceilToUsableTick(tick: number, tickSpacing: number): number {
  const ceiled = Math.ceil(tick / tickSpacing) * tickSpacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, ceiled));
}

export function normalizeProposedRange(input: {
  tickLower: number;
  tickUpper: number;
  feeTier: number;
}): { tickLower: number; tickUpper: number; tickSpacing: number } {
  const spacing = tickSpacingForFeeTier(input.feeTier);
  if (!spacing) throw new Error(`Unsupported fee tier for strategy engine: ${input.feeTier}`);
  const lower = floorToUsableTick(input.tickLower, spacing);
  const upper = ceilToUsableTick(input.tickUpper, spacing);
  if (lower >= upper) throw new Error("Normalized strategy range is invalid (lower >= upper)");
  return { tickLower: lower, tickUpper: upper, tickSpacing: spacing };
}
