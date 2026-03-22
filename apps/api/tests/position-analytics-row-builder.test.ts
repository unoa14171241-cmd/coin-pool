import { describe, expect, it } from "vitest";
import { PositionAnalyticsRowBuilderService } from "../src/services/position-analytics-row-builder";

describe("PositionAnalyticsRowBuilderService", () => {
  it("returns empty result quickly for empty rows", async () => {
    const service = new PositionAnalyticsRowBuilderService();
    const out = await service.build([]);
    expect(out.rows).toEqual([]);
    expect(out.stats).toEqual({});
  });
});
