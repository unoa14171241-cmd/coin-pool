"use client";

import { useMemo, useState } from "react";
import type { DailyProfitItem } from "@/hooks/use-daily-profit";

type Period = "7d" | "14d" | "30d";

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "14d": 14, "30d": 30 };

interface Props {
  daily: DailyProfitItem[];
  quality: "estimated" | "placeholder";
  isLoading?: boolean;
}

export function DailyProfitChart({ daily, quality, isLoading }: Props) {
  const [period, setPeriod] = useState<Period>("30d");
  const [metric, setMetric] = useState<"totalFeesUsd" | "totalPnlUsd" | "estimatedIlUsd">("totalFeesUsd");

  const sliced = useMemo(() => {
    const n = PERIOD_DAYS[period];
    return daily.slice(-n);
  }, [daily, period]);

  const { maxVal, getVal } = useMemo(() => {
    const getVal = (d: DailyProfitItem) =>
      metric === "totalFeesUsd"
        ? d.totalFeesUsd
        : metric === "totalPnlUsd"
          ? Math.abs(d.totalPnlUsd)
          : d.estimatedIlUsd;
    const maxVal =
      sliced.length === 0 ? 1 : Math.max(1, ...sliced.map(getVal));
    return { maxVal, getVal };
  }, [sliced, metric]);

  const label =
    metric === "totalFeesUsd"
      ? "Estimated Fees (USD)"
      : metric === "totalPnlUsd"
        ? "Estimated PnL (USD)"
        : "Estimated IL (USD)";

  const metricHint =
    metric === "totalFeesUsd"
      ? "各日時点の未収集手数料合計（累積スナップショット）"
      : metric === "totalPnlUsd"
        ? "各日時点の推定損益合計（累積スナップショット）"
        : "各日時点の推定IL合計（累積スナップショット）";

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <p className="text-sm font-semibold text-slate-300">Daily Snapshot Trend</p>
        <p className="mt-2 text-slate-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-200">Daily Snapshot Trend</p>
        <div className="flex gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
          >
            <option value="7d">7 days</option>
            <option value="14d">14 days</option>
            <option value="30d">30 days</option>
          </select>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as typeof metric)}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
            title="各日時点の累積/スナップショット値"
          >
            <option value="totalFeesUsd">Fees (累積)</option>
            <option value="totalPnlUsd">PnL (累積)</option>
            <option value="estimatedIlUsd">IL (累積)</option>
          </select>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {label} · Quality: {quality}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{metricHint}</p>
      {sliced.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No snapshot data for the selected period.</p>
      ) : (
        <div className="mt-4 flex h-32 items-end gap-0.5">
          {sliced.map((d) => {
            const val = getVal(d);
            const h = maxVal > 0 ? (val / maxVal) * 100 : 0;
            return (
              <div
                key={d.date}
                className="group flex flex-1 flex-col items-center"
                title={
                  metric === "totalPnlUsd"
                    ? `${d.date}: $${d.totalPnlUsd.toFixed(2)}`
                    : `${d.date}: $${val.toFixed(2)}`
                }
              >
                <div
                  className={`w-full min-w-[4px] rounded-t transition-all ${
                    metric === "totalPnlUsd"
                      ? d.totalPnlUsd >= 0
                        ? "bg-emerald-600"
                        : "bg-red-600"
                      : metric === "estimatedIlUsd"
                        ? "bg-amber-600"
                        : "bg-sky-600"
                  }`}
                  style={{ height: `${Math.max(2, h)}%` }}
                />
              </div>
            );
          })}
        </div>
      )}
      {sliced.length > 0 && (
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>{sliced[0]?.date}</span>
          <span>{sliced[sliced.length - 1]?.date}</span>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        各日時点のスナップショット推移（日次差分ではない）。PositionSnapshot ベースの推定値。保証なし。
      </p>
    </div>
  );
}
