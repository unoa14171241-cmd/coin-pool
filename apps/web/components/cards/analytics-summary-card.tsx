"use client";

import { Card } from "@/components/ui/card";
import { DataQualityBadge } from "@/components/data-quality-badge";
import { MetricRow } from "@/components/ui/metric-row";

interface Props {
  title: string;
  value: string;
  quality?: "exact" | "estimated" | "heuristic" | "placeholder";
  hint?: string;
  tone?: "default" | "warning" | "danger";
}

export function AnalyticsSummaryCard({ title, value, quality = "estimated", hint, tone = "default" }: Props) {
  const toneClass =
    tone === "danger"
      ? "border-red-800 bg-red-950"
      : tone === "warning"
        ? "border-yellow-800 bg-yellow-950"
        : "";
  return (
    <Card className={toneClass}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-100">{title}</p>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-semibold text-slate-100">{value}</p>
      </div>
      <div className="mt-3 space-y-2">
        <MetricRow label="quality" value={<DataQualityBadge quality={quality} />} />
      </div>
      {(hint ?? "").length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-400">{hint}</p>
        </div>
      )}
    </Card>
  );
}
