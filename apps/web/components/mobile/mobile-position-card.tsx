"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MetricRow } from "@/components/ui/metric-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataQualityBadge, FreshnessBadge } from "@/components/data-quality-badge";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import type { LpPosition } from "@/lib/types";
import type { StrategyMode, StrategyPreviewSummary } from "@/lib/strategy/types";

interface Props {
  position: LpPosition;
  mode: StrategyMode;
  summary?: StrategyPreviewSummary;
  isCollecting: boolean;
  isRebalancing: boolean;
  isLoadingPreview: boolean;
  collectDisabled?: boolean;
  rebalanceDisabled?: boolean;
  actionBlockedReason?: string | null;
  onModeChange: (mode: StrategyMode) => void;
  onPreview: () => void;
  onCollect: () => void;
  onReviewExecute: () => void;
}

export function MobilePositionCard({
  position,
  mode,
  summary,
  isCollecting,
  isRebalancing,
  isLoadingPreview,
  collectDisabled = false,
  rebalanceDisabled = false,
  actionBlockedReason = null,
  onModeChange,
  onPreview,
  onCollect,
  onReviewExecute
}: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100">
      <p className="text-sm font-semibold">
        {position.token0Symbol}/{position.token1Symbol}
      </p>
      <div className="mt-2 space-y-2">
        <MetricRow label="fee tier" value={position.feeTier} />
        <MetricRow label="current price" value={position.currentPrice ?? "price unavailable"} />
        <MetricRow label="current tick" value={position.currentTick} />
        <MetricRow label="status" value={<StatusBadge status={position.computedStatus === "IN_RANGE" ? "IN_RANGE" : "OUT_OF_RANGE"} />} />
        <MetricRow label="estimated value" value={`$${position.valueUsd.toFixed(2)}`} />
        <MetricRow label="estimated fees" value={`$${position.uncollectedFeesUsd.toFixed(2)}`} />
        <MetricRow label="estimated pnl" value={`$${position.valueUsd.toFixed(2)}`} />
        <MetricRow label="strategy mode" value={mode} />
        <MetricRow label="market state" value={summary?.marketState ?? "-"} />
        <MetricRow label="should rebalance" value={summary?.shouldRebalance ? <StatusBadge status="REBALANCE_TRUE" /> : "NO"} />
        <MetricRow label="urgency" value={summary?.urgency ?? "-"} />
        <MetricRow
          label="net expected benefit"
          value={
            summary == null ? (
              "n/a"
            ) : (
              <span className="flex items-center gap-2">
                <StatusBadge status={summary.netExpectedBenefitUsd < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />
                <span>${summary.netExpectedBenefitUsd.toFixed(2)}</span>
              </span>
            )
          }
        />
        {position.sync && (
          <>
            <MetricRow label="sync status" value={position.sync.status} />
            <MetricRow
              label="last sync"
              value={
                position.sync.lastSuccessAt ? (
                  <TimestampWithAge iso={position.sync.lastSuccessAt} compact />
                ) : position.sync.lastAttemptAt ? (
                  <TimestampWithAge iso={position.sync.lastAttemptAt} compact />
                ) : (
                  "never"
                )
              }
            />
          </>
        )}
      </div>
      <div className="mt-3 flex items-center gap-1">
        <DataQualityBadge quality="exact" />
        <DataQualityBadge quality={position.isPlaceholderValuation ? "placeholder" : "estimated"} />
        <FreshnessBadge stale={summary?.stale ?? false} />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        generatedAt: <TimestampWithAge iso={summary?.generatedAt ?? ""} compact />
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button size="sm" variant={mode === "CONSERVATIVE" ? "default" : "outline"} onClick={() => onModeChange("CONSERVATIVE")}>
          C
        </Button>
        <Button size="sm" variant={mode === "BALANCED" ? "default" : "outline"} onClick={() => onModeChange("BALANCED")}>
          B
        </Button>
        <Button size="sm" variant={mode === "AGGRESSIVE" ? "default" : "outline"} onClick={() => onModeChange("AGGRESSIVE")}>
          A
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" disabled={isLoadingPreview} onClick={onPreview}>
          {isLoadingPreview ? "Loading..." : "Preview"}
        </Button>
        <Button size="sm" variant="outline" disabled={collectDisabled || isCollecting} onClick={onCollect}>
          {isCollecting ? "Collecting..." : "Collect"}
        </Button>
        <Button size="sm" disabled={rebalanceDisabled || isRebalancing} onClick={onReviewExecute}>
          {isRebalancing ? "Rebalancing..." : "Review & Execute"}
        </Button>
        <Link className="inline-flex h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-xs" href={`/positions/${position.id}`}>
          Detail
        </Link>
      </div>
      {actionBlockedReason ? <p className="mt-2 text-xs text-amber-300">{actionBlockedReason}</p> : null}
    </div>
  );
}
