"use client";

import { Card } from "@/components/ui/card";
import { MetricRow } from "@/components/ui/metric-row";
import { StatusBadge } from "@/components/ui/status-badge";

interface Props {
  estimatedGasCostUsd?: number | null;
  expectedFeeImprovementUsd?: number | null;
  netExpectedBenefitUsd?: number | null;
  shouldRebalance?: boolean;
  urgency?: string | null;
  expectedRangeExitProbability?: number | null;
  estimatedLostFeesIfWaitUsd?: number | null;
  breakEvenHorizon?: string | null;
}

function usd(value?: number | null, signed = false) {
  if (value == null) return "not available";
  return `${signed && value >= 0 ? "+" : ""}$${value.toFixed(2)}`;
}

export function RebalanceCostSimulator({
  estimatedGasCostUsd,
  expectedFeeImprovementUsd,
  netExpectedBenefitUsd,
  shouldRebalance,
  urgency,
  expectedRangeExitProbability,
  estimatedLostFeesIfWaitUsd,
  breakEvenHorizon
}: Props) {
  const isNegative = (netExpectedBenefitUsd ?? 0) < 0;
  return (
    <Card className={isNegative ? "border-red-800 bg-red-950" : ""}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-100">Rebalance Cost Simulator</p>
      </div>
      <div className="mt-3 space-y-2">
        <MetricRow label="if rebalance now / estimated gas" value={usd(estimatedGasCostUsd)} />
        <MetricRow label="if rebalance now / expected fee improvement" value={usd(expectedFeeImprovementUsd, true)} />
        <MetricRow
          label="if rebalance now / net expected benefit"
          value={
            <span className="flex items-center gap-2">
              {netExpectedBenefitUsd == null ? null : <StatusBadge status={netExpectedBenefitUsd < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />}
              <span>{usd(netExpectedBenefitUsd, true)}</span>
            </span>
          }
        />
        <MetricRow
          label="if rebalance now / should rebalance"
          value={shouldRebalance == null ? "not available" : shouldRebalance ? <StatusBadge status="REBALANCE_TRUE" /> : "NO"}
        />
        <MetricRow label="if rebalance now / urgency" value={urgency ?? "not available"} />
        <MetricRow
          label="if wait / range exit probability"
          value={expectedRangeExitProbability == null ? "not available" : `${(expectedRangeExitProbability * 100).toFixed(1)}%`}
        />
        <MetricRow label="if wait / estimated lost fees" value={usd(estimatedLostFeesIfWaitUsd)} />
        <MetricRow label="if wait / break-even horizon" value={breakEvenHorizon ?? "not available"} />
      </div>
      {shouldRebalance === false && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="text-xs text-yellow-300">Current signal is conservative: waiting may be preferable right now.</p>
        </div>
      )}
    </Card>
  );
}
