"use client";

type StatusType = "IN_RANGE" | "OUT_OF_RANGE" | "CRITICAL" | "REBALANCE_TRUE" | "POSITIVE_NET" | "NEGATIVE_NET";

export function StatusBadge({ status }: { status: StatusType }) {
  const style =
    status === "IN_RANGE" || status === "POSITIVE_NET"
      ? "bg-green-950 text-green-300 border border-green-800"
      : status === "OUT_OF_RANGE" || status === "REBALANCE_TRUE"
        ? "bg-yellow-950 text-yellow-300 border border-yellow-800"
        : "bg-red-950 text-red-300 border border-red-800";
  const label =
    status === "IN_RANGE"
      ? "IN RANGE"
      : status === "OUT_OF_RANGE"
        ? "OUT OF RANGE"
        : status === "REBALANCE_TRUE"
          ? "REBALANCE"
          : status === "POSITIVE_NET"
            ? "POSITIVE"
            : status === "NEGATIVE_NET"
              ? "NEGATIVE"
              : "CRITICAL";
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
}
