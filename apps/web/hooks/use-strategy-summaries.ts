"use client";

import { useQuery } from "@tanstack/react-query";
import type { LpPosition } from "@/lib/types";
import { fetchStrategyRecommendation } from "@/lib/strategy/client";
import type { StrategyMode, StrategyPreviewSummary } from "@/lib/strategy/types";
import { toStrategyPreviewSummary } from "@/lib/strategy/client";

export function useStrategySummaries(input: {
  wallet?: `0x${string}`;
  positions: LpPosition[];
  modeByPositionId?: Record<string, StrategyMode>;
}) {
  return useQuery({
    queryKey: ["strategy-summaries", input.wallet, input.positions.map((p) => p.id).join(",")],
    enabled: Boolean(input.wallet) && input.positions.length > 0,
    queryFn: async (): Promise<Record<string, StrategyPreviewSummary>> => {
      if (!input.wallet) return {};
      const entries = await Promise.all(
        input.positions.map(async (position) => {
          try {
            const response = await fetchStrategyRecommendation({
              wallet: input.wallet as `0x${string}`,
              positionId: position.id,
              mode: input.modeByPositionId?.[position.id]
            });
            return [position.id, toStrategyPreviewSummary(response)] as const;
          } catch {
            return [position.id, null] as const;
          }
        })
      );
      const result: Record<string, StrategyPreviewSummary> = {};
      for (const [id, summary] of entries) {
        if (summary) result[id] = summary;
      }
      return result;
    },
    staleTime: 20_000
  });
}
