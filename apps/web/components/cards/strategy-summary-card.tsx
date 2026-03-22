"use client";

import { Card } from "@/components/ui/card";
import { MetricRow } from "@/components/ui/metric-row";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StrategyPreviewSummary } from "@/lib/strategy/types";

interface Props {
  title: string;
  summary: StrategyPreviewSummary | null;
}

export function StrategySummaryCard({ title, summary }: Props) {
  if (!summary) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-100">{title}</p>
        </div>
        <div className="mt-3 space-y-2">
          <MetricRow label="status" value="No strategy preview loaded" />
        </div>
      </Card>
    );
  }
  const urgencyCls =
    summary.urgency === "HIGH"
      ? "border border-red-800 bg-red-950 text-red-300"
      : summary.urgency === "MEDIUM"
        ? "border border-yellow-800 bg-yellow-950 text-yellow-300"
        : "border border-slate-700 bg-slate-800 text-slate-300";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-100">{title}</p>
      </div>
      <div className="mt-3 space-y-2">
        <MetricRow label="market" value={summary.marketState} />
        <MetricRow label="urgency" value={<span className={`rounded px-2 py-0.5 text-xs ${urgencyCls}`}>{summary.urgency}</span>} />
        <MetricRow label="should rebalance" value={summary.shouldRebalance ? <StatusBadge status="REBALANCE_TRUE" /> : "NO"} />
        <MetricRow
          label="net expected benefit"
          value={
            <span className="flex items-center gap-2">
              <StatusBadge status={summary.netExpectedBenefitUsd < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />
              <span>${summary.netExpectedBenefitUsd.toFixed(2)}</span>
            </span>
          }
        />
      </div>
      <div className="mt-4 border-t border-slate-800 pt-3">
        <p className="text-xs text-slate-400">Explainability: decisionはheuristicであり、実行前にPreview/Confirmで再確認してください。</p>
      </div>
    </Card>
  );
}
