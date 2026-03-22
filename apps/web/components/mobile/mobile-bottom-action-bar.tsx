"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MobileBottomActionBar({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-900/95 p-3 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden",
        className
      )}
    >
      <div className="mx-auto flex max-w-7xl gap-2">{children}</div>
    </div>
  );
}
