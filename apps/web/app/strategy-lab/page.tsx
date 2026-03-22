"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { usePositions } from "@/hooks/use-positions";
import { usePositionHistory } from "@/hooks/use-position-history";
import { fetchRebalancePreview, toStrategyPreviewSummary } from "@/lib/strategy/client";
import type { StrategyMode, StrategyPreviewSummary } from "@/lib/strategy/types";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { SectionHeader } from "@/components/ui/section-header";
import { WarningBox } from "@/components/ui/warning-box";
import { DataQualityBadge } from "@/components/data-quality-badge";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { useStrategies } from "@/hooks/use-strategies";

const MODES: StrategyMode[] = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"];

export default function StrategyLabPage() {
  const { address } = useAccount();
  const strategiesQuery = useStrategies({ enabled: true });
  const { data } = usePositions(address);
  const positions = data ?? [];
  const [positionId, setPositionId] = useState<string>("");
  const [resultByMode, setResultByMode] = useState<Record<StrategyMode, StrategyPreviewSummary | null>>({
    CONSERVATIVE: null,
    BALANCED: null,
    AGGRESSIVE: null
  });
  const selected = useMemo(() => positions.find((p) => p.id === positionId) ?? positions[0], [positions, positionId]);
  const [widthPercent, setWidthPercent] = useState(10);
  const [rebalanceThresholdUsd, setRebalanceThresholdUsd] = useState(0);
  const [simulatedGasUsd, setSimulatedGasUsd] = useState(5);
  const historyQuery = usePositionHistory(address as `0x${string}` | undefined, selected?.id);
  const history = historyQuery.data ?? [];
  const historySummary = useMemo(() => {
    if (history.length === 0) {
      return {
        sampleCount: 0,
        staleRatio: 0,
        avgApr: null as number | null,
        realizedPnlProxy: null as number | null,
        from: null as string | null,
        to: null as string | null
      };
    }
    const staleCount = history.filter((p) => p.staleFlag).length;
    const aprValues = history.map((p) => p.estimatedApr).filter((v): v is number => typeof v === "number");
    const first = history[history.length - 1];
    const last = history[0];
    const firstPnl = first?.estimatedPnlUsd ?? null;
    const lastPnl = last?.estimatedPnlUsd ?? null;
    return {
      sampleCount: history.length,
      staleRatio: staleCount / history.length,
      avgApr: aprValues.length > 0 ? aprValues.reduce((a, b) => a + b, 0) / aprValues.length : null,
      realizedPnlProxy: firstPnl != null && lastPnl != null ? Number((lastPnl - firstPnl).toFixed(2)) : null,
      from: first?.snapshotAt ?? null,
      to: last?.snapshotAt ?? null
    };
  }, [history]);

  return (
    <section className="mx-auto max-w-7xl bg-slate-950 px-6 py-8 text-slate-100">
      <h1 className="text-2xl font-bold">Strategy Lab</h1>
      <SectionHeader title="Mode Comparison & Simulation" description="Conservative / Balanced / Aggressive の比較と閾値試算を行います。" />
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-sm font-semibold">Template Strategies</p>
        {strategiesQuery.isLoading ? <p className="mt-2 text-slate-400">loading templates...</p> : null}
        {strategiesQuery.isError ? (
          <p className="mt-2 text-red-300">{strategiesQuery.error instanceof Error ? strategiesQuery.error.message : "template load failed"}</p>
        ) : null}
        {strategiesQuery.data && strategiesQuery.data.length > 0 ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {strategiesQuery.data.slice(0, 6).map((item) => (
              <div key={item.strategyId} className="rounded border border-slate-800 bg-slate-950 p-2 text-xs">
                <p className="font-semibold text-slate-200">{item.strategyName}</p>
                <p className="text-slate-400">
                  {item.tokenA}/{item.tokenB} @ {item.poolFeeTier}bps
                </p>
                <p className="mt-1 text-slate-400">risk: {item.riskLevel} / mode: {item.rangeMode}</p>
                {item.targetAPRNote ? <p className="mt-1 text-slate-500">APR note: {item.targetAPRNote}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-sm font-semibold">A. Mode Comparison</p>
        <select
          className="mt-2 rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
          value={selected?.id ?? ""}
          onChange={(e) => setPositionId(e.target.value)}
        >
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.token0Symbol}/{p.token1Symbol} #{p.id}
            </option>
          ))}
        </select>
        <button
          className="ml-2 rounded bg-blue-600 px-3 py-2 text-white hover:bg-blue-500"
          onClick={async () => {
            if (!address || !selected) return;
            const updates = await Promise.all(
              MODES.map(async (mode) => {
                try {
                  const res = await fetchRebalancePreview({
                    wallet: address,
                    positionId: selected.id,
                    body: { mode }
                  });
                  return [mode, toStrategyPreviewSummary(res)] as const;
                } catch {
                  return [mode, null] as const;
                }
              })
            );
            setResultByMode({
              CONSERVATIVE: updates.find((x) => x[0] === "CONSERVATIVE")?.[1] ?? null,
              BALANCED: updates.find((x) => x[0] === "BALANCED")?.[1] ?? null,
              AGGRESSIVE: updates.find((x) => x[0] === "AGGRESSIVE")?.[1] ?? null
            });
          }}
        >
          Compare 3 Modes
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {MODES.map((mode) => {
          const r = resultByMode[mode];
          return (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm" key={mode}>
              <p className="text-sm font-semibold">{mode}</p>
              {!r && <p className="mt-2 text-slate-400">No data.</p>}
              {r && (
                <div className="mt-2 space-y-1">
                  <p>suggested width: tick {r.suggestedTickLower} - {r.suggestedTickUpper}</p>
                  <p>expected rebalance frequency: heuristic</p>
                  <p>expected gas burden: ${r.estimatedGasCostUsd.toFixed(2)}</p>
                  <p>expected fee capture efficiency: heuristic</p>
                  <p>expected net benefit: ${r.netExpectedBenefitUsd.toFixed(2)}</p>
                  <p>confidence: {Math.max(0, Math.min(100, Math.round((r.explanationLines.length / 5) * 100)))}%</p>
                  <p>rationale lines:</p>
                  {r.explanationLines.slice(0, 3).map((line) => (
                    <p key={line}>- {line}</p>
                  ))}
                  <p>
                    generatedAt: <TimestampWithAge iso={r.generatedAt} />
                  </p>
                  <div className="mt-2 flex gap-2">
                    <DataQualityBadge quality={r.quality?.decision ?? "heuristic"} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
          <p className="text-sm font-semibold">B/C/D. Simulation</p>
          <label className="mt-2 block text-xs text-slate-400">
            Width simulation (%)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
              type="range"
              min={2}
              max={30}
              value={widthPercent}
              onChange={(e) => setWidthPercent(Number(e.target.value))}
            />
          </label>
          <p>Selected width: {widthPercent}%</p>
          <label className="mt-2 block text-xs text-slate-400">
            Rebalance threshold simulation (USD)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
              type="number"
              value={rebalanceThresholdUsd}
              onChange={(e) => setRebalanceThresholdUsd(Number(e.target.value))}
            />
          </label>
          <label className="mt-2 block text-xs text-slate-400">
            Gas burden simulation (USD)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
              type="number"
              value={simulatedGasUsd}
              onChange={(e) => setSimulatedGasUsd(Number(e.target.value))}
            />
          </label>
          <p className="mt-2">Simulated trigger condition: netExpectedBenefitUsd - gas &gt; {rebalanceThresholdUsd.toFixed(2)}</p>
          <p>Simulated gas burden: ${simulatedGasUsd.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
          <p className="text-sm font-semibold">E/F. Historical Backtest</p>
          {historySummary.sampleCount === 0 && <p className="mt-2 text-slate-400">No snapshot history data yet.</p>}
          {historySummary.sampleCount > 0 && (
            <div className="mt-2 space-y-1">
              <p>samples: {historySummary.sampleCount}</p>
              <p>window: {historySummary.from ? <TimestampWithAge iso={historySummary.from} /> : "-"} - {historySummary.to ? <TimestampWithAge iso={historySummary.to} /> : "-"}</p>
              <p>realized pnl proxy: {historySummary.realizedPnlProxy == null ? "n/a" : `$${historySummary.realizedPnlProxy.toFixed(2)}`}</p>
              <p>avg apr proxy: {historySummary.avgApr == null ? "n/a" : `${historySummary.avgApr.toFixed(2)}%`}</p>
              <p>stale ratio: {(historySummary.staleRatio * 100).toFixed(1)}%</p>
              <p className="pt-2 font-medium">mode-adjusted annual proxy</p>
              <p>Conservative: {historySummary.avgApr == null ? "n/a" : `${(historySummary.avgApr * 0.85).toFixed(2)}%`}</p>
              <p>Balanced: {historySummary.avgApr == null ? "n/a" : `${historySummary.avgApr.toFixed(2)}%`}</p>
              <p>Aggressive: {historySummary.avgApr == null ? "n/a" : `${(historySummary.avgApr * 1.15).toFixed(2)}%`}</p>
            </div>
          )}
        </div>
      </div>
      <WarningBox
        type="INFO"
        title="Lab Policy"
        description="Strategy Lab は判断支援の研究画面です。シミュレーション値は推定であり、実運用前に Preview/Confirm で再確認してください。"
        className="mt-6"
      />
      <RiskDisclosure />
    </section>
  );
}
