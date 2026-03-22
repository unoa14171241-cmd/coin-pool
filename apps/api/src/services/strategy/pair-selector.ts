/**
 * Pair Selector: 戦略モードに応じたペア選定
 * AGGRESSIVE / BALANCED / CONSERVATIVE ごとのペア選定ルール
 */

import { classifyPair } from "./pair-classifier";
import type { PairClassification } from "./types";
import type { StrategyMode } from "./types";

export interface PoolPairCandidate {
  poolAddress: `0x${string}`;
  chainId: number;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number;
  classification: PairClassification;
  correlationHint: number;
  /** 選定スコア（高いほど推奨） */
  score: number;
}

export interface PairSelectorInput {
  mode: StrategyMode;
  candidates: Array<{
    poolAddress: `0x${string}`;
    chainId: number;
    token0Symbol: string;
    token1Symbol: string;
    feeTier: number;
    /** オプション: 相関係数 */
    correlation?: number | null;
  }>;
}

/**
 * 戦略モードに応じてペアを選定
 * - CONSERVATIVE: 高相関ペア優先（ETH/BTC）、STABLE も許容
 * - BALANCED: バランス型
 * - AGGRESSIVE: 変動系でキャピタルゲイン狙い
 */
export function selectPairsByMode(input: PairSelectorInput): PoolPairCandidate[] {
  const scored = input.candidates.map((c) => {
    const { classification, correlationHint, rationale } = classifyPair({
      token0Symbol: c.token0Symbol,
      token1Symbol: c.token1Symbol,
      correlationOverride: c.correlation ?? null
    });

    let score = 50;
    if (input.mode === "CONSERVATIVE") {
      if (classification === "STABLE") score += 25;
      else if (correlationHint >= 0.8) score += 30;
      else if (correlationHint >= 0.6) score += 15;
    } else if (input.mode === "BALANCED") {
      if (classification === "STABLE") score += 15;
      else if (correlationHint >= 0.7) score += 20;
      score += 10;
    } else {
      if (classification === "VOLATILE" && correlationHint >= 0.6) score += 25;
      else if (classification === "VOLATILE") score += 15;
    }

    return {
      ...c,
      classification,
      correlationHint,
      score,
      _rationale: rationale
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map(({ _rationale, ...rest }) => rest);
}
