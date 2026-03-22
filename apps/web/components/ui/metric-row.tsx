"use client";

import type { ReactNode } from "react";

export function MetricRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm text-slate-100">{value}</span>
    </div>
  );
}
