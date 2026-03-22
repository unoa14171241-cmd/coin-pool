import { clamp } from "./market-math";
import { normalizeProposedRange, tickSpacingForFeeTier } from "./range-utils";
import { STRATEGY_MODE_CONFIG } from "./types";
import type { RangeProposal, RangeProposalInput } from "./types";

export interface RangeProposalEngine {
  propose(input: RangeProposalInput): RangeProposal;
}

export class RuleBasedRangeProposalEngine implements RangeProposalEngine {
  propose(input: RangeProposalInput): RangeProposal {
    const modeConfig = STRATEGY_MODE_CONFIG[input.mode];
    const spacing = tickSpacingForFeeTier(input.feeTier);
    if (!spacing) {
      throw new Error(`Unsupported fee tier for range proposal: ${input.feeTier}`);
    }

    const pairClass = input.pairClassification ?? "VOLATILE";
    const baseWidthByState: Record<RangeProposalInput["market"]["marketState"], number> = {
      RANGE: pairClass === "STABLE" ? 0.04 : 0.06,
      UP_TREND: pairClass === "STABLE" ? 0.05 : 0.08,
      DOWN_TREND: pairClass === "STABLE" ? 0.05 : 0.08,
      HIGH_VOLATILITY: pairClass === "STABLE" ? 0.08 : 0.14,
      LOW_LIQUIDITY: pairClass === "STABLE" ? 0.12 : 0.18,
      UNKNOWN: pairClass === "STABLE" ? 0.06 : 0.12
    };
    const biasByState: Record<RangeProposalInput["market"]["marketState"], number> = {
      RANGE: 0,
      UP_TREND: 0.012,
      DOWN_TREND: -0.012,
      HIGH_VOLATILITY: 0,
      LOW_LIQUIDITY: 0,
      UNKNOWN: 0
    };

    const volatilityFactor = 1 + input.market.volatility * modeConfig.volatilitySensitivity * 5;
    const widthPercent =
      baseWidthByState[input.market.marketState] *
      modeConfig.widthMultiplier *
      volatilityFactor;
    const clampedWidth = clamp(widthPercent, pairClass === "STABLE" ? 0.01 : 0.02, pairClass === "STABLE" ? 0.15 : 0.35);

    const baseCenterPrice = input.currentPrice ?? priceFromTick(input.currentTick);
    const centerBias = biasByState[input.market.marketState];
    const suggestedCenterPrice = baseCenterPrice > 0 ? baseCenterPrice * (1 + centerBias) : null;
    const half = clampedWidth / 2;
    const suggestedLowerPrice = suggestedCenterPrice ? suggestedCenterPrice * (1 - half) : null;
    const suggestedUpperPrice = suggestedCenterPrice ? suggestedCenterPrice * (1 + half) : null;

    const rawTickCenter = input.currentPrice ? tickFromPrice(suggestedCenterPrice ?? input.currentPrice) : input.currentTick;
    const rawHalfWidthTicks = Math.max(spacing * 2, Math.round((clampedWidth / 2) * 10_000 / Math.max(1, spacing)) * spacing);
    const normalized = normalizeProposedRange({
      tickLower: rawTickCenter - rawHalfWidthTicks,
      tickUpper: rawTickCenter + rawHalfWidthTicks,
      feeTier: input.feeTier
    });

    const confidence = clamp(input.market.confidence * (1 - Math.min(0.3, input.market.volatility)), 0.2, 0.95);
    const explanationLines = [
      `Market state ${input.market.marketState} drives width ${Number((clampedWidth * 100).toFixed(2))}%`,
      `Pair ${pairClass}: ${pairClass === "STABLE" ? "narrow range, fee-max" : "wider range, capital-gain aware"}`,
      `Volatility factor ${volatilityFactor.toFixed(2)} (high vol → wider)`,
      `Mode ${input.mode} applied width multiplier ${modeConfig.widthMultiplier}`,
      "Ticks are normalized by fee-tier tick spacing (lower=floor, upper=ceil)."
    ];

    return {
      suggestedCenterPrice,
      suggestedLowerPrice,
      suggestedUpperPrice,
      suggestedTickLower: normalized.tickLower,
      suggestedTickUpper: normalized.tickUpper,
      widthPercent: Number((clampedWidth * 100).toFixed(2)),
      confidence: Number(confidence.toFixed(3)),
      rationale: `Proposed ${input.market.marketState} range with ${input.mode.toLowerCase()} mode bias`,
      explanationLines
    };
  }
}

function tickFromPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(Math.log(price) / Math.log(1.0001));
}

function priceFromTick(tick: number): number {
  return 1.0001 ** tick;
}
