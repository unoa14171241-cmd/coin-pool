"use client";

import { Card } from "@/components/ui/card";
import { MetricRow } from "@/components/ui/metric-row";

interface Props {
  currentLowerTick: number;
  currentUpperTick: number;
  currentTick: number | null;
  currentPrice: number | null;
  proposedLowerTick?: number | null;
  proposedUpperTick?: number | null;
}

export function RangeVisualizer({
  currentLowerTick,
  currentUpperTick,
  currentTick,
  currentPrice,
  proposedLowerTick,
  proposedUpperTick
}: Props) {
  if (currentTick == null) {
    return (
      <Card>
        <p className="font-semibold">Range Visualizer</p>
        <p className="mt-2 text-sm text-slate-600">Current tick/price is unavailable.</p>
      </Card>
    );
  }

  const min = Math.min(currentLowerTick, proposedLowerTick ?? currentLowerTick, currentTick);
  const max = Math.max(currentUpperTick, proposedUpperTick ?? currentUpperTick, currentTick);
  const span = Math.max(1, max - min);

  const currentStart = ((currentLowerTick - min) / span) * 100;
  const currentEnd = ((currentUpperTick - min) / span) * 100;
  const currentPos = ((currentTick - min) / span) * 100;

  const proposedStart = proposedLowerTick != null ? ((proposedLowerTick - min) / span) * 100 : null;
  const proposedEnd = proposedUpperTick != null ? ((proposedUpperTick - min) / span) * 100 : null;

  const inRange = currentTick >= currentLowerTick && currentTick < currentUpperTick;

  return (
    <Card>
      <p className="font-semibold">Range Visualizer</p>
      <div className="mt-3 space-y-2 md:hidden">
        <MetricRow label="current range" value={`${currentLowerTick} - ${currentUpperTick}`} />
        <MetricRow label="current tick" value={`${currentTick} (${inRange ? "IN_RANGE" : "OUT_OF_RANGE"})`} />
        <MetricRow label="current price marker" value={currentPrice ?? "not available"} />
        {proposedLowerTick != null && proposedUpperTick != null && (
          <MetricRow label="proposed range" value={`${proposedLowerTick} - ${proposedUpperTick}`} />
        )}
        <div className="h-2 rounded bg-slate-800 relative overflow-hidden">
          <div className="absolute top-0 h-2 rounded bg-blue-500/80" style={{ left: `${currentStart}%`, width: `${Math.max(1, currentEnd - currentStart)}%` }} />
          {proposedStart != null && proposedEnd != null && (
            <div className="absolute top-0 h-2 rounded bg-green-500/70" style={{ left: `${proposedStart}%`, width: `${Math.max(1, proposedEnd - proposedStart)}%` }} />
          )}
          <div className="absolute top-0 h-2 w-0.5 bg-white" style={{ left: `${currentPos}%` }} />
        </div>
      </div>
      <div className="relative mt-3 hidden h-6 overflow-hidden rounded bg-slate-100 md:block">
        <div className="absolute top-1 h-4 rounded bg-slate-400/80" style={{ left: `${currentStart}%`, width: `${Math.max(1, currentEnd - currentStart)}%` }} />
        {proposedStart != null && proposedEnd != null && (
          <div className="absolute top-0.5 h-5 rounded border border-sky-700 bg-sky-300/40" style={{ left: `${proposedStart}%`, width: `${Math.max(1, proposedEnd - proposedStart)}%` }} />
        )}
        <div className="absolute top-0 h-6 w-0.5 bg-red-600" style={{ left: `${currentPos}%` }} />
      </div>
      <div className="mt-2 hidden space-y-1 text-xs text-slate-700 md:block">
        <p>Current range: {currentLowerTick} - {currentUpperTick}</p>
        <p>Current tick: {currentTick} ({inRange ? "IN_RANGE" : "OUT_OF_RANGE"})</p>
        <p>Current price: {currentPrice ?? "not available"}</p>
        {proposedLowerTick != null && proposedUpperTick != null && (
          <p>Proposed range: {proposedLowerTick} - {proposedUpperTick}</p>
        )}
      </div>
    </Card>
  );
}
