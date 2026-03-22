import { describe, expect, it } from "vitest";
import {
  getPositionsRouteCounters,
  recordPositionHistoryFallbackEmpty,
  recordPositionNotFound,
  recordPositionsInvalidWalletParam,
  recordPositionStrategyCacheHit,
  recordPositionStrategyCacheMiss
} from "../src/services/observability/positions-observability";

describe("positions observability counters", () => {
  it("increments counters when record functions are called", () => {
    const before = getPositionsRouteCounters();

    recordPositionsInvalidWalletParam();
    recordPositionNotFound();
    recordPositionStrategyCacheHit();
    recordPositionStrategyMissSafe();
    recordPositionHistoryFallbackEmpty();

    const after = getPositionsRouteCounters();
    expect(after.invalidWalletParamCount).toBe(before.invalidWalletParamCount + 1);
    expect(after.positionNotFoundCount).toBe(before.positionNotFoundCount + 1);
    expect(after.strategyCacheHitCount).toBe(before.strategyCacheHitCount + 1);
    expect(after.strategyCacheMissCount).toBe(before.strategyCacheMissCount + 1);
    expect(after.historyFallbackEmptyCount).toBe(before.historyFallbackEmptyCount + 1);
  });
});

function recordPositionStrategyMissSafe() {
  recordPositionStrategyCacheMiss();
}
