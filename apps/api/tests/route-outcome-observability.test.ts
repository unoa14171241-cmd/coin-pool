import { describe, expect, it } from "vitest";
import { getRouteOutcomeSummary, recordRouteOutcome } from "../src/services/observability/route-outcome-observability";

describe("route outcome observability", () => {
  it("tracks per-status families and error rate", () => {
    const routeKey = "GET /test-route";
    const before = getRouteOutcomeSummary(routeKey);
    recordRouteOutcome(routeKey, 200);
    recordRouteOutcome(routeKey, 404);
    recordRouteOutcome(routeKey, 500);
    const after = getRouteOutcomeSummary(routeKey);

    expect(after.total).toBe(before.total + 3);
    expect(after.success2xx).toBe(before.success2xx + 1);
    expect(after.client4xx).toBe(before.client4xx + 1);
    expect(after.server5xx).toBe(before.server5xx + 1);
    expect(after.errorRate).toBeGreaterThan(0);
  });
});
