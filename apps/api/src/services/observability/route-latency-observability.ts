type LatencyBucket = {
  samples: number[];
  maxSamples: number;
};

const DEFAULT_MAX_SAMPLES = 500;
const routeBuckets = new Map<string, LatencyBucket>();

export function recordRouteLatency(routeKey: string, elapsedMs: number, maxSamples = DEFAULT_MAX_SAMPLES) {
  const safeMs = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
  const bucket = routeBuckets.get(routeKey) ?? { samples: [], maxSamples };
  bucket.samples.push(safeMs);
  if (bucket.samples.length > bucket.maxSamples) {
    bucket.samples.splice(0, bucket.samples.length - bucket.maxSamples);
  }
  routeBuckets.set(routeKey, bucket);
}

export function getRouteLatencySummary(routeKey: string): {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
} {
  const bucket = routeBuckets.get(routeKey);
  if (!bucket || bucket.samples.length === 0) {
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  }
  const sorted = [...bucket.samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null
  };
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1));
  const value = sorted[index];
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}
