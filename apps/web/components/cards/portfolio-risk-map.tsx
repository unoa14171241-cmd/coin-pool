"use client";

import { Card } from "@/components/ui/card";
import { MetricRow } from "@/components/ui/metric-row";

interface DistributionItem {
  label: string;
  value: number;
}

interface Props {
  chainDistribution: DistributionItem[];
  tokenPairDistribution: DistributionItem[];
  poolDistribution: DistributionItem[];
  strategyDistribution: DistributionItem[];
  concentrationRiskPercent: number;
  aggressiveRangePercent: number;
  outOfRangeSharePercent: number;
  highVolatilityExposurePercent: number;
  suggestions: string[];
}

function Meter({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone = clamped >= 70 ? "bg-red-500" : clamped >= 40 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-300">{label}: {clamped.toFixed(1)}%</p>
      <div className="h-2 rounded bg-slate-800">
        <div className={`h-2 rounded ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function Dist({ title, items }: { title: string; items: DistributionItem[] }) {
  return (
    <div>
      <p className="font-medium text-slate-100">{title}</p>
      <div className="mt-1 space-y-1 text-xs text-slate-300">
        {items.length === 0 && <p>not available</p>}
        {items.map((item) => (
          <MetricRow key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
    </div>
  );
}

export function PortfolioRiskMap({
  chainDistribution,
  tokenPairDistribution,
  poolDistribution,
  strategyDistribution,
  concentrationRiskPercent,
  aggressiveRangePercent,
  outOfRangeSharePercent,
  highVolatilityExposurePercent,
  suggestions
}: Props) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-100">Portfolio Risk Map</p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Dist title="Chain distribution" items={chainDistribution} />
        <Dist title="Token pair distribution" items={tokenPairDistribution} />
        <Dist title="Pool distribution" items={poolDistribution} />
        <Dist title="Strategy mode distribution" items={strategyDistribution} />
      </div>
      <div className="mt-3 space-y-2">
        <Meter label="Concentration risk" value={concentrationRiskPercent} />
        <Meter label="Aggressive range concentration" value={aggressiveRangePercent} />
        <Meter label="Out-of-range share" value={outOfRangeSharePercent} />
        <Meter label="High volatility exposure" value={highVolatilityExposurePercent} />
      </div>
      <div className="mt-4 border-t border-slate-800 pt-3 text-sm text-yellow-300">
        <p className="font-medium text-slate-100">Risk Alerts / Suggestions</p>
        {suggestions.length === 0 && <p className="text-slate-300">No major alerts detected.</p>}
        {suggestions.map((item) => (
          <p key={item}>⚠ {item}</p>
        ))}
      </div>
    </Card>
  );
}
