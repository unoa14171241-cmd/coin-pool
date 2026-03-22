export type AutomationGasPolicyInput = {
  estimatedGasUsd: number;
  maxGasUsd: number;
};

export type AutomationGasPolicyDecision = {
  ok: boolean;
  reason: string | null;
};

export function evaluateAutomationGasPolicy(input: AutomationGasPolicyInput): AutomationGasPolicyDecision {
  if (!Number.isFinite(input.estimatedGasUsd) || input.estimatedGasUsd < 0) {
    return { ok: false, reason: "invalid_estimated_gas" };
  }
  if (!Number.isFinite(input.maxGasUsd) || input.maxGasUsd <= 0) {
    return { ok: false, reason: "invalid_max_gas_limit" };
  }
  if (input.estimatedGasUsd > input.maxGasUsd) {
    return { ok: false, reason: "gas_threshold_exceeded" };
  }
  return { ok: true, reason: null };
}
