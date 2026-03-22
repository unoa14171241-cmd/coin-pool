import { describe, expect, it } from "vitest";
import {
  getAuthorizationCounters,
  recordAutomationAuthorizationDenied,
  recordSyncAuthorizationDenied
} from "../src/services/observability/authorization-observability";

describe("authorization observability counters", () => {
  it("increments sync/automation deny counters", () => {
    const before = getAuthorizationCounters();
    recordSyncAuthorizationDenied();
    recordAutomationAuthorizationDenied();
    const after = getAuthorizationCounters();
    expect(after.syncAuthorizationDeniedCount).toBe(before.syncAuthorizationDeniedCount + 1);
    expect(after.automationAuthorizationDeniedCount).toBe(before.automationAuthorizationDeniedCount + 1);
  });
});
