"use client";

type Quality = "exact" | "estimated" | "heuristic" | "placeholder";

export function DataQualityBadge({ quality }: { quality: Quality }) {
  const style =
    quality === "exact"
      ? "bg-green-950 text-green-300 border border-green-800"
      : quality === "estimated"
        ? "bg-blue-950 text-blue-300 border border-blue-800"
        : quality === "heuristic"
          ? "bg-slate-800 text-slate-200 border border-slate-700"
          : "bg-yellow-950 text-yellow-300 border border-yellow-800";
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${style}`}>{quality.toUpperCase()}</span>;
}

export function FreshnessBadge({ stale, state }: { stale: boolean; state?: "LIVE" | "FRESH" | "STALE" | "VERY_STALE" }) {
  const resolved = state ?? (stale ? "STALE" : "FRESH");
  const classes =
    resolved === "LIVE" || resolved === "FRESH"
      ? "bg-green-950 text-green-300 border border-green-800"
      : resolved === "VERY_STALE"
        ? "bg-red-950 text-red-300 border border-red-800"
        : "bg-yellow-950 text-yellow-300 border border-yellow-800";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${classes}`}>{resolved.replace("_", " ")}</span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const cls =
    source === "rpc"
      ? "bg-blue-950 text-blue-300 border border-blue-800"
      : source === "cache"
        ? "bg-slate-800 text-slate-200 border border-slate-700"
        : source === "fallback"
          ? "bg-yellow-950 text-yellow-300 border border-yellow-800"
          : "bg-slate-800 text-slate-200 border border-slate-700";
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{source.toUpperCase()}</span>;
}
