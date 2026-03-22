"use client";

import { AnalyticsSummaryCard } from "@/components/cards/analytics-summary-card";
import { StrategySummaryCard } from "@/components/cards/strategy-summary-card";
import { AutomationSafetyPanel } from "@/components/cards/automation-safety-panel";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { FreshnessBadge, SourceBadge, DataQualityBadge } from "@/components/data-quality-badge";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { WalletControl } from "@/components/wallet-control";
import { ErrorNotice } from "@/components/error-notice";
import { SectionHeader } from "@/components/ui/section-header";
import { WarningBox } from "@/components/ui/warning-box";
import { MetricRow } from "@/components/ui/metric-row";
import { useDashboard } from "@/hooks/use-dashboard";
import { usePositions } from "@/hooks/use-positions";
import { useStrategySummaries } from "@/hooks/use-strategy-summaries";
import { useAutomationSettings } from "@/hooks/use-automation-settings";
import { REWARD_DISCLAIMER } from "@/lib/constants";
import { useAccount } from "wagmi";

function usd(v?: number | null) {
  if (v == null) return "price unavailable";
  return `$${v.toLocaleString()}`;
}

export default function DashboardPage() {
  const { address, chain } = useAccount();
  const { data, isError, error } = useDashboard(address, chain?.id);
  const positionsQuery = usePositions(address);
  const positions = positionsQuery.data ?? [];
  const strategyQuery = useStrategySummaries({
    wallet: address as `0x${string}` | undefined,
    positions
  });
  const strategySummaries = strategyQuery.data ?? {};
  const { settings } = useAutomationSettings();
  const needsRebalance = positions.filter((p) => strategySummaries[p.id]?.shouldRebalance);
  const negativeNet = positions.filter((p) => (strategySummaries[p.id]?.netExpectedBenefitUsd ?? 0) < 0);
  const highVolPools = Object.values(strategySummaries).filter((s) => s.marketState === "HIGH_VOLATILITY").length;
  const rangePools = Object.values(strategySummaries).filter((s) => s.marketState === "RANGE").length;
  const staleCountFromApi = data?.stalePositionsCount ?? 0;

  return (
    <section className="mx-auto max-w-7xl bg-slate-950 px-6 py-8 text-slate-100">
      <h1 className="text-2xl font-bold">Command Center</h1>
      <SectionHeader title="Overview" description="市場状態・戦略判断・自動化安全性を統一表示します。" />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <WalletControl />
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100">
          <p className="text-sm font-semibold">Revenue labels policy</p>
          <ul className="ml-5 list-disc">
            <li>Estimated</li>
            <li>Realized</li>
          </ul>
        </div>
      </div>
      {isError && <ErrorNotice message={error instanceof Error ? error.message : "Failed to load dashboard"} />}
      <div className="grid gap-3 md:hidden">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-semibold">Portfolio Summary</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="total estimated value usd" value={usd(data?.totalValue ?? 0)} />
            <MetricRow label="total estimated fees usd" value={usd(data?.estimatedFeesEarned ?? 0)} />
            <MetricRow label="total estimated pnl usd" value={usd(data?.estimatedPositionPnlUsd ?? 0)} />
            <MetricRow label="total estimated impermanent loss usd" value="Estimated in portfolio view" />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-semibold">Today&apos;s Actions</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="positions needing rebalance" value={needsRebalance.length} />
            <MetricRow label="collect recommended positions" value={positions.filter((p) => p.uncollectedFeesUsd > 0).length} />
            <MetricRow label="stale positions count" value={staleCountFromApi} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-semibold">Rebalance Recommendations</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="rebalance candidates" value={needsRebalance.length} />
            <MetricRow label="negative net benefit positions" value={negativeNet.length} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-semibold">Collect Recommendations</p>
          <MetricRow label="collect candidates" value={positions.filter((p) => p.uncollectedFeesUsd > 0).length} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-semibold">Market Overview</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="high volatility pools" value={highVolPools} />
            <MetricRow label="range pools" value={rangePools} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-semibold">Automation Overview</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="mode" value={settings.automationMode} />
            <MetricRow label="auto rebalance enabled" value={settings.autoRebalanceEnabled ? "YES" : "NO"} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm font-semibold">Data Quality / Freshness</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="freshness" value={<FreshnessBadge stale={data?.metadata.liveState.stale ?? false} />} />
            <MetricRow label="source" value={<SourceBadge source={(data?.metadata.liveState.source as "rpc" | "cache" | "fallback") ?? "rpc"} />} />
          </div>
        </div>
      </div>

      <div className="hidden gap-4 sm:grid-cols-2 lg:grid-cols-4 md:grid">
        <AnalyticsSummaryCard title="Total estimated value usd" value={usd(data?.totalValue ?? 0)} quality={data?.metadata.valuation.quality ?? "estimated"} />
        <AnalyticsSummaryCard title="Total estimated fees usd" value={usd(data?.estimatedFeesEarned ?? 0)} quality={data?.metadata.yieldMetrics.quality ?? "placeholder"} />
        <AnalyticsSummaryCard title="Total estimated pnl usd" value={usd(data?.estimatedPositionPnlUsd ?? 0)} quality={data?.metadata.valuation.quality ?? "estimated"} />
        <AnalyticsSummaryCard title="Total estimated impermanent loss usd" value="Estimated in portfolio view" quality={data?.metadata.valuation.quality ?? "estimated"} />
        <AnalyticsSummaryCard title="Positions count" value={String(data?.totalPositions ?? 0)} quality={data?.metadata.liveState.quality ?? "exact"} />
        <AnalyticsSummaryCard title="In range" value={String(data?.inRange ?? 0)} quality={data?.metadata.liveState.quality ?? "exact"} />
        <AnalyticsSummaryCard title="Out of range" value={String(data?.outOfRange ?? 0)} quality={data?.metadata.liveState.quality ?? "exact"} tone={(data?.outOfRange ?? 0) > 0 ? "warning" : "default"} />
        <AnalyticsSummaryCard title="Positions needing rebalance" value={String(needsRebalance.length)} quality="heuristic" tone={needsRebalance.length > 0 ? "warning" : "default"} />
        <AnalyticsSummaryCard title="Negative net benefit positions" value={String(negativeNet.length)} quality="heuristic" tone={negativeNet.length > 0 ? "danger" : "default"} />
        <AnalyticsSummaryCard title="Stale positions count" value={String(staleCountFromApi)} quality={data?.metadata.liveState.quality ?? "exact"} tone={staleCountFromApi > 0 ? "warning" : "default"} />
        <AnalyticsSummaryCard title="Connected wallet" value={data?.walletAddress ?? "-"} quality="exact" />
        <AnalyticsSummaryCard title="Chain / ETH Price" value={`${data?.chainName ?? "Arbitrum"} / ${usd(data?.ethPrice ?? null)}`} quality="estimated" />
      </div>

      <div className="mt-8 hidden gap-4 lg:grid-cols-3 md:grid">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100">
          <p className="text-sm font-semibold">Today&apos;s Actions</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="rebalance recommended positions" value={needsRebalance.length} />
            <MetricRow label="collect recommended positions" value={positions.filter((p) => p.uncollectedFeesUsd > 0).length} />
            <MetricRow label="warning positions" value={negativeNet.length + (data?.outOfRange ?? 0)} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100">
          <p className="text-sm font-semibold">Market Overview</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="current market state summary" value="Strategy-driven mixed regime" />
            <MetricRow label="volatility summary" value={`High volatility pools ${highVolPools}`} />
            <MetricRow label="pools in HIGH_VOLATILITY" value={highVolPools} />
            <MetricRow label="pools in RANGE" value={rangePools} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100">
          <p className="text-sm font-semibold">Automation Overview</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="manual positions count" value={settings.automationMode === "MANUAL" ? positions.length : 0} />
            <MetricRow label="semi-auto positions count" value={settings.automationMode === "SEMI_AUTO" ? positions.length : 0} />
            <MetricRow label="auto positions count" value={settings.automationMode === "AUTO" ? positions.length : 0} />
          </div>
          <div className="mt-3">
            <AutomationSafetyPanel
              automationMode={settings.automationMode}
              minNetBenefitUsd={settings.minNetBenefitUsd}
              cooldownMinutes={settings.cooldownMinutes}
              maxGasCostUsd={settings.maxGasCostUsd}
              staleSnapshotReject={settings.staleSnapshotReject}
              volatilitySafetyThreshold={settings.volatilitySafetyThreshold}
              autoCollectEnabled={settings.autoCollectEnabled}
              autoRebalanceEnabled={settings.autoRebalanceEnabled}
              lastAutoActionAt={null}
              nextEligibleRebalanceAt={null}
            />
          </div>
        </div>
      </div>
      {(needsRebalance.length > 0 || negativeNet.length > 0 || staleCountFromApi > 0) && (
        <WarningBox
          type={negativeNet.length > 0 ? "DANGER" : "WARNING"}
          title="Action First Summary"
          description={`rebalance:${needsRebalance.length} / negative-net:${negativeNet.length} / stale:${staleCountFromApi}. まず Preview を確認し、純便益が負の場合は実行を避けてください。`}
          className="mt-6"
        />
      )}

      <div className="mt-6 hidden rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100 md:block">
        <p className="text-sm font-semibold">State Freshness / Source</p>
        <div className="mt-3 space-y-2">
          <MetricRow
            label="strategy freshness"
            value={
              <span className="flex items-center gap-2">
                <FreshnessBadge stale={data?.metadata.liveState.stale ?? false} />
                <span>({staleCountFromApi} stale positions from API)</span>
              </span>
            }
          />
          <MetricRow label="dashboard generatedAt" value={<TimestampWithAge iso={data?.metadata.liveState.generatedAt ?? ""} />} />
          <MetricRow label="live state source" value={<SourceBadge source={(data?.metadata.liveState.source as "rpc" | "cache" | "fallback") ?? "rpc"} />} />
          <MetricRow
            label="metric quality policy"
            value={
              <span className="flex flex-wrap items-center gap-1">
                <DataQualityBadge quality="exact" />
                <DataQualityBadge quality="estimated" />
                <DataQualityBadge quality="heuristic" />
                <DataQualityBadge quality="placeholder" />
              </span>
            }
          />
        </div>
      </div>

      <div className="mt-8 hidden gap-4 md:grid-cols-2 md:grid">
        {needsRebalance.slice(0, 2).map((position) => (
          <StrategySummaryCard key={position.id} title={`${position.token0Symbol}/${position.token1Symbol} #${position.id}`} summary={strategySummaries[position.id] ?? null} />
        ))}
      </div>

      <WarningBox type="INFO" title="Reward Disclaimer" description={REWARD_DISCLAIMER} className="mt-6" />
      <WarningBox
        type="WARNING"
        title="Data Quality Policy"
        description="current tick/price are live-derived, PnL/APR/fees are estimated or placeholder depending on source availability."
        className="mt-4"
      />

      <RiskDisclosure />
    </section>
  );
}
