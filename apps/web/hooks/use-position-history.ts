"use client";

import { useQuery } from "@tanstack/react-query";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface PositionHistoryPoint {
  chainId: number;
  positionId: string;
  snapshotAt: string;
  currentTick: number;
  currentPrice: number | null;
  token0Amount: number | null;
  token1Amount: number | null;
  estimatedValueUsd: number | null;
  estimatedFeesUsd: number | null;
  estimatedPnlUsd: number | null;
  estimatedIlUsd: number | null;
  estimatedApr: number | null;
  staleFlag: boolean;
}

export function usePositionHistory(wallet?: `0x${string}`, positionId?: string) {
  return useQuery({
    queryKey: ["position-history", wallet, positionId],
    enabled: Boolean(wallet && positionId),
    queryFn: async (): Promise<PositionHistoryPoint[]> => {
      const response = await fetch(`${API_BASE_URL}/positions/${wallet}/${positionId}/history`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch position history: ${text || response.status}`);
      }
      return response.json();
    }
  });
}
