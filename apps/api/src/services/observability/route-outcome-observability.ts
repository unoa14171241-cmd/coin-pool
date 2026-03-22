type RouteOutcomeBucket = {
  total: number;
  success2xx: number;
  redirect3xx: number;
  client4xx: number;
  server5xx: number;
};

const routeOutcomeBuckets = new Map<string, RouteOutcomeBucket>();

export function recordRouteOutcome(routeKey: string, statusCode: number) {
  const bucket = routeOutcomeBuckets.get(routeKey) ?? {
    total: 0,
    success2xx: 0,
    redirect3xx: 0,
    client4xx: 0,
    server5xx: 0
  };
  bucket.total += 1;
  if (statusCode >= 200 && statusCode < 300) {
    bucket.success2xx += 1;
  } else if (statusCode >= 300 && statusCode < 400) {
    bucket.redirect3xx += 1;
  } else if (statusCode >= 400 && statusCode < 500) {
    bucket.client4xx += 1;
  } else if (statusCode >= 500) {
    bucket.server5xx += 1;
  }
  routeOutcomeBuckets.set(routeKey, bucket);
}

export function getRouteOutcomeSummary(routeKey: string): {
  total: number;
  success2xx: number;
  redirect3xx: number;
  client4xx: number;
  server5xx: number;
  errorRate: number;
} {
  const bucket = routeOutcomeBuckets.get(routeKey) ?? {
    total: 0,
    success2xx: 0,
    redirect3xx: 0,
    client4xx: 0,
    server5xx: 0
  };
  const errorCount = bucket.client4xx + bucket.server5xx;
  const errorRate = bucket.total > 0 ? Number((errorCount / bucket.total).toFixed(4)) : 0;
  return {
    ...bucket,
    errorRate
  };
}
