import { describe, expect, it } from "vitest";
import { calculateEstimatedApr } from "../lib/apr";

describe("calculateEstimatedApr", () => {
  it("calculates APR using cumulative fees and operating days", () => {
    const apr = calculateEstimatedApr({
      cumulativeFeesUsd: 100,
      positionValueUsd: 2000,
      operatingDays: 10
    });
    expect(apr).toBe(182.5);
  });

  it("returns 0 when input is invalid", () => {
    const apr = calculateEstimatedApr({
      cumulativeFeesUsd: 0,
      positionValueUsd: 2000,
      operatingDays: 10
    });
    expect(apr).toBe(0);
  });
});
