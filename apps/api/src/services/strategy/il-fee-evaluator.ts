/**
 * IL vs Fee Evaluator
 * fee > IL → 継続 / fee < IL → リバランス or 撤退検討
 */

export type IlFeeVerdict = "CONTINUE" | "REBALANCE_CONSIDER" | "EXIT_CONSIDER";

export interface IlFeeEvaluationInput {
  estimatedImpermanentLossUsd: number | null;
  estimatedUncollectedFeesUsd: number | null;
  /** 累積収集済み手数料（USD） */
  cumulativeCollectedFeesUsd?: number;
  /** ポジション価値（USD） */
  positionValueUsd?: number | null;
}

export interface IlFeeEvaluationResult {
  verdict: IlFeeVerdict;
  feeVsIlRatio: number | null;
  netFeesOverIl: number | null;
  rationale: string;
  shouldConsiderRebalance: boolean;
  shouldConsiderExit: boolean;
}

/**
 * IL と手数料を比較し、継続 / リバランス / 撤退 を判定
 */
export function evaluateIlVsFees(input: IlFeeEvaluationInput): IlFeeEvaluationResult {
  const ilUsd = input.estimatedImpermanentLossUsd ?? 0;
  const feesUsd = (input.estimatedUncollectedFeesUsd ?? 0) + (input.cumulativeCollectedFeesUsd ?? 0);

  if (ilUsd <= 0 && feesUsd >= 0) {
    return {
      verdict: "CONTINUE",
      feeVsIlRatio: ilUsd === 0 ? (feesUsd > 0 ? 999 : 1) : null,
      netFeesOverIl: feesUsd,
      rationale: "No IL or IL is zero; fees positive. Continue.",
      shouldConsiderRebalance: false,
      shouldConsiderExit: false
    };
  }

  if (ilUsd <= 0) {
    return {
      verdict: "CONTINUE",
      feeVsIlRatio: 1,
      netFeesOverIl: feesUsd,
      rationale: "No IL. Continue.",
      shouldConsiderRebalance: false,
      shouldConsiderExit: false
    };
  }

  const netFeesOverIl = feesUsd - ilUsd;
  const feeVsIlRatio = feesUsd / ilUsd;

  if (feeVsIlRatio >= 1.2) {
    return {
      verdict: "CONTINUE",
      feeVsIlRatio,
      netFeesOverIl,
      rationale: `Fees ($${feesUsd.toFixed(2)}) exceed IL ($${ilUsd.toFixed(2)}); ratio ${feeVsIlRatio.toFixed(2)}. Continue.`,
      shouldConsiderRebalance: false,
      shouldConsiderExit: false
    };
  }

  if (feeVsIlRatio >= 0.8) {
    return {
      verdict: "REBALANCE_CONSIDER",
      feeVsIlRatio,
      netFeesOverIl,
      rationale: `Fees ~IL (ratio ${feeVsIlRatio.toFixed(2)}). Consider rebalancing to improve.`,
      shouldConsiderRebalance: true,
      shouldConsiderExit: false
    };
  }

  if (feeVsIlRatio >= 0.5) {
    return {
      verdict: "REBALANCE_CONSIDER",
      feeVsIlRatio,
      netFeesOverIl,
      rationale: `IL exceeds fees (ratio ${feeVsIlRatio.toFixed(2)}). Rebalance to narrow range or exit.`,
      shouldConsiderRebalance: true,
      shouldConsiderExit: true
    };
  }

  return {
    verdict: "EXIT_CONSIDER",
    feeVsIlRatio,
    netFeesOverIl,
    rationale: `IL significantly exceeds fees (ratio ${feeVsIlRatio.toFixed(2)}). Consider exit.`,
    shouldConsiderRebalance: true,
    shouldConsiderExit: true
  };
}
