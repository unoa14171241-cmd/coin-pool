"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { ErrorNotice } from "@/components/error-notice";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { DataQualityBadge, FreshnessBadge, SourceBadge } from "@/components/data-quality-badge";
import { WhyPanel } from "@/components/cards/why-panel";
import { RangeVisualizer } from "@/components/charts/range-visualizer";
import { PositionPriceChart } from "@/components/charts/position-price-chart";
import { HodlLpComparisonCard } from "@/components/cards/hodl-lp-comparison-card";
import { RebalanceCostSimulator } from "@/components/cards/rebalance-cost-simulator";
import { AutomationSafetyPanel } from "@/components/cards/automation-safety-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { MetricRow } from "@/components/ui/metric-row";
import { MobileBottomActionBar } from "@/components/mobile/mobile-bottom-action-bar";
import { Button } from "@/components/ui/button";
import { usePositionDetail } from "@/hooks/use-position-detail";
import { usePositionHistory } from "@/hooks/use-position-history";
import { useActivity } from "@/hooks/use-activity";
import { useStrategySummaries } from "@/hooks/use-strategy-summaries";
import { useAutomationSettings } from "@/hooks/use-automation-settings";
import { useSync } from "@/hooks/use-sync";
import type { LpPosition } from "@/lib/types";
import { getExplorerTxUrl, shortTx } from "@/lib/explorer";

