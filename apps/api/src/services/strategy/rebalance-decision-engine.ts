import { STRATEGY_MODE_CONFIG } from "./types";
import type { RebalanceDecision, RebalanceDecisionInput } from "./types";

export interface RebalanceDecisionEngine {
  decide(input: RebalanceDecisionInput): RebalanceDecision;
}

export class RuleBasedRebalanceDecisionEngine implements RebalanceDecisionEngine {
  decide(input: RebalanceDecisionInput): RebalanceDecision {
    const cfg = STRATEGY_MODE_CONFIG[input.mode];
    const reasonCodes: string[] = [];
    const explanationLines: string[] = [];

    const outOfRange = input.currentTick < input.currentTickLower || input.currentTick >= input.currentTickUpper;
    const distanceTicks = outOfRange
      ? input.currentTick < input.currentTickLower
        ? input.currentTickLower - input.currentTick
        : input.currentTick - input.currentTickUpper
      : 0;
    const severeOutOfRange = distanceTicks > 2 * Math.max(1, Math.round((input.proposed.suggestedTickUpper - input.proposed.suggestedTickLower) * 0.1));

    const expectedBenefitUsd = Number((Math.max(0, input.expectedFeeOpportunityUsd) + Math.max(0, input.currentUncollectedFeesUsd * 0.05)).toFixed(2));
    const netExpectedBenefitUsd = Number((expectedBenefitUsd - input.estimatedGasCostUsd).toFixed(2));

    if (input.cooldownRemainingMs > 0 && !severeOutOfRange) {
      reasonCodes.push("COOLDOWN_ACTIVE");
      explanationLines.push("Cooldown window is active and range deviation is not severe.");
    }
    if (!outOfRange && input.market.marketState === "RANGE") {
      reasonCodes.push("IN_RANGE_NO_EDGE");
      explanationLines.push("Position remains in range under range-bound market state.");
    }
    if (netExpectedBenefitUsd <= 0) {
      reasonCodes.push("NEGATIVE_NET_BENEFIT");
      explanationLines.push("Expected net benefit is negative after gas.");
    } else if (netExpectedBenefitUsd < cfg.minimumNetBenefitUsd) {
      reasonCodes.push("NET_BENEFIT_TOO_SMALL");
      explanationLines.push(`Expected net benefit is below ${cfg.minimumNetBenefitUsd} USD threshold.`);
    }
    if (input.estimatedGasCostUsd > expectedBenefitUsd) {
      reasonCodes.push("GAS_EXCEEDS_BENEFIT");
      explanationLines.push("Estimated gas cost exceeds expected fee opportunity.");
    }

    const ilFee = input.ilFeeEvaluation;
    const ilFeeSuggestsRebalance = ilFee?.shouldConsiderRebalance ?? false;
    const ilFeeSuggestsExit = ilFee?.shouldConsiderExit ?? false;
    if (ilFeeSuggestsRebalance && !reasonCodes.includes("IL_EXCEEDS_FEES")) {
      reasonCodes.push("IL_EXCEEDS_FEES");
      explanationLines.push("IL vs fee evaluation suggests rebalancing or exit consideration.");
    }

    const shouldRebalance = severeOutOfRange
      ? netExpectedBenefitUsd > 0
      : ilFeeSuggestsExit && outOfRange
        ? netExpectedBenefitUsd > 0
        : reasonCodes.length === 0 ||
          (outOfRange && netExpectedBenefitUsd > cfg.minimumNetBenefitUsd && !reasonCodes.includes("COOLDOWN_ACTIVE")) ||
          (ilFeeSuggestsRebalance && outOfRange && netExpectedBenefitUsd > cfg.minimumNetBenefitUsd * 0.5);

    const urgency = severeOutOfRange
      ? "HIGH"
      : ilFeeSuggestsExit && outOfRange
        ? "HIGH"
        : outOfRange && netExpectedBenefitUsd > cfg.minimumNetBenefitUsd
          ? "MEDIUM"
          : "LOW";

    if (shouldRebalance) {
      reasonCodes.push(outOfRange ? "OUT_OF_RANGE" : ilFeeSuggestsRebalance ? "IL_FEE_REBALANCE" : "STRATEGIC_REALIGN");
      explanationLines.push("Rebalance accepted by strategy policy.");
    }

    return {
      shouldRebalance,
      urgency,
      reasonCodes,
      expectedBenefitUsd,
      estimatedGasCostUsd: Number(input.estimatedGasCostUsd.toFixed(2)),
      netExpectedBenefitUsd,
      explanationLines
    };
  }
}
