export function movingAverage(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  const out: number[] = [];
  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += values[j];
    out.push(sum / period);
  }
  return out;
}

export function rollingVolatility(values: number[], lookback = 20): number {
  if (values.length < 3) return 0;
  const start = Math.max(1, values.length - lookback);
  const returns: number[] = [];
  for (let i = start; i < values.length; i += 1) {
    const prev = values[i - 1];
    const cur = values[i];
    if (prev <= 0 || cur <= 0) continue;
    returns.push(Math.log(cur / prev));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

export function priceDrift(values: number[], lookback = 20): number {
  if (values.length < 2) return 0;
  const start = Math.max(0, values.length - lookback);
  const head = values[start];
  const tail = values[values.length - 1];
  if (head <= 0) return 0;
  return (tail - head) / head;
}

export function simpleTrendScore(values: number[], fast = 5, slow = 20): number {
  if (values.length < slow) return 0;
  const fastMa = movingAverage(values, fast);
  const slowMa = movingAverage(values, slow);
  const fastLast = fastMa[fastMa.length - 1];
  const slowLast = slowMa[slowMa.length - 1];
  if (fastLast == null || slowLast == null || slowLast === 0) return 0;
  return (fastLast - slowLast) / slowLast;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
