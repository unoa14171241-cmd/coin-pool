import { describe, expect, it } from "vitest";
import { evaluateAutomationGasPolicy } from "../src/services/automation-gas-policy";
import { evaluateAutomationRisk } from "../src/services/risk-engine";
import { calculateRevenueSplit, validateRevenuePolicy } from "../src/services/revenue-calculator";

describe("automation safety services", () => {
  it("evaluates gas policy threshold", () => {
    expect(evaluateAutomationGasPolicy({ estimatedGasUsd: 5, maxGasUsd: 10 }).ok).toBe(true);
    expect(evaluateAutomationGasPolicy({ estimatedGasUsd: 12, maxGasUsd: 10 }).ok).toBe(false);
  });

  it("evaluates risk circuit breaker rules", () => {
    const safe = evaluateAutomationRisk({ volatilityScore: 0.2, oracleDeviationBps: 20, poolLiquidityUsd: 100_000 });
    expect(safe.allow).toBe(true);
    const blocked = evaluateAutomationRisk({ volatilityScore: 0.95, oracleDeviationBps: 10, poolLiquidityUsd: 100_000 });
    expect(blocked.allow).toBe(false);
    expect(blocked.triggeredRules).toContain("extreme_volatility");
  });

  it("splits revenue by bps policy", () => {
    const policy = { ownerShareBps: 7000, operatorShareBps: 2000, platformShareBps: 1000 };
    expect(validateRevenuePolicy(policy)).toBe(true);
    const split = calculateRevenueSplit(100, policy);
    expect(split.ownerUsd).toBe(70);
    expect(split.operatorUsd).toBe(20);
    expect(split.platformUsd).toBe(10);
  });
});
