export type RiskEngineInput = {
  volatilityScore?: number | null;
  oracleDeviationBps?: number | null;
  poolLiquidityUsd?: number | null;
  estimatedGasUsd?: number | null;
};

export type RiskEngineDecision = {
  allow: boolean;
  triggeredRules: string[];
};

const EXTREME_VOLATILITY_THRESHOLD = 0.9;
const ORACLE_DEVIATION_BPS_THRESHOLD = 250;
const MIN_POOL_LIQUIDITY_USD = 50_000;
const EXTREME_GAS_USD = 80;

export function evaluateAutomationRisk(input: RiskEngineInput): RiskEngineDecision {
  const triggeredRules: string[] = [];
  if ((input.volatilityScore ?? 0) >= EXTREME_VOLATILITY_THRESHOLD) {
    triggeredRules.push("extreme_volatility");
  }
  if ((input.oracleDeviationBps ?? 0) >= ORACLE_DEVIATION_BPS_THRESHOLD) {
    triggeredRules.push("oracle_deviation");
  }
  if (input.poolLiquidityUsd != null && input.poolLiquidityUsd > 0 && input.poolLiquidityUsd < MIN_POOL_LIQUIDITY_USD) {
    triggeredRules.push("pool_liquidity_collapse");
  }
  if ((input.estimatedGasUsd ?? 0) >= EXTREME_GAS_USD) {
    triggeredRules.push("gas_spike");
  }
  return {
    allow: triggeredRules.length === 0,
    triggeredRules
  };
}
