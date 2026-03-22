"use client";

import { cn } from "@/lib/utils";

type WarningType = "INFO" | "WARNING" | "DANGER" | "SUCCESS";

interface Props {
  type: WarningType;
  title: string;
  description: string;
  className?: string;
}

export function WarningBox({ type, title, description, className }: Props) {
  const tone =
    type === "INFO"
      ? "bg-blue-950 border-blue-800 text-blue-200"
      : type === "WARNING"
        ? "bg-yellow-950 border-yellow-800 text-yellow-200"
        : type === "DANGER"
          ? "bg-red-950 border-red-800 text-red-200"
          : "bg-green-950 border-green-800 text-green-200";

  return (
    <div className={cn("rounded-xl border p-4", tone, className)}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-sm">{description}</p>
    </div>
  );
}
