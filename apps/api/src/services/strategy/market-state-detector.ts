import { clamp, priceDrift, rollingVolatility, simpleTrendScore } from "./market-math";
import type { MarketStateDetectionInput, MarketStateDetectionResult } from "./types";

export interface MarketStateDetector {
  detect(input: MarketStateDetectionInput): MarketStateDetectionResult;
}

export class RuleBasedMarketStateDetector implements MarketStateDetector {
  detect(input: MarketStateDetectionInput): MarketStateDetectionResult {
    const prices = input.recentSnapshots
      .map((item) => item.currentPrice)
      .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
    const tickSeries = input.recentSnapshots.map((item) => item.currentTick);
    const liquiditySamples = input.recentSnapshots
      .map((item) => (item.liquidity ? Number(item.liquidity) : NaN))
      .filter((v) => Number.isFinite(v) && v > 0);
    const volatility = prices.length >= 4 ? rollingVolatility(prices, 24) : rollingVolatility(tickSeries, 24);
    const trendScore = prices.length >= 8 ? simpleTrendScore(prices, 5, 8) : 0;
    const drift = prices.length >= 4 ? priceDrift(prices, 12) : 0;
    const medianLiquidity = liquiditySamples.length > 0 ? liquiditySamples.sort((a, b) => a - b)[Math.floor(liquiditySamples.length / 2)] : 0;

    let marketState: MarketStateDetectionResult["marketState"] = "UNKNOWN";
    const explanationLines: string[] = [];

    if (medianLiquidity > 0 && medianLiquidity < 1_000_000) {
      marketState = "LOW_LIQUIDITY";
      explanationLines.push("Pool liquidity proxy is low; execution risk may be elevated.");
    } else if (volatility > 0.02) {
      marketState = "HIGH_VOLATILITY";
      explanationLines.push("High realized volatility detected from recent snapshots.");
    } else if (trendScore > 0.005 && drift > 0.003) {
      marketState = "UP_TREND";
      explanationLines.push("Positive drift and moving-average momentum indicate uptrend.");
    } else if (trendScore < -0.005 && drift < -0.003) {
      marketState = "DOWN_TREND";
      explanationLines.push("Negative drift and moving-average momentum indicate downtrend.");
    } else if (prices.length >= 4 || tickSeries.length >= 6) {
      marketState = "RANGE";
      explanationLines.push("No strong directional signal; treating current regime as range-bound.");
    } else {
      explanationLines.push("Insufficient recent data; falling back to UNKNOWN state.");
    }

    const baseConfidence = prices.length >= 8 ? 0.8 : prices.length >= 4 ? 0.65 : 0.45;
    const confidence = clamp(
      baseConfidence - (marketState === "UNKNOWN" ? 0.2 : 0) - (marketState === "LOW_LIQUIDITY" ? 0.1 : 0),
      0.1,
      0.95
    );

    return {
      marketState,
      confidence: Number(confidence.toFixed(3)),
      volatility: Number(volatility.toFixed(6)),
      trendScore: Number(trendScore.toFixed(6)),
      drift: Number(drift.toFixed(6)),
      explanationLines
    };
  }
}
