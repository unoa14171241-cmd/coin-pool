"use client";

import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { DataQualityBadge, FreshnessBadge } from "@/components/data-quality-badge";
import { MetricRow } from "@/components/ui/metric-row";
import type { ActivityItem } from "@/hooks/use-activity";
import { getExplorerTxUrl, shortTx } from "@/lib/explorer";

export function MobileActivityCard({ item }: { item: ActivityItem }) {
  const txUrl = getExplorerTxUrl(item.chainId, item.tx);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-100">
      <MetricRow label="event type" value={item.type} />
      <MetricRow label="position id" value={item.positionId ?? "-"} />
      <MetricRow label="source" value={item.source ?? "-"} />
      <MetricRow label="chain" value={item.chainId ?? "-"} />
      <MetricRow label="result" value={item.success === false ? "failed" : "success"} />
      <MetricRow label="timestamp" value={<TimestampWithAge iso={item.createdAt} compact />} />
      <MetricRow label="generatedAt" value={<TimestampWithAge iso={item.generatedAt} compact />} />
      <MetricRow
        label="tx hash"
        value={
          item.tx ? (
            txUrl ? (
              <a href={txUrl} target="_blank" rel="noreferrer" className="text-blue-300 underline-offset-2 hover:underline">
                {shortTx(item.tx)}
              </a>
            ) : (
              shortTx(item.tx)
            )
          ) : (
            "-"
          )
        }
      />
      <MetricRow label="short explanation" value={item.error ?? item.message} />
      <div className="mt-2 flex items-center gap-2">
        <DataQualityBadge quality={item.quality} />
        <FreshnessBadge stale={item.stale} />
      </div>
    </div>
  );
}

