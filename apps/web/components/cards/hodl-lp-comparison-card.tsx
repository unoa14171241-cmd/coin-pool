"use client";

/**
 * HODL vs LP Comparison Card
 * Displays the difference between holding assets vs LP position value.
 * IL (Impermanent Loss) = HODL value - LP value (the gap from simple holding).
 */
interface HodlLpComparisonCardProps {
  /** Current LP position value (USD) */
  lpValueUsd: number | null;
  /** Estimated impermanent loss (USD). HODL value = lpValueUsd + estimatedIlUsd */
  estimatedIlUsd: number | null;
  /** Estimated IL percent (0-100) */
  estimatedIlPercent: number | null;
  /** Quality of the estimate */
  quality?: "placeholder" | "estimated" | "exact";
  /** Optional: compact mode for inline display */
  compact?: boolean;
}

export function HodlLpComparisonCard({
  lpValueUsd,
  estimatedIlUsd,
  estimatedIlPercent,
  quality = "estimated",
  compact = false
}: HodlLpComparisonCardProps) {
  const hodlValueUsd =
    lpValueUsd != null && estimatedIlUsd != null ? lpValueUsd + estimatedIlUsd : null;
  const hasData = lpValueUsd != null && hodlValueUsd != null;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-sm font-semibold text-slate-200">HODL Comparison</p>
        <p className="mt-2 text-slate-500">Price or position data unavailable for comparison.</p>
      </div>
    );
  }

  const gapUsd = estimatedIlUsd ?? 0;
  const gapLabel = gapUsd >= 0 ? "Estimated IL (HODL − LP)" : "LP premium vs HODL";

  if (compact) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs">
        <p className="font-semibold text-slate-200">HODL vs LP</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-400">
          <span>HODL value:</span>
          <span className="text-slate-200">${hodlValueUsd.toFixed(2)}</span>
          <span>LP value:</span>
          <span className="text-slate-200">${lpValueUsd.toFixed(2)}</span>
          <span>Gap (IL):</span>
          <span className={gapUsd >= 0 ? "text-amber-400" : "text-emerald-400"}>
            ${Math.abs(gapUsd).toFixed(2)} ({estimatedIlPercent != null ? `${estimatedIlPercent.toFixed(2)}%` : "—"})
          </span>
        </div>
        <p className="mt-2 text-slate-500">Quality: {quality}. Comparison only, not guaranteed.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
      <p className="text-sm font-semibold text-slate-200">HODL Comparison</p>
      <p className="mt-1 text-xs text-slate-500">
        Compare LP position value vs simple holding. The gap is estimated impermanent loss (IL).
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500">HODL value (estimated)</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">${hodlValueUsd.toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-slate-500">If you had held 50/50 without LP</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500">LP value (current)</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">${lpValueUsd.toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-slate-500">Current position value</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500">{gapLabel}</p>
          <p
            className={`mt-1 text-lg font-semibold ${gapUsd >= 0 ? "text-amber-400" : "text-emerald-400"}`}
          >
            ${Math.abs(gapUsd).toFixed(2)}
            {estimatedIlPercent != null && ` (${estimatedIlPercent.toFixed(2)}%)`}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Estimated Impermanent Loss</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Values are {quality}. This is a comparison metric, not a guarantee of future performance.
      </p>
    </div>
  );
}
