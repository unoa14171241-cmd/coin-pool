import { describe, expect, it } from "vitest";
import { calculateRangeFromPercent } from "../lib/range";

describe("calculateRangeFromPercent", () => {
  it("calculates +/-10% range", () => {
    const result = calculateRangeFromPercent(3000, 10);
    expect(result.lowerPrice).toBe(2700);
    expect(result.upperPrice).toBe(3300);
  });
});
