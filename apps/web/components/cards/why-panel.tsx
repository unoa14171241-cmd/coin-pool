"use client";

import { Card } from "@/components/ui/card";
import { MetricRow } from "@/components/ui/metric-row";
import { StatusBadge } from "@/components/ui/status-badge";

interface Props {
  marketState?: string | null;
  strategyMode?: string | null;
  currentIssue: string;
  expectedOutcome: string;
  costUsd?: number | null;
  netExpectedBenefitUsd?: number | null;
  shouldRebalance?: boolean;
  explanationLines?: string[];
}

export function WhyPanel({
  marketState,
  strategyMode,
  currentIssue,
  expectedOutcome,
  costUsd,
  netExpectedBenefitUsd,
  shouldRebalance = true,
  explanationLines = []
}: Props) {
  const danger = (netExpectedBenefitUsd ?? 0) < 0;
  const warning = !shouldRebalance;
  const tone = danger ? "border-red-800 bg-red-950" : warning ? "border-yellow-800 bg-yellow-950" : "";

  return (
    <Card className={tone}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-100">{shouldRebalance ? "Why this recommendation?" : "Why rebalancing is NOT recommended"}</p>
      </div>
      <div className="mt-3 space-y-2">
        <MetricRow label="market state" value={marketState ?? "unknown"} />
        <MetricRow label="strategy mode" value={strategyMode ?? "unknown"} />
        <MetricRow label="current issue" value={currentIssue} />
        <MetricRow label="expected outcome" value={expectedOutcome} />
        <MetricRow label="cost" value={costUsd == null ? "not available" : `$${costUsd.toFixed(2)}`} />
        <MetricRow
          label="net expected benefit"
          value={
            netExpectedBenefitUsd == null ? (
              "not available"
            ) : (
              <span className="flex items-center gap-2">
                <StatusBadge status={netExpectedBenefitUsd < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />
                <span>{`${netExpectedBenefitUsd >= 0 ? "+" : ""}$${netExpectedBenefitUsd.toFixed(2)}`}</span>
              </span>
            )
          }
        />
      </div>
      {explanationLines.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3 text-sm text-slate-300">
          <p className="font-medium text-slate-100">Explanation</p>
          {explanationLines.slice(0, 3).map((line) => (
            <p key={line}>- {line}</p>
          ))}
        </div>
      )}
    </Card>
  );
}
