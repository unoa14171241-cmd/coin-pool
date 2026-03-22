"use client";

import { formatAgeFromNow, formatGeneratedAt } from "@/lib/time";
import { cn } from "@/lib/utils";

interface Props {
  iso: string;
  showAbsolute?: boolean;
  showRelative?: boolean;
  className?: string;
  compact?: boolean;
}

export function TimestampWithAge({
  iso,
  showAbsolute = true,
  showRelative = true,
  className,
  compact = false
}: Props) {
  const absolute = formatGeneratedAt(iso);
  const relative = formatAgeFromNow(iso);
  const title = absolute;
  const effectiveShowAbsolute = compact ? false : showAbsolute;
  const effectiveShowRelative = compact ? true : showRelative;

  return (
    <span className={cn(className)} title={title}>
      {effectiveShowAbsolute && <span>{absolute}</span>}
      {effectiveShowAbsolute && effectiveShowRelative && <span> </span>}
      {effectiveShowRelative && <span>{effectiveShowAbsolute ? `(${relative})` : relative}</span>}
    </span>
  );
}