export default function PositionDetailPage() {
  const params = useParams<{ positionId: string }>();
  const positionId = params?.positionId;
  const { address } = useAccount();
  const detailQuery = usePositionDetail(address as `0x${string}` | undefined, positionId);
  const historyQuery = usePositionHistory(address as `0x${string}` | undefined, positionId);
  const activityQuery = useActivity(address);
  const { settings } = useAutomationSettings();
  const syncMutation = useSync(address as `0x${string}` | undefined);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const executionBlockedReason = settings.emergencyPaused
    ? "Emergency paused が有効のため、Rebalance実行導線は停止中です。Automation Center で解除してください。"
    : null;

  const forStrategy: LpPosition[] = useMemo(() => {
    const d = detailQuery.data;
    if (!d) return [];
    return [
      {
        id: d.id,
        nftTokenId: d.id,
        chainId: d.savedState.chainId,
        chainName: String(d.savedState.chainId),
        walletAddress: d.walletAddress,
        poolAddress: d.savedState.poolAddress,
        token0Address: d.savedState.token0Address,
        token1Address: d.savedState.token1Address,
        token0Symbol: d.savedState.token0Symbol,
        token1Symbol: d.savedState.token1Symbol,
        feeTier: d.savedState.feeTier,
        tickLower: d.savedState.tickLower,
        tickUpper: d.savedState.tickUpper,
        createdAt: d.savedState.createdAt,
        savedStatus: d.savedState.savedStatus,
        computedStatus:
          d.liveState.currentTick >= d.savedState.tickLower && d.liveState.currentTick < d.savedState.tickUpper
            ? "IN_RANGE"
            : "OUT_OF_RANGE",
        currentPrice: d.liveState.currentPrice,
        currentTick: d.liveState.currentTick,
        uncollectedFeesUsd: d.analyticsState.feeState.estimatedUncollectedFeesUsd ?? 0,
        valueUsd: d.analyticsState.estimatedPositionValueUsd ?? 0,
        estimatedApr: d.analyticsState.estimatedApr ?? 0,
        isPlaceholderMetrics: true,
        isPlaceholderValuation: d.analyticsState.status !== "exact",
        isPlaceholderYieldMetrics: d.analyticsState.feeState.status !== "exact"
      }
    ];
  }, [detailQuery.data]);
  const strategy = useStrategySummaries({
    wallet: address as `0x${string}` | undefined,
    positions: forStrategy
  }).data?.[positionId ?? ""] ?? null;

  if (detailQuery.isError) {
    return <ErrorNotice message={detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load detail"} />;
  }
  if (!detailQuery.data) return <p className="text-sm text-slate-500">Loading...</p>;

  const d = detailQuery.data;
  const history = historyQuery.data ?? [];
  const logs = (activityQuery.data ?? []).filter((x) => x.positionId === positionId);

  return (
    <section className="mx-auto max-w-7xl bg-slate-950 px-6 py-8 text-slate-100">
      <h1 className="text-2xl font-bold">Position Detail #{positionId}</h1>
      <SectionHeader title="Position" description="現在状態・戦略理由・損得・安全性を階層化して表示します。" />
      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="outline"
          disabled={!address || syncMutation.isPending}
          onClick={async () => {
            if (!address) {
              setSyncError("Wallet is not connected.");
              return;
            }
            setSyncError(null);
            setSyncMessage(null);
            try {
              const result = await syncMutation.mutateAsync({ chainId: d.savedState.chainId });
              setSyncMessage(
                `Sync completed: success=${result.summary.successChains}, partial=${result.summary.partialChains}, error=${result.summary.errorChains}`
              );
              await detailQuery.refetch();
              await historyQuery.refetch();
            } catch (e) {
              setSyncError(e instanceof Error ? e.message : "Sync failed");
            }
          }}
        >
          {syncMutation.isPending ? "Syncing..." : "Sync now"}
        </Button>
        <span className="text-xs text-slate-400">Refresh chain state for this chain.</span>
      </div>
      {syncMessage && (
        <div className="mb-4 rounded-xl border border-green-800 bg-green-950 p-3 text-sm text-green-200">{syncMessage}</div>
      )}
      {syncError && (
        <div className="mb-4 rounded-xl border border-red-800 bg-red-950 p-3 text-sm text-red-200">{syncError}</div>
      )}
      {executionBlockedReason && (
        <div className="mb-4 rounded-xl border border-amber-800 bg-amber-950 p-3 text-sm text-amber-200">{executionBlockedReason}</div>
      )}

      <GridSection title="A. Summary">
        <MetricRow label="pair" value={`${d.savedState.token0Symbol}/${d.savedState.token1Symbol}`} />
        <MetricRow
          label="status"
          value={<StatusBadge status={d.liveState.currentTick >= d.savedState.tickLower && d.liveState.currentTick < d.savedState.tickUpper ? "IN_RANGE" : "OUT_OF_RANGE"} />}
        />
        <MetricRow label="current price" value={d.liveState.currentPrice ?? "price unavailable"} />
        <MetricRow label="net expected benefit" value={strategy?.netExpectedBenefitUsd?.toFixed(2) ?? "n/a"} />
      </GridSection>

      <div className="mt-6">
        <PositionPriceChart
          pricePoints={[...(history ?? [])]
            .reverse()
            .filter((h) => h.currentPrice != null && h.currentPrice > 0)
            .map((h) => ({ timestamp: h.snapshotAt, price: h.currentPrice! }))}
          tickLower={d.savedState.tickLower}
          tickUpper={d.savedState.tickUpper}
          currentTick={d.liveState.currentTick}
          currentPrice={d.liveState.currentPrice}
          token0Symbol={d.savedState.token0Symbol}
          token1Symbol={d.savedState.token1Symbol}
          isLoading={historyQuery.isLoading}
          isError={historyQuery.isError}
          errorMessage={historyQuery.error instanceof Error ? historyQuery.error.message : undefined}
        />
      </div>

      <GridSection title="B. Current State">
        <MetricRow label="pair" value={`${d.savedState.token0Symbol}/${d.savedState.token1Symbol}`} />
        <MetricRow label="chain" value={d.savedState.chainId} />
        <MetricRow label="pool" value={d.savedState.poolAddress} />
        <MetricRow label="fee tier" value={d.savedState.feeTier} />
        <MetricRow label="tick range" value={`${d.savedState.tickLower} - ${d.savedState.tickUpper}`} />
        <MetricRow label="current tick" value={d.liveState.currentTick ?? "n/a"} />
        <MetricRow label="current price" value={d.liveState.currentPrice ?? "price unavailable"} />
        <MetricRow
          label="computed status"
          value={<StatusBadge status={d.liveState.currentTick >= d.savedState.tickLower && d.liveState.currentTick < d.savedState.tickUpper ? "IN_RANGE" : "OUT_OF_RANGE"} />}
        />
        <MetricRow
          label="snapshot freshness"
          value={
            <span className="flex items-center gap-2">
              <FreshnessBadge stale={d.liveState.stale} />
              <span>{d.liveState.snapshotUpdatedAt}</span>
            </span>
          }
        />
        <MetricRow label="live source" value={<SourceBadge source={d.liveState.source} />} />
        <MetricRow label="currentTick quality" value={<DataQualityBadge quality="exact" />} />
        <MetricRow label="currentPrice quality" value={<DataQualityBadge quality="estimated" />} />
        <MetricRow label="sync status" value={d.syncMetadata?.status ?? "NEVER"} />
        <MetricRow
          label="last sync success"
          value={
            d.syncMetadata?.lastSuccessAt ? (
              <TimestampWithAge iso={d.syncMetadata.lastSuccessAt} />
            ) : d.syncMetadata?.lastAttemptAt ? (
              <TimestampWithAge iso={d.syncMetadata.lastAttemptAt} />
            ) : (
              "never"
            )
          }
        />
        {d.syncMetadata?.error && <MetricRow label="sync error" value={d.syncMetadata.error} />}
      </GridSection>

      <GridSection title="C. Position Composition">
        <MetricRow label="current token0 amount" value="estimated via liquidity model" />
        <MetricRow label="current token1 amount" value="estimated via liquidity model" />
        <MetricRow label="token0/token1 ratio" value={d.liveState.currentPrice ?? "n/a"} />
        <MetricRow label="in-range explanation" value="range active when tickLower <= currentTick < tickUpper." />
      </GridSection>

      <GridSection title="D. Analytics">
        <MetricRow label="analytics status" value={<DataQualityBadge quality={toQuality(d.analyticsState.status)} />} />
        <MetricRow
          label="estimated value usd"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.estimatedPositionValueUsd ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.status)} />
            </span>
          }
        />
        <MetricRow
          label="estimated fees usd"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.feeState.estimatedUncollectedFeesUsd ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.feeState.status)} />
            </span>
          }
        />
        <MetricRow
          label="estimated pnl usd"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.estimatedPnlUsd ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.status)} />
            </span>
          }
        />
        <MetricRow
          label="estimated apr"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.estimatedApr ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.status)} />
            </span>
          }
        />
        <MetricRow
          label="estimated apy"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.estimatedApy ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.status)} />
            </span>
          }
        />
        <MetricRow
          label="estimated roi"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.estimatedRoiPercent ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.status)} />
            </span>
          }
        />
        <MetricRow
          label="estimated IL usd"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.estimatedImpermanentLossUsd ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.status)} />
            </span>
          }
        />
        <MetricRow
          label="estimated IL %"
          value={
            <span className="flex items-center gap-2">
              <span>{d.analyticsState.estimatedImpermanentLossPercent ?? "n/a"}</span>
              <DataQualityBadge quality={toQuality(d.analyticsState.status)} />
            </span>
          }
        />
      </GridSection>

      <div className="mt-4">
        <HodlLpComparisonCard
          lpValueUsd={d.analyticsState.estimatedPositionValueUsd}
          estimatedIlUsd={d.analyticsState.estimatedImpermanentLossUsd}
          estimatedIlPercent={d.analyticsState.estimatedImpermanentLossPercent}
          quality={toQuality(d.analyticsState.status)}
          compact={false}
        />
      </div>

      <GridSection title="E. Strategy">
        <MetricRow label="strategy mode" value="BALANCED (configurable in Automation Center)" />
        <MetricRow label="market state" value={strategy?.marketState ?? "n/a"} />
        <MetricRow label="proposed range" value={strategy ? `${strategy.suggestedTickLower} - ${strategy.suggestedTickUpper}` : "n/a"} />
        <MetricRow
          label="should rebalance"
          value={strategy?.shouldRebalance ? <StatusBadge status="REBALANCE_TRUE" /> : "NO"}
        />
        <MetricRow label="urgency" value={strategy?.urgency ?? "LOW"} />
        <MetricRow label="strategy freshness" value={<FreshnessBadge stale={strategy?.stale ?? true} />} />
        <MetricRow label="strategy generatedAt" value={<TimestampWithAge iso={strategy?.generatedAt ?? ""} />} />
        <MetricRow label="expected gas cost" value={strategy?.estimatedGasCostUsd ?? "n/a"} />
        <MetricRow label="expected fee improvement" value={`${strategy?.netExpectedBenefitUsd ?? "n/a"} (net proxy)`} />
        <MetricRow
          label="expected net benefit"
          value={
            strategy?.netExpectedBenefitUsd == null ? (
              "n/a"
            ) : (
              <span className="flex items-center gap-2">
                <StatusBadge status={strategy.netExpectedBenefitUsd < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />
                <span>{strategy.netExpectedBenefitUsd.toFixed(2)}</span>
              </span>
            )
          }
        />
        {(strategy?.explanationLines ?? []).slice(0, 3).map((line) => (
          <p key={line}>- {line}</p>
        ))}
        <div className="mt-3 grid gap-3">
          <RangeVisualizer
            currentLowerTick={d.savedState.tickLower}
            currentUpperTick={d.savedState.tickUpper}
            currentTick={d.liveState.currentTick ?? null}
            currentPrice={d.liveState.currentPrice ?? null}
            proposedLowerTick={strategy?.suggestedTickLower ?? null}
            proposedUpperTick={strategy?.suggestedTickUpper ?? null}
          />
          <WhyPanel
            marketState={strategy?.marketState}
            strategyMode={settings.strategyMode}
            currentIssue={
              d.liveState.currentTick >= d.savedState.tickUpper
                ? "Price is above the current range."
                : d.liveState.currentTick < d.savedState.tickLower
                  ? "Price is below the current range."
                  : "Price is near a range boundary."
            }
            expectedOutcome="Range reset may improve expected fee capture efficiency."
            costUsd={strategy?.estimatedGasCostUsd ?? null}
            netExpectedBenefitUsd={strategy?.netExpectedBenefitUsd ?? null}
            shouldRebalance={strategy?.shouldRebalance}
            explanationLines={strategy?.explanationLines ?? []}
          />
          <RebalanceCostSimulator
            estimatedGasCostUsd={strategy?.estimatedGasCostUsd ?? null}
            expectedFeeImprovementUsd={null}
            netExpectedBenefitUsd={strategy?.netExpectedBenefitUsd ?? null}
            shouldRebalance={strategy?.shouldRebalance}
            urgency={strategy?.urgency}
          />
        </div>
      </GridSection>

      <GridSection title="H. Action History">
        {logs.length === 0 && <p>No actions yet.</p>}
        {logs.slice(0, 20).map((log) => (
          <p key={log.id}>
            <TimestampWithAge iso={log.createdAt} compact /> | {log.type} |{" "}
            {log.tx ? (
              getExplorerTxUrl(log.chainId ?? d.savedState.chainId, log.tx) ? (
                <a
                  href={getExplorerTxUrl(log.chainId ?? d.savedState.chainId, log.tx) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 underline-offset-2 hover:underline"
                >
                  {shortTx(log.tx)}
                </a>
              ) : (
                shortTx(log.tx)
              )
            ) : (
              "-"
            )}{" "}
            | {log.error ?? log.message}
          </p>
        ))}
      </GridSection>

      <GridSection title="I. Safety / Automation">
        <MetricRow label="exact approval policy" value="enabled" />
        <MetricRow label="auto-rebalance" value="configure in Automation Center" />
        <MetricRow label="last rebalance" value={logs.find((x) => x.type === "Rebalance")?.createdAt ?? "n/a"} />
        <MetricRow label="cooldown" value="configured by automation policy" />
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
      </GridSection>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="font-semibold">J. Data Quality / Freshness / Source</p>
        <div className="mt-3 space-y-2">
          <MetricRow label="snapshot updated at" value={d.liveState.snapshotUpdatedAt} />
          <MetricRow label="stale/fresh" value={<FreshnessBadge stale={d.liveState.stale} />} />
          <MetricRow label="analytics source" value={<DataQualityBadge quality={toQuality(d.analyticsState.status)} />} />
          <MetricRow label="live state source" value={<SourceBadge source={d.liveState.source} />} />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-xs text-yellow-200">
        <p>Exact/Estimated/Placeholder policy</p>
        <p>- currentTick/currentPrice: live-derived</p>
        <p>- fees/pnl/il/apr: estimated or placeholder based on data source</p>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="font-semibold">History Snapshots ({history.length})</p>
        {history.slice(0, 10).map((h) => (
          <p key={h.snapshotAt}>
            <TimestampWithAge iso={h.snapshotAt} compact /> | tick {h.currentTick} | price {h.currentPrice ?? "n/a"} | value{" "}
            {h.estimatedValueUsd ?? "n/a"}
          </p>
        ))}
      </div>
      <RiskDisclosure />
      <MobileBottomActionBar>
        <Link href="/my-positions" className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-sm">
          Positions
        </Link>
        <Link
          href={executionBlockedReason ? "/positions/" : "/rebalance"}
          aria-disabled={Boolean(executionBlockedReason)}
          onClick={(e) => {
            if (!executionBlockedReason) return;
            e.preventDefault();
          }}
          className={`inline-flex h-11 flex-1 items-center justify-center rounded-md text-sm font-medium ${
            executionBlockedReason
              ? "cursor-not-allowed border border-slate-700 bg-slate-800 text-slate-500"
              : "bg-blue-600 text-white"
          }`}
        >
          Review Rebalance
        </Link>
      </MobileBottomActionBar>
    </section>
  );
}

function GridSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-3 space-y-2 text-slate-300">{children}</div>
    </div>
  );
}

function toQuality(value: "placeholder" | "estimated" | "exact"): "placeholder" | "estimated" | "exact" {
  return value;
}

