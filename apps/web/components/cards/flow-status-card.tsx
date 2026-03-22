"use client";

import { MetricRow } from "@/components/ui/metric-row";

interface Props<TStep extends string> {
  title?: string;
  steps: TStep[];
  statusByStep: Record<TStep, "idle" | "in_progress" | "done" | "error">;
}

export function FlowStatusCard<TStep extends string>({
  title = "フロー状態",
  steps,
  statusByStep
}: Props<TStep>) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step}>
            <MetricRow label={step} value={<StatusText status={statusByStep[step]} />} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusText({ status }: { status: "idle" | "in_progress" | "done" | "error" }) {
  const cls =
    status === "done"
      ? "text-green-300"
      : status === "error"
        ? "text-red-300"
        : status === "in_progress"
          ? "text-yellow-300"
          : "text-slate-300";
  return <span className={cls}>{status}</span>;
}
