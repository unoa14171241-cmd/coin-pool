"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { AnalyticsSummaryCard } from "@/components/cards/analytics-summary-card";
import { DailyProfitChart } from "@/components/charts/daily-profit-chart";
import { HodlLpComparisonCard } from "@/components/cards/hodl-lp-comparison-card";
import { PortfolioRiskMap } from "@/components/cards/portfolio-risk-map";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { DataQualityBadge, FreshnessBadge } from "@/components/data-quality-badge";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { SectionHeader } from "@/components/ui/section-header";
import { WarningBox } from "@/components/ui/warning-box";
import { useDailyProfit } from "@/hooks/use-daily-profit";
import { usePortfolio } from "@/hooks/use-portfolio";

export default function PortfolioPage() {
  const { address, chain } = useAccount();
  const { data } = usePortfolio(address, chain?.id);
  const dailyProfitQuery = useDailyProfit(address, chain?.id);
  const stats = useMemo(() => {
    const positionsCount = data?.positionsCount ?? 0;
    const outOfRangeCount = data?.outOfRangeCount ?? 0;
    const outOfRangeShare = positionsCount ? (outOfRangeCount / positionsCount) * 100 : 0;
    return {
      totalValue: data?.totalEstimatedValueUsd ?? 0,
      totalFees: data?.totalEstimatedFeesUsd ?? 0,
      totalPnl: data?.totalEstimatedPnlUsd ?? 0,
      totalIl: data?.totalEstimatedImpermanentLossUsd ?? 0,
      avgApr: data?.averageEstimatedApr ?? 0,
      highVol: data?.highVolatilityPoolsCount ?? 0,
      aggressive: data?.negativeNetBenefitPositionsCount ?? 0,
      outOfRangeShare,
      staleCount: Number(data?.metadata.strategy.stale || data?.metadata.valuation.stale || data?.metadata.yieldMetrics.stale)
    };
  }, [data]);
  const riskSuggestions = useMemo(() => {
    const items: string[] = [];
    if (stats.outOfRangeShare > 40) items.push("Out-of-range share is elevated. Consider recalibrating ranges.");
    if (stats.aggressive > Math.max(1, (data?.positionsCount ?? 0) / 3)) items.push("Aggressive/high-urgency exposure is above the recommended threshold.");
    if (stats.highVol > 0) items.push("High-volatility pool exposure detected. Review gas and rebalance cadence.");
    if (stats.totalFees < 1 && (data?.positionsCount ?? 0) > 0) items.push("Fee capture is low relative to active positions.");
    return items;
  }, [data?.positionsCount, stats.aggressive, stats.highVol, stats.outOfRangeShare, stats.totalFees]);

  return (
    <section className="mx-auto max-w-7xl bg-slate-950 px-6 py-8 text-slate-100">
      <h1 className="text-2xl font-bold">Portfolio Analytics</h1>
      <SectionHeader title="Portfolio Risk & Exposure" description="全体最適の観点で集中リスク・ボラティリティ・収益性を確認します。" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <AnalyticsSummaryCard title="Total estimated value" value={`$${stats.totalValue.toFixed(2)}`} quality={data?.metadata.valuation.quality ?? "estimated"} />
        <AnalyticsSummaryCard title="Total estimated fees" value={`$${stats.totalFees.toFixed(2)}`} quality={data?.metadata.yieldMetrics.quality ?? "placeholder"} />
        <AnalyticsSummaryCard title="Total pnl" value={`$${stats.totalPnl.toFixed(2)}`} quality={data?.metadata.valuation.quality ?? "estimated"} />
        <AnalyticsSummaryCard title="Total estimated IL" value={`$${stats.totalIl.toFixed(2)}`} quality={data?.metadata.valuation.quality ?? "estimated"} />
        <AnalyticsSummaryCard title="Average APR" value={`${stats.avgApr.toFixed(2)}%`} quality={data?.metadata.yieldMetrics.quality ?? "placeholder"} />
      </div>

      <div className="mt-6">
        <SectionHeader title="HODL vs LP Comparison" description="単純保有とLP運用の価値差（推定IL）です。" />
        <HodlLpComparisonCard
          lpValueUsd={stats.totalValue}
          estimatedIlUsd={stats.totalIl}
          estimatedIlPercent={
            stats.totalValue > 0 && stats.totalIl != null
              ? (stats.totalIl / stats.totalValue) * 100
              : null
          }
          quality={data?.metadata.valuation.quality ?? "estimated"}
        />
      </div>

      <div className="mt-6">
        <SectionHeader
          title="Daily Snapshot Trend"
          description="各日時点の累積/スナップショット推移。日次差分ではなく、その日時点のスナップショット値です。PositionSnapshot ベースの推定値。"
        />
        <DailyProfitChart
          daily={dailyProfitQuery.data?.daily ?? []}
          quality={dailyProfitQuery.data?.metadata.quality ?? "estimated"}
          isLoading={dailyProfitQuery.isLoading}
        />
      </div>

      <div className="mt-4">
        <PortfolioRiskMap
          chainDistribution={[{ label: `Chain ${chain?.id ?? data?.chainId ?? 42161}`, value: data?.positionsCount ?? 0 }]}
          tokenPairDistribution={[{ label: "ETH/USDC (tracked)", value: data?.positionsCount ?? 0 }]}
          poolDistribution={[
            { label: "HIGH_VOLATILITY pools", value: data?.highVolatilityPoolsCount ?? 0 },
            { label: "RANGE pools", value: data?.rangePoolsCount ?? 0 }
          ]}
          strategyDistribution={[
            { label: "Negative net benefit positions", value: data?.negativeNetBenefitPositionsCount ?? 0 },
            { label: "Other positions", value: Math.max(0, (data?.positionsCount ?? 0) - (data?.negativeNetBenefitPositionsCount ?? 0)) }
          ]}
          concentrationRiskPercent={Math.min(100, (data?.positionsCount ?? 0) > 0 ? 100 : 0)}
          aggressiveRangePercent={Math.min(100, ((data?.negativeNetBenefitPositionsCount ?? 0) / Math.max(1, data?.positionsCount ?? 1)) * 100)}
          outOfRangeSharePercent={stats.outOfRangeShare}
          highVolatilityExposurePercent={Math.min(100, ((data?.highVolatilityPoolsCount ?? 0) / Math.max(1, (data?.highVolatilityPoolsCount ?? 0) + (data?.rangePoolsCount ?? 0))) * 100)}
          suggestions={riskSuggestions}
        />
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-sm font-semibold">Data Quality / Freshness</p>
        <p className="mt-3">
          Portfolio freshness: <FreshnessBadge stale={stats.staleCount > 0} /> ({stats.staleCount > 0 ? "stale metadata exists" : "fresh"})
        </p>
        <p>
          generatedAt: <TimestampWithAge iso={data?.metadata.valuation.generatedAt ?? ""} />
        </p>
        <p>
          Value/PnL quality: <DataQualityBadge quality={data?.metadata.valuation.quality ?? "estimated"} />
        </p>
        <p>
          Fees quality: <DataQualityBadge quality={data?.metadata.yieldMetrics.quality ?? "placeholder"} />
        </p>
        <p>
          Risk/optimization quality: <DataQualityBadge quality={data?.metadata.strategy.quality ?? "heuristic"} />
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-sm text-yellow-200">
        <p className="text-sm font-semibold">Optimization Suggestions</p>
        <ul className="ml-5 mt-3 list-disc">
          {riskSuggestions.map((item) => (
            <li key={item}>{item}</li>
          ))}
          <li>Gas efficiency monitor: use Strategy Lab threshold simulation before frequent rebalances.</li>
        </ul>
      </div>
      <WarningBox
        type="INFO"
        title="Portfolio Notes"
        description="一部メトリクスは estimated/placeholder を含みます。判断時は Data Quality バッジを必ず確認してください。"
        className="mt-6"
      />
      <RiskDisclosure />
    </section>
  );
}
