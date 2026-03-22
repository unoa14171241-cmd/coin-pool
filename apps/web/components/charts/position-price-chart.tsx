"use client";

import { useMemo, useState } from "react";
import type { PricePoint } from "@/lib/price-utils";
import { getRangePrices, formatPriceSummary } from "@/lib/price-utils";
import { StatusBadge } from "@/components/ui/status-badge";

export type ChartPeriod = "1D" | "1W" | "1M" | "1Y" | "All";

const PERIOD_MS: Record<ChartPeriod, number | null> = {
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
  "1Y": 365 * 24 * 60 * 60 * 1000,
  All: null
};

interface Props {
  /** Price history (oldest first recommended) */
  pricePoints: PricePoint[];
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  currentPrice: number | null;
  token0Symbol: string;
  token1Symbol: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
}

export function PositionPriceChart({
  pricePoints,
  tickLower,
  tickUpper,
  currentTick,
  currentPrice,
  token0Symbol,
  token1Symbol,
  isLoading = false,
  isError = false,
  errorMessage
}: Props) {
  const [period, setPeriod] = useState<ChartPeriod>("1W");

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = PERIOD_MS[period];
    if (cutoff == null) return pricePoints;
    const since = now - cutoff;
    return pricePoints.filter((p) => new Date(p.timestamp).getTime() >= since);
  }, [pricePoints, period]);

  const rangePrices = useMemo(
    () =>
      getRangePrices({
        tickLower,
        tickUpper,
        currentTick,
        currentPrice
      }),
    [tickLower, tickUpper, currentTick, currentPrice]
  );

  const inRange = currentTick >= tickLower && currentTick < tickUpper;

  const { minY, maxY, padding } = useMemo(() => {
    const prices = filtered
      .map((p) => p.price)
      .filter((v) => v != null && v > 0 && Number.isFinite(v));
    const curr = currentPrice ?? 0;
    const rangeMin = rangePrices?.minPrice ?? 0;
    const rangeMax = rangePrices?.maxPrice ?? 0;
    const all = [...prices, curr, rangeMin, rangeMax].filter((v) => v > 0);
    if (all.length === 0) return { minY: 0, maxY: 1, padding: 0.1 };
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = Math.max(max - min, min * 0.01);
    const pad = span * 0.08;
    return {
      minY: Math.max(0, min - pad),
      maxY: max + pad,
      padding: 0.08
    };
  }, [filtered, currentPrice, rangePrices]);

  const chartHeight = 200;
  const chartWidth = 600;
  const margin = { top: 12, right: 12, bottom: 12, left: 12 };

  const toY = (price: number) => {
    if (maxY <= minY) return chartHeight / 2;
    const p = (price - minY) / (maxY - minY);
    return margin.top + (1 - p) * (chartHeight - margin.top - margin.bottom);
  };

  const toX = (i: number) => {
    if (filtered.length <= 1) return margin.left + (chartWidth - margin.left - margin.right) / 2;
    const t = filtered.length - 1;
    return margin.left + (i / t) * (chartWidth - margin.left - margin.right);
  };

  const pricePath = useMemo(() => {
    if (filtered.length === 0) return "";
    const valid = filtered
      .map((p, i) => ({ ...p, i }))
      .filter((p) => p.price > 0 && Number.isFinite(p.price));
    if (valid.length === 0) return "";
    return valid
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${toX(p.i).toFixed(2)} ${toY(p.price).toFixed(2)}`)
      .join(" ");
  }, [filtered, minY, maxY]);

  const rangeBandPath =
    rangePrices != null && maxY > minY
      ? `M ${margin.left} ${toY(rangePrices.maxPrice)} L ${chartWidth - margin.right} ${toY(rangePrices.maxPrice)} L ${chartWidth - margin.right} ${toY(rangePrices.minPrice)} L ${margin.left} ${toY(rangePrices.minPrice)} Z`
      : null;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">Price Chart</p>
        </div>
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg bg-slate-800/50">
          <p className="text-sm text-slate-500">Loading price data...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">Price Chart</p>
        </div>
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg border border-red-900/50 bg-red-950/20">
          <p className="text-sm text-red-400">{errorMessage ?? "Failed to load price data"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-200">
            {token0Symbol} / {token1Symbol}
          </p>
          <StatusBadge
            status={inRange ? "IN_RANGE" : "OUT_OF_RANGE"}
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800/80 p-0.5">
          {(["1D", "1W", "1M", "1Y", "All"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-2 py-1 text-xs font-medium transition ${
                period === p
                  ? "bg-slate-600 text-white"
                  : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-800/30">
          <p className="text-sm text-slate-500">No price data for the selected period</p>
          <p className="mt-1 text-xs text-slate-600">
            Sync the position to populate snapshot history
          </p>
        </div>
      ) : (
        <>
          <div className="relative mt-3 overflow-hidden rounded-lg">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
              className="w-full max-w-full"
              preserveAspectRatio="xMidYMid meet"
              style={{ minHeight: 220 }}
            >
              <defs>
                <linearGradient id="rangeBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(148 163 184)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="rgb(148 163 184)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="priceLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgb(96 165 250)" />
                  <stop offset="100%" stopColor="rgb(147 51 234)" />
                </linearGradient>
              </defs>
              <g transform={`translate(0, 0)`}>
                {rangeBandPath && (
                  <path
                    d={rangeBandPath}
                    fill="url(#rangeBand)"
                    stroke="rgb(148 163 184)"
                    strokeWidth="0.5"
                    strokeOpacity={0.3}
                  />
                )}
                {pricePath && (
                  <path
                    d={pricePath}
                    fill="none"
                    stroke="url(#priceLine)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {currentPrice != null &&
                  currentPrice > 0 &&
                  rangePrices != null &&
                  currentPrice >= minY &&
                  currentPrice <= maxY && (
                    <line
                      x1={margin.left}
                      y1={toY(currentPrice)}
                      x2={chartWidth - margin.right}
                      y2={toY(currentPrice)}
                      stroke="rgb(34 197 94)"
                      strokeWidth="1"
                      strokeDasharray="4 4"
                      opacity={0.9}
                    />
                  )}
              </g>
            </svg>
            {currentPrice != null && currentPrice > 0 && (
              <div className="absolute right-4 top-4 rounded bg-slate-900/90 px-2 py-1 text-right">
                <p className="text-xs text-slate-400">Current</p>
                <p className="text-sm font-semibold text-emerald-400">
                  {formatPriceSummary(currentPrice)} {token1Symbol}
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-700/80 bg-slate-800/50 px-4 py-3">
            <div>
              <p className="text-xs text-slate-500">Min price</p>
              <p className="text-sm font-medium text-slate-200">
                {rangePrices != null
                  ? `${formatPriceSummary(rangePrices.minPrice)} ${token1Symbol}`
                  : "—"}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500">Current price</p>
              <p className="text-sm font-semibold text-emerald-400">
                {currentPrice != null && currentPrice > 0
                  ? `${formatPriceSummary(currentPrice)} ${token1Symbol}`
                  : "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Max price</p>
              <p className="text-sm font-medium text-slate-200">
                {rangePrices != null
                  ? `${formatPriceSummary(rangePrices.maxPrice)} ${token1Symbol}`
                  : "—"}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Price = {token1Symbol} per 1 {token0Symbol}. Gray band = your LP range. Data from PositionSnapshot.
          </p>
        </>
      )}
    </div>
  );
}
