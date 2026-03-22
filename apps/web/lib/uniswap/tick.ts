const MIN_TICK = -887272;
const MAX_TICK = 887272;
const Q96 = 2n ** 96n;

export function nearestUsableTick(tick: number, tickSpacing: number): number {
  if (tickSpacing <= 0) throw new Error("tickSpacing must be positive");
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  return clampTick(rounded);
}

export function floorToUsableTick(tick: number, tickSpacing: number): number {
  if (tickSpacing <= 0) throw new Error("tickSpacing must be positive");
  const floored = Math.floor(tick / tickSpacing) * tickSpacing;
  return clampTick(floored);
}

export function ceilToUsableTick(tick: number, tickSpacing: number): number {
  if (tickSpacing <= 0) throw new Error("tickSpacing must be positive");
  const ceiled = Math.ceil(tick / tickSpacing) * tickSpacing;
  return clampTick(ceiled);
}

// Approximation only: suitable for display/preview, not final production settlement math.
export function displayPriceToApproxTick(price: number): number {
  if (price <= 0) throw new Error("price must be positive");
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

// Approximation only: suitable for display/preview, not final production settlement math.
export function displayTickToApproxPrice(tick: number): number {
  return Number((1.0001 ** tick).toFixed(8));
}

export interface OperationalPriceToTickInput {
  price: string;
  token0Decimals: number;
  token1Decimals: number;
  quoteToken: "token0" | "token1";
  tickSpacing: number;
}

export interface OperationalTickToPriceInput {
  tick: number;
  token0Decimals: number;
  token1Decimals: number;
  quoteToken: "token0" | "token1";
}

export interface OperationalConversionResult {
  tick: number;
  price: string;
  sqrtPriceX96: string;
}

export function operationalPriceToTick(input: OperationalPriceToTickInput): OperationalConversionResult {
  validateDecimals(input.token0Decimals, input.token1Decimals);
  if (input.tickSpacing <= 0) throw new Error("tickSpacing must be positive");
  const parsed = Number(input.price);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("price must be a positive number string");
  }

  const canonicalPrice = input.quoteToken === "token1" ? parsed : 1 / parsed;
  const rawRatio = canonicalPrice * 10 ** (input.token1Decimals - input.token0Decimals);
  if (!Number.isFinite(rawRatio) || rawRatio <= 0) {
    throw new Error("failed to compute raw ratio");
  }

  const rawTick = Math.floor(Math.log(rawRatio) / Math.log(1.0001));
  const tick = nearestUsableTick(rawTick, input.tickSpacing);
  const price = operationalTickToPrice({
    tick,
    token0Decimals: input.token0Decimals,
    token1Decimals: input.token1Decimals,
    quoteToken: input.quoteToken
  }).price;

  const sqrtPriceX96 = approxTickToSqrtPriceX96(tick);
  return {
    tick,
    price,
    sqrtPriceX96
  };
}

export function operationalTickToPrice(input: OperationalTickToPriceInput): OperationalConversionResult {
  validateDecimals(input.token0Decimals, input.token1Decimals);
  const canonicalPrice =
    1.0001 ** input.tick * 10 ** (input.token0Decimals - input.token1Decimals);
  const displayPrice = input.quoteToken === "token1" ? canonicalPrice : 1 / canonicalPrice;
  if (!Number.isFinite(displayPrice) || displayPrice <= 0) {
    throw new Error("failed to compute display price");
  }
  return {
    tick: input.tick,
    price: formatDeterministicDecimal(displayPrice),
    sqrtPriceX96: approxTickToSqrtPriceX96(input.tick)
  };
}

function approxTickToSqrtPriceX96(tick: number): string {
  const sqrtRatio = Math.sqrt(1.0001 ** tick);
  if (!Number.isFinite(sqrtRatio) || sqrtRatio <= 0) {
    throw new Error("failed to compute sqrt ratio");
  }
  const q96Number = Number(Q96);
  const scaled = BigInt(Math.floor(sqrtRatio * q96Number));
  return scaled.toString();
}

function validateDecimals(token0Decimals: number, token1Decimals: number) {
  if (token0Decimals < 0 || token1Decimals < 0) {
    throw new Error("token decimals must be >= 0");
  }
}

function formatDeterministicDecimal(value: number): string {
  const fixed = value.toFixed(12);
  return fixed.replace(/\.?0+$/, "");
}

function clampTick(tick: number): number {
  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
}
