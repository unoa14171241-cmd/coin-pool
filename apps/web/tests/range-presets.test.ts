import { describe, expect, it } from "vitest";
import { RANGE_PRESETS } from "../lib/constants";

describe("range presets", () => {
  it("matches required preset widths", () => {
    const conservative = RANGE_PRESETS.find((v) => v.key === "Conservative");
    const balanced = RANGE_PRESETS.find((v) => v.key === "Balanced");
    const aggressive = RANGE_PRESETS.find((v) => v.key === "Aggressive");
    expect(conservative?.widthPercent).toBe(20);
    expect(balanced?.widthPercent).toBe(10);
    expect(aggressive?.widthPercent).toBe(5);
  });
});
