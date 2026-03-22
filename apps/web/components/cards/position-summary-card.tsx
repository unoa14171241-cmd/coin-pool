"use client";

import { Card } from "@/components/ui/card";
import type { LpPosition } from "@/lib/types";
import type { ReactNode } from "react";

interface Props {
  position: LpPosition;
  rightSlot?: ReactNode;
}

export function PositionSummaryCard({ position, rightSlot }: Props) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 text-sm">
          <p className="font-semibold">
            {position.token0Symbol}/{position.token1Symbol} #{position.id}
          </p>
          <p>
            Fee tier: {position.feeTier} | Tick: {position.tickLower} - {position.tickUpper}
          </p>
          <p>
            Current: tick {position.currentTick} / price {position.currentPrice ?? "price unavailable"}
          </p>
          <p>Status: {position.computedStatus}</p>
        </div>
        {rightSlot}
      </div>
    </Card>
  );
}
