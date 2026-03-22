"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { ErrorNotice } from "@/components/error-notice";
import { ConfirmRebalanceModal } from "@/components/modals/confirm-rebalance-modal";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { DataQualityBadge, FreshnessBadge } from "@/components/data-quality-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { WarningBox } from "@/components/ui/warning-box";
import { SectionHeader } from "@/components/ui/section-header";
import { MetricRow } from "@/components/ui/metric-row";
import { MobilePositionCard } from "@/components/mobile/mobile-position-card";
import { usePositions } from "@/hooks/use-positions";
import { useAutomationSettings } from "@/hooks/use-automation-settings";
import { Button } from "@/components/ui/button";
import { useUniswapV3Adapter } from "@/hooks/use-uniswap-v3-adapter";
import { fetchRebalancePreview, toStrategyPreviewSummary } from "@/lib/strategy/client";
import { displayPriceToApproxTick } from "@/lib/uniswap/tick";
import type { StrategyApiResponse, StrategyMode, StrategyPreviewSummary } from "@/lib/strategy/types";
import { useAccount, useSignMessage } from "wagmi";
import { useSync } from "@/hooks/use-sync";

export default function MyPositionsPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { data, isError, error, refetch } = usePositions(address);
  const syncMutation = useSync(address);
  const { settings, setSettings } = useAutomationSettings();
  const adapter = useUniswapV3Adapter();
  const [collectingPositionId, setCollectingPositionId] = useState<string | null>(null);
  const [rebalancingPositionId, setRebalancingPositionId] = useState<string | null>(null);
  const [loadingStrategyPositionId, setLoadingStrategyPositionId] = useState<string | null>(null);
  const [strategyModeByPosition, setStrategyModeByPosition] = useState<Record<string, StrategyMode>>({});
  const [strategyByPosition, setStrategyByPosition] = useState<Record<string, StrategyApiResponse>>({});
  const [strategySummaryByPosition, setStrategySummaryByPosition] = useState<Record<string, StrategyPreviewSummary>>({});
  const [confirmRebalancePositionId, setConfirmRebalancePositionId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "IN_RANGE" | "OUT_OF_RANGE">("ALL");
  const [shouldRebalanceOnly, setShouldRebalanceOnly] = useState(false);
  const [highUrgencyOnly, setHighUrgencyOnly] = useState(false);
  const [modeFilter, setModeFilter] = useState<"ALL" | StrategyMode>("ALL");
  const [pairFilter, setPairFilter] = useState("");
  const [sortKey, setSortKey] = useState<"value" | "fees" | "pnl" | "urgency" | "net">("value");
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const base = data ?? [];
    const out = base.filter((position) => {
      const mode = strategyModeByPosition[position.id] ?? "BALANCED";
      const summary = strategySummaryByPosition[position.id];
      if (statusFilter !== "ALL" && position.computedStatus !== statusFilter) return false;
      if (shouldRebalanceOnly && !summary?.shouldRebalance) return false;
      if (highUrgencyOnly && summary?.urgency !== "HIGH") return false;
      if (modeFilter !== "ALL" && mode !== modeFilter) return false;
      if (pairFilter && !`${position.token0Symbol}/${position.token1Symbol}`.toLowerCase().includes(pairFilter.toLowerCase())) return false;
      return true;
    });
    const sorted = [...out].sort((a, b) => {
      const sa = strategySummaryByPosition[a.id];
      const sb = strategySummaryByPosition[b.id];
      if (sortKey === "value") return (b.valueUsd ?? 0) - (a.valueUsd ?? 0);
      if (sortKey === "fees") return (b.uncollectedFeesUsd ?? 0) - (a.uncollectedFeesUsd ?? 0);
      if (sortKey === "pnl") return (b.valueUsd ?? 0) - (a.valueUsd ?? 0);
      if (sortKey === "urgency") return urgencyRank(sb?.urgency) - urgencyRank(sa?.urgency);
      return (sb?.netExpectedBenefitUsd ?? 0) - (sa?.netExpectedBenefitUsd ?? 0);
    });
    return sorted;
  }, [
    data,
    highUrgencyOnly,
    modeFilter,
    pairFilter,
    shouldRebalanceOnly,
    sortKey,
    statusFilter,
    strategyModeByPosition,
    strategySummaryByPosition
  ]);

  const summary = useMemo(() => {
    const base = filtered;
    const stale = base.filter((p) => strategySummaryByPosition[p.id]?.stale).length;
    const rebalance = base.filter((p) => strategySummaryByPosition[p.id]?.shouldRebalance).length;
    const negativeNet = base.filter((p) => (strategySummaryByPosition[p.id]?.netExpectedBenefitUsd ?? 0) < 0).length;
    const totalValue = base.reduce((acc, p) => acc + (p.valueUsd ?? 0), 0);
    return { stale, rebalance, negativeNet, totalValue, total: base.length };
  }, [filtered, strategySummaryByPosition]);
  const executionBlockedReason = settings.emergencyPaused
    ? "Emergency paused が有効のため、Collect / Rebalance 実行は停止中です。Automation Center で解除してください。"
    : null;
  const canExecutePositionActions = executionBlockedReason == null;

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedPositionId(null);
      return;
    }
    const stillExists = filtered.some((item) => item.id === selectedPositionId);
    if (!stillExists) {
      setSelectedPositionId(filtered[0].id);
    }
  }, [filtered, selectedPositionId]);

  const selectedPosition = useMemo(
    () => filtered.find((position) => position.id === selectedPositionId) ?? null,
    [filtered, selectedPositionId]
  );
  const selectedMode: StrategyMode = selectedPosition
    ? (strategyModeByPosition[selectedPosition.id] ?? "BALANCED")
    : "BALANCED";
  const selectedSummary = selectedPosition ? strategySummaryByPosition[selectedPosition.id] : undefined;
  const modalPosition = filtered.find((position) => position.id === confirmRebalancePositionId) ?? selectedPosition ?? null;

  async function loadStrategyPreview(positionId: string, mode: StrategyMode) {
    if (!address) {
      setActionError("Wallet is not connected.");
      return;
    }
    setActionError(null);
    setLoadingStrategyPositionId(positionId);
    try {
      const preview = await fetchRebalancePreview({
        wallet: address,
        positionId,
        body: { mode }
      });
      setStrategyByPosition((prev) => ({ ...prev, [positionId]: preview }));
      setStrategySummaryByPosition((prev) => ({
        ...prev,
        [positionId]: toStrategyPreviewSummary(preview)
      }));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to load strategy preview");
    } finally {
      setLoadingStrategyPositionId(null);
    }
  }

  async function runCollect(positionId: string) {
    if (!canExecutePositionActions) {
      setActionError(executionBlockedReason ?? "Execution is currently blocked.");
      return;
    }
    if (!address) {
      setActionError("Wallet is not connected.");
      return;
    }
    setActionError(null);
    setActionMessage(null);
    setCollectingPositionId(positionId);
    try {
      const result = await adapter.collectFees(positionId);
      await saveActivityLog({
        wallet: address,
        signMessageAsync,
        type: "Collect",
        positionId,
        txHash: result.txHash,
        message: `Collected fees for position ${positionId}. amount0=${result.amount0 ?? "n/a"}, amount1=${result.amount1 ?? "n/a"}`
      });
      setActionMessage(`Collect executed: ${result.txHash}`);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Collect failed");
    } finally {
      setCollectingPositionId(null);
    }
  }

  async function runRebalance(positionId: string) {
    if (!canExecutePositionActions) {
      setActionError(executionBlockedReason ?? "Execution is currently blocked.");
      return;
    }
    if (!address) {
      setActionError("Wallet is not connected.");
      return;
    }
    const target = filtered.find((item) => item.id === positionId);
    const strategySummary = strategySummaryByPosition[positionId] ?? null;
    if (!target) {
      setActionError("Position not found.");
      return;
    }
    if (!strategySummary) {
      setActionError("No strategy preview loaded.");
      return;
    }
    setActionError(null);
    setActionMessage(null);
    setRebalancingPositionId(positionId);
    try {
      const [nextTickLower, nextTickUpper] = resolveExecutionTicks({
        previewSummary: strategySummary,
        previewRaw: strategyByPosition[positionId] ?? null,
        suggestedLowerPrice: target.currentPrice ? target.currentPrice * 0.95 : null,
        suggestedUpperPrice: target.currentPrice ? target.currentPrice * 1.05 : null
      });
      const result = await adapter.rebalance(positionId, nextTickLower, nextTickUpper);
      await saveActivityLog({
        wallet: address,
        signMessageAsync,
        type: "Rebalance",
        positionId,
        txHash: result.txHash,
        message: `Rebalanced position ${positionId} -> newTokenId=${result.newPositionTokenId ?? "unknown"}`
      });
      setActionMessage(`Rebalance executed: ${result.txHash}`);
      setConfirmRebalancePositionId(null);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Rebalance failed");
    } finally {
      setRebalancingPositionId(null);
    }
  }

  return (
    <section className="mx-auto max-w-[1400px] px-4 py-6 text-slate-100 md:px-6">
      <h1 className="text-2xl font-bold">My Positions</h1>
      <SectionHeader title="My Liquidity" description="画像イメージに合わせたカード中心の運用画面。" />
      {isError && <ErrorNotice message={error instanceof Error ? error.message : "Failed to load positions"} />}
      {actionMessage && <WarningBox type="SUCCESS" title="Success" description={actionMessage} className="mb-6" />}
      {actionError && <WarningBox type="DANGER" title="Action Error" description={actionError} className="mb-6" />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={!address || syncMutation.isPending}
          onClick={async () => {
            if (!address) {
              setActionError("Wallet is not connected.");
              return;
            }
            setActionError(null);
            setActionMessage(null);
            try {
              const result = await syncMutation.mutateAsync();
              setActionMessage(
                `Sync completed: success=${result.summary.successChains}, partial=${result.summary.partialChains}, error=${result.summary.errorChains}`
              );
              await refetch();
            } catch (e) {
              setActionError(e instanceof Error ? e.message : "Sync failed");
            }
          }}
        >
          {syncMutation.isPending ? "Syncing..." : "Sync now"}
        </Button>
        <Link href="/create-position" className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800">
          Add liquidity
        </Link>
        <span className="text-xs text-slate-400">Chain state refresh for indexed position NFTs.</span>
      </div>
      <div className="grid gap-4 lg:hidden">
        {filtered.map((position) => {
          const mode = strategyModeByPosition[position.id] ?? "BALANCED";
          const summary = strategySummaryByPosition[position.id];
          return (
            <div key={`m-${position.id}`}>
              <MobilePositionCard
                position={position}
                mode={mode}
                summary={summary}
                isCollecting={collectingPositionId === position.id}
                isRebalancing={rebalancingPositionId === position.id}
                isLoadingPreview={loadingStrategyPositionId === position.id}
                collectDisabled={!canExecutePositionActions}
                rebalanceDisabled={!canExecutePositionActions}
                actionBlockedReason={executionBlockedReason}
                onModeChange={(nextMode) => setStrategyModeByPosition((prev) => ({ ...prev, [position.id]: nextMode }))}
                onPreview={() => loadStrategyPreview(position.id, mode)}
                onCollect={() => runCollect(position.id)}
                onReviewExecute={() => {
                  setActionError(null);
                  setConfirmRebalancePositionId(position.id);
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="hidden grid-cols-[220px_minmax(0,1fr)_320px] gap-4 lg:grid">
        <aside className="sticky top-20 h-fit rounded-xl border border-slate-800 bg-slate-900 p-3">
          <p className="text-xs text-slate-400">Portfolio</p>
          <p className="mt-1 text-xl font-semibold">${summary.totalValue.toFixed(2)}</p>
          <div className="mt-3 space-y-1 text-xs text-slate-300">
            <p>Visible: {summary.total}</p>
            <p className="text-yellow-300">Rebalance: {summary.rebalance}</p>
            <p className="text-orange-300">Stale: {summary.stale}</p>
            <p className="text-red-300">Negative net: {summary.negativeNet}</p>
          </div>
          <div className="mt-4 space-y-3 text-xs">
            <label className="block">
              <span className="text-slate-400">Status</span>
              <select className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="ALL">ALL</option>
                <option value="IN_RANGE">IN_RANGE</option>
                <option value="OUT_OF_RANGE">OUT_OF_RANGE</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400">Mode</span>
              <select className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100" value={modeFilter} onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)}>
                <option value="ALL">ALL</option>
                <option value="CONSERVATIVE">CONSERVATIVE</option>
                <option value="BALANCED">BALANCED</option>
                <option value="AGGRESSIVE">AGGRESSIVE</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400">Sort</span>
              <select className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
                <option value="value">value</option>
                <option value="fees">fees</option>
                <option value="pnl">pnl</option>
                <option value="urgency">urgency</option>
                <option value="net">net</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400">Pair</span>
              <input className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100" value={pairFilter} onChange={(e) => setPairFilter(e.target.value)} placeholder="WETH/USDC" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={shouldRebalanceOnly} onChange={(e) => setShouldRebalanceOnly(e.target.checked)} />
              should rebalance
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={highUrgencyOnly} onChange={(e) => setHighUrgencyOnly(e.target.checked)} />
              high urgency
            </label>
          </div>
        </aside>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4 min-[1800px]:grid-cols-5">
            {filtered.map((position) => {
              const mode = strategyModeByPosition[position.id] ?? "BALANCED";
              const strategy = strategyByPosition[position.id];
              const cardSummary = strategySummaryByPosition[position.id];
              const selected = selectedPositionId === position.id;
              const spanRaw = position.tickUpper - position.tickLower;
              const ratio = spanRaw > 0 ? ((position.currentTick - position.tickLower) / spanRaw) * 100 : 50;
              const indicatorLeft = Math.max(0, Math.min(100, ratio));
              return (
                <button
                  key={position.id}
                  type="button"
                  onClick={() => setSelectedPositionId(position.id)}
                  className={`flex h-[250px] flex-col rounded-xl border p-2 text-left transition ${
                    selected ? "border-purple-400 bg-slate-950" : "border-slate-800 bg-slate-950 hover:border-slate-700"
                  }`}
                >
                  <p className="text-xs text-slate-300">{position.token0Symbol}/{position.token1Symbol}</p>
                  <p className="text-[11px] text-slate-500">{position.feeTier} bps</p>
                  <div className="mt-2 rounded-lg bg-gradient-to-br from-fuchsia-900/60 via-purple-800/40 to-slate-900 p-2">
                    <RangeCurveMini indicatorLeft={indicatorLeft} />
                    <p className="mt-1 text-[10px] text-slate-100">#{position.id.slice(-8)}</p>
                  </div>
                  <p className={`mt-2 text-[11px] ${position.computedStatus === "IN_RANGE" ? "text-emerald-300" : "text-yellow-300"}`}>
                    {position.computedStatus}
                  </p>
                  <p className="text-[11px] text-slate-300">value ${position.valueUsd.toFixed(2)}</p>
                  <p className="text-[11px] text-slate-300">fees ${position.uncollectedFeesUsd.toFixed(2)}</p>
                  <div className="mt-auto pt-2">
                    <div className="flex items-center gap-1">
                      <StatusBadge status={cardSummary?.shouldRebalance ? "REBALANCE_TRUE" : "IN_RANGE"} />
                      <span className="text-[10px] text-slate-400">{mode}</span>
                    </div>
                    <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1">
                      <MiniTag
                        tone={position.computedStatus === "IN_RANGE" ? "green" : position.computedStatus === "CLOSED" ? "red" : "yellow"}
                        label={position.computedStatus === "IN_RANGE" ? "IN RANGE" : position.computedStatus === "CLOSED" ? "CLOSED" : "OUT OF RANGE"}
                      />
                      <MiniTag tone={position.uncollectedFeesUsd > 0.01 ? "purple" : "gray"} label={position.uncollectedFeesUsd > 0.01 ? "UNCLAIMED" : "NO FEES"} />
                      <MiniTag
                        tone={cardSummary?.shouldRebalance ? "orange" : "gray"}
                        label={cardSummary?.shouldRebalance ? "REPOSITION" : "HOLD"}
                      />
                    </div>
                  </div>
                  <div className="mt-1 min-h-7">
                    {strategy ? (
                      <p className="text-[10px] text-slate-500">
                        {strategy.marketState} / {(strategy.decision?.netExpectedBenefitUsd ?? 0).toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-[10px] text-slate-600">No preview loaded</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <aside className="sticky top-20 h-fit rounded-xl border border-slate-800 bg-slate-900 p-3">
          <p className="text-xs text-slate-400">Operation panel</p>
          {selectedPosition ? (
            <div className="mt-2 space-y-2 text-xs">
              <p className="text-sm font-semibold">{selectedPosition.token0Symbol}/{selectedPosition.token1Symbol}</p>
              <p className="text-slate-400">token #{selectedPosition.id}</p>
              <p className="text-slate-400">range {selectedPosition.tickLower} - {selectedPosition.tickUpper}</p>
              <div className="rounded border border-slate-800 bg-slate-950 p-2">
                <p className="font-medium text-slate-200">1) Load strategy preview</p>
                <p className="text-slate-400">最初に最新推奨レンジを取得します。</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950 p-2">
                <p className="font-medium text-slate-200">2) Collect earnings</p>
                <p className="text-slate-400">手数料のみ回収できます。</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950 p-2">
                <p className="font-medium text-slate-200">3) Reposition</p>
                <p className="text-slate-400">確認モーダルで最終確認して実行します。</p>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button size="sm" variant={selectedMode === "CONSERVATIVE" ? "default" : "outline"} onClick={() => setStrategyModeByPosition((prev) => ({ ...prev, [selectedPosition.id]: "CONSERVATIVE" }))}>
                  Conservative
                </Button>
                <Button size="sm" variant={selectedMode === "BALANCED" ? "default" : "outline"} onClick={() => setStrategyModeByPosition((prev) => ({ ...prev, [selectedPosition.id]: "BALANCED" }))}>
                  Balanced
                </Button>
                <Button size="sm" variant={selectedMode === "AGGRESSIVE" ? "default" : "outline"} onClick={() => setStrategyModeByPosition((prev) => ({ ...prev, [selectedPosition.id]: "AGGRESSIVE" }))}>
                  Aggressive
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSettings((prev) => ({
                      ...prev,
                      automationMode:
                        prev.automationMode === "MANUAL"
                          ? "SEMI_AUTO"
                          : prev.automationMode === "SEMI_AUTO"
                            ? "AUTO"
                            : "MANUAL"
                    }))
                  }
                >
                  Automation: {settings.automationMode}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" disabled={loadingStrategyPositionId === selectedPosition.id} onClick={() => loadStrategyPreview(selectedPosition.id, selectedMode)}>
                  {loadingStrategyPositionId === selectedPosition.id ? "Loading..." : "Load preview"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canExecutePositionActions || collectingPositionId === selectedPosition.id}
                  onClick={() => runCollect(selectedPosition.id)}
                >
                  {collectingPositionId === selectedPosition.id ? "Collecting..." : "Collect"}
                </Button>
                <Button
                  size="sm"
                  disabled={!canExecutePositionActions || rebalancingPositionId === selectedPosition.id}
                  onClick={() => setConfirmRebalancePositionId(selectedPosition.id)}
                >
                  {rebalancingPositionId === selectedPosition.id ? "Rebalancing..." : "Review & Execute"}
                </Button>
                <Link className="inline-flex items-center justify-center rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100" href={`/positions/${selectedPosition.id}`}>
                  Open detail
                </Link>
              </div>
              {executionBlockedReason ? <p className="text-[11px] text-amber-300">{executionBlockedReason}</p> : null}
              <StrategySnapshotCell
                mode={selectedMode}
                summary={selectedSummary}
                isPlaceholderValuation={selectedPosition.isPlaceholderValuation}
              />
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No position matched current filters.</p>
          )}
        </aside>
      </div>
      {modalPosition && (
        <ConfirmRebalanceModal
          isOpen={Boolean(confirmRebalancePositionId)}
          onClose={() => setConfirmRebalancePositionId(null)}
          onConfirm={async () => runRebalance(modalPosition.id)}
          strategyPreview={strategySummaryByPosition[modalPosition.id] ?? null}
          strategyMode={strategyModeByPosition[modalPosition.id] ?? "BALANCED"}
          currentPosition={modalPosition}
          gasEstimateUsd={strategySummaryByPosition[modalPosition.id]?.estimatedGasCostUsd ?? 0}
          walletAddress={address}
          isConfirming={rebalancingPositionId === modalPosition.id}
        />
      )}
      <RiskDisclosure />
    </section>
  );
}

async function saveActivityLog(input: {
  wallet: `0x${string}`;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  type: "Collect" | "Rebalance";
  positionId: string;
  txHash: string;
  message: string;
}) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  const action = encodeURIComponent("POST /activity");
  const challengeRes = await fetch(`${apiBaseUrl}/auth/challenge/${input.wallet}?action=${action}`);
  if (!challengeRes.ok) throw new Error("Failed to get auth challenge");
  const challenge = (await challengeRes.json()) as { message: string };
  const signature = await input.signMessageAsync({ message: challenge.message });
  const messageB64 = utf8ToBase64(challenge.message);
  const response = await fetch(`${apiBaseUrl}/activity`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet-address": input.wallet.toLowerCase(),
      "x-wallet-signature": signature,
      "x-wallet-message-b64": messageB64
    },
    body: JSON.stringify({
      wallet: input.wallet,
      positionId: input.positionId,
      type: input.type,
      source: "user-action",
      tx: input.txHash,
      message: input.message
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save activity log: ${text || response.status}`);
  }
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function resolveExecutionTicks(input: {
  previewSummary: StrategyPreviewSummary | null;
  previewRaw: StrategyApiResponse | null;
  suggestedLowerPrice: number | null;
  suggestedUpperPrice: number | null;
}): [number, number] {
  const fromPreviewLower =
    input.previewSummary?.suggestedTickLower ??
    input.previewRaw?.preview?.proposedRange.tickLower ??
    input.previewRaw?.suggestion?.suggestedTickLower;
  const fromPreviewUpper =
    input.previewSummary?.suggestedTickUpper ??
    input.previewRaw?.preview?.proposedRange.tickUpper ??
    input.previewRaw?.suggestion?.suggestedTickUpper;
  let lower = fromPreviewLower ?? displayPriceToApproxTick(input.suggestedLowerPrice ?? 2800);
  let upper = fromPreviewUpper ?? displayPriceToApproxTick(input.suggestedUpperPrice ?? 3200);
  if (lower >= upper) {
    const center = Math.min(lower, upper);
    lower = center - 1;
    upper = center + 1;
  }
  return [lower, upper];
}

function urgencyRank(urgency: StrategyPreviewSummary["urgency"] | undefined): number {
  if (urgency === "HIGH") return 3;
  if (urgency === "MEDIUM") return 2;
  return 1;
}

function RangeCurveMini({ indicatorLeft }: { indicatorLeft: number }) {
  const safeLeft = Math.max(4, Math.min(96, indicatorLeft));
  return (
    <div className="relative">
      <svg viewBox="0 0 100 40" className="h-10 w-full">
        <defs>
          <linearGradient id="curveStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f5d0fe" />
            <stop offset="100%" stopColor="#e9d5ff" />
          </linearGradient>
        </defs>
        <path d="M6 30 C 20 8, 36 10, 50 24 C 64 36, 80 26, 94 12" fill="none" stroke="url(#curveStroke)" strokeWidth="1.8" />
        <line x1="6" y1="34" x2="94" y2="34" stroke="rgba(248,250,252,0.35)" strokeWidth="1" />
        <line x1="14" y1="34" x2="14" y2="28" stroke="rgba(248,250,252,0.45)" strokeWidth="1" />
        <line x1="86" y1="34" x2="86" y2="28" stroke="rgba(248,250,252,0.45)" strokeWidth="1" />
        <circle cx={safeLeft} cy="22" r="3.3" fill="rgba(255,255,255,0.88)" />
      </svg>
    </div>
  );
}

function MiniTag({
  label,
  tone
}: {
  label: string;
  tone: "green" | "yellow" | "red" | "purple" | "orange" | "gray";
}) {
  const cls =
    tone === "green"
      ? "border-emerald-700 bg-emerald-950 text-emerald-300"
      : tone === "yellow"
        ? "border-yellow-700 bg-yellow-950 text-yellow-300"
        : tone === "red"
          ? "border-red-700 bg-red-950 text-red-300"
          : tone === "purple"
            ? "border-purple-700 bg-purple-950 text-purple-300"
            : tone === "orange"
              ? "border-orange-700 bg-orange-950 text-orange-300"
              : "border-slate-700 bg-slate-900 text-slate-300";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${cls}`}>{label}</span>;
}

function StrategySnapshotCell({
  mode,
  summary,
  isPlaceholderValuation
}: {
  mode: StrategyMode;
  summary: StrategyPreviewSummary | undefined;
  isPlaceholderValuation: boolean;
}) {
  const net = summary?.netExpectedBenefitUsd ?? 0;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
      <MetricRow label="mode" value={mode} />
      <MetricRow label="market" value={summary?.marketState ?? "-"} />
      <MetricRow
        label="should rebalance"
        value={summary?.shouldRebalance ? <StatusBadge status="REBALANCE_TRUE" /> : "NO"}
      />
      <MetricRow label="urgency" value={summary?.urgency ?? "-"} />
      <MetricRow
        label="net benefit"
        value={
          <span className="flex items-center gap-2">
            <StatusBadge status={net < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />
            <span>${net.toFixed(2)}</span>
          </span>
        }
      />
      <MetricRow label="strategy freshness" value={<FreshnessBadge stale={summary?.stale ?? false} />} />
      <MetricRow label="generatedAt" value={<TimestampWithAge iso={summary?.generatedAt ?? ""} />} />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-xs text-slate-400">quality:</span>
        <DataQualityBadge quality="exact" />
        <DataQualityBadge quality={isPlaceholderValuation ? "placeholder" : "estimated"} />
      </div>
    </div>
  );
}
