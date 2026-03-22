const Q96 = 2n ** 96n;

export function tickToSqrtRatioX96(tick: number): bigint {
  const ratio = Math.sqrt(1.0001 ** tick);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error("Invalid tick for sqrt ratio conversion");
  }
  return BigInt(Math.floor(ratio * Number(Q96)));
}

export function getAmountsForLiquidity(input: {
  sqrtRatioX96: bigint;
  sqrtRatioAX96: bigint;
  sqrtRatioBX96: bigint;
  liquidity: bigint;
}): { amount0: bigint; amount1: bigint } {
  let sqrtA = input.sqrtRatioAX96;
  let sqrtB = input.sqrtRatioBX96;
  if (sqrtA > sqrtB) {
    const tmp = sqrtA;
    sqrtA = sqrtB;
    sqrtB = tmp;
  }

  if (input.sqrtRatioX96 <= sqrtA) {
    // Entire position in token0 when current price is below range.
    const amount0 = mulDiv(input.liquidity << 96n, sqrtB - sqrtA, sqrtA * sqrtB);
    return { amount0, amount1: 0n };
  }
  if (input.sqrtRatioX96 < sqrtB) {
    // Mixed token0/token1 when current price is inside range.
    const amount0 = mulDiv(input.liquidity << 96n, sqrtB - input.sqrtRatioX96, input.sqrtRatioX96 * sqrtB);
    const amount1 = mulDiv(input.liquidity, input.sqrtRatioX96 - sqrtA, Q96);
    return { amount0, amount1 };
  }
  // Entire position in token1 when current price is above range.
  const amount1 = mulDiv(input.liquidity, sqrtB - sqrtA, Q96);
  return { amount0: 0n, amount1 };
}

export function getTokenAmountsForPosition(input: {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}): { amount0: bigint; amount1: bigint } {
  const sqrtCurrent = tickToSqrtRatioX96(input.currentTick);
  const sqrtLower = tickToSqrtRatioX96(input.tickLower);
  const sqrtUpper = tickToSqrtRatioX96(input.tickUpper);
  return getAmountsForLiquidity({
    sqrtRatioX96: sqrtCurrent,
    sqrtRatioAX96: sqrtLower,
    sqrtRatioBX96: sqrtUpper,
    liquidity: input.liquidity
  });
}

function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero in mulDiv");
  return (a * b) / denominator;
}

