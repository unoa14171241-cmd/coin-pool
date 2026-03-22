import { cn } from "@/lib/utils";

export function StatusPill({ inRange }: { inRange: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 text-xs font-semibold",
        inRange ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
      )}
    >
      {inRange ? "In range" : "Out of range"}
    </span>
  );
}
