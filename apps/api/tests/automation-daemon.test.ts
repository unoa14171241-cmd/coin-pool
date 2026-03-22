import { describe, expect, it } from "vitest";
import {
  cleanupAutomationDaemonTicks,
  getAutomationDaemonRecentTicks,
  getAutomationDaemonRecentTicksDurable,
  getAutomationDaemonState,
  startAutomationDaemon,
  stopAutomationDaemon
} from "../src/services/automation-daemon";

describe("automation daemon", () => {
  it("can be configured disabled", () => {
    startAutomationDaemon({
      enabled: false,
      intervalMs: 10_000,
      maxWalletsPerTick: 10,
      maxJobsPerWallet: 5,
      retryFailedLimit: 0
    });
    const state = getAutomationDaemonState();
    expect(state.enabled).toBe(false);
    expect(state.running).toBe(false);
    stopAutomationDaemon();
  });

  it("exposes recent tick list accessor", () => {
    const ticks = getAutomationDaemonRecentTicks(5);
    expect(Array.isArray(ticks)).toBe(true);
  });

  it("exposes durable tick list accessor", async () => {
    const ticks = await getAutomationDaemonRecentTicksDurable(5);
    expect(Array.isArray(ticks)).toBe(true);
  });

  it("runs cleanup accessor safely", async () => {
    const out = await cleanupAutomationDaemonTicks({ retentionDays: 1, limit: 100 });
    expect(typeof out.deleted).toBe("number");
    expect(out.retentionDays).toBe(1);
  });
});
