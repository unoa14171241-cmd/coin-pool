/**
 * Pair Classifier: VOLATILE vs STABLE
 * 安定系 vs 変動系の戦略分岐のためのペア分類
 */

import type { PairClassification } from "./types";

export type { PairClassification };

/** 安定系トークン（ステーブルコイン等） */
const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "BUSD",
  "FRAX",
  "TUSD",
  "USDP",
  "GUSD",
  "LUSD",
  "sUSD",
  "cUSD"
]);

/** 高相関・変動系ペア（ETH/BTC 等）。シンボルは正規化済み（W 除去）で比較 */
const VOLATILE_PAIR_PATTERNS: Array<{ tokens: [string, string]; correlationHint: number }> = [
  { tokens: ["ETH", "ETH"], correlationHint: 1 },
  { tokens: ["BTC", "BTC"], correlationHint: 1 },
  { tokens: ["ETH", "BTC"], correlationHint: 0.85 }
];

export interface PairClassifierInput {
  token0Symbol: string;
  token1Symbol: string;
  /** オプション: 過去価格データから算出した相関係数 (0-1) */
  correlationOverride?: number | null;
}

export interface PairClassificationResult {
  classification: PairClassification;
  correlationHint: number;
  rationale: string;
}

/**
 * ペアを VOLATILE / STABLE に分類
 * - 両方安定系 → STABLE（手数料最大化、レンジ狭め）
 * - 片方以上変動系 → VOLATILE（キャピタルゲイン考慮、レンジ広め）
 */
export function classifyPair(input: PairClassifierInput): PairClassificationResult {
  const s0 = (input.token0Symbol ?? "").toUpperCase().replace(/^W/, "");
  const s1 = (input.token1Symbol ?? "").toUpperCase().replace(/^W/, "");
  const isStable0 = STABLE_SYMBOLS.has(s0);
  const isStable1 = STABLE_SYMBOLS.has(s1);

  if (input.correlationOverride != null && Number.isFinite(input.correlationOverride)) {
    const corr = Math.max(0, Math.min(1, input.correlationOverride));
    const classification: PairClassification = corr >= 0.7 ? "VOLATILE" : isStable0 && isStable1 ? "STABLE" : "VOLATILE";
    return {
      classification,
      correlationHint: corr,
      rationale: `Correlation override ${corr.toFixed(2)} → ${classification}`
    };
  }

  if (isStable0 && isStable1) {
    return {
      classification: "STABLE",
      correlationHint: 0.99,
      rationale: "Both tokens are stablecoins; fee-maximization strategy."
    };
  }

  const volatileMatch = VOLATILE_PAIR_PATTERNS.find(
    (p) =>
      (p.tokens[0] === s0 && p.tokens[1] === s1) ||
      (p.tokens[0] === s1 && p.tokens[1] === s0)
  );
  if (volatileMatch) {
    return {
      classification: "VOLATILE",
      correlationHint: volatileMatch.correlationHint,
      rationale: `High-correlation pair (${s0}/${s1}); capital-gain aware strategy.`
    };
  }

  if (isStable0 || isStable1) {
    return {
      classification: "VOLATILE",
      correlationHint: 0.5,
      rationale: "Volatile/stable mix; standard LP strategy with IL consideration."
    };
  }

  return {
    classification: "VOLATILE",
    correlationHint: 0.5,
    rationale: "Both tokens are volatile; wider range and IL-aware strategy."
  };
}
