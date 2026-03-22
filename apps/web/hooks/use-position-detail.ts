"use client";

import { useQuery } from "@tanstack/react-query";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface PositionDetailResponse {
  id: string;
  walletAddress: `0x${string}`;
  savedState: {
    chainId: number;
    poolAddress: `0x${string}`;
    token0Address: `0x${string}`;
    token1Address: `0x${string}`;
    token0Symbol: string;
    token1Symbol: string;
    feeTier: number;
    tickLower: number;
    tickUpper: number;
    createdAt: string;
    savedStatus: "IN_RANGE" | "OUT_OF_RANGE" | "CLOSED";
  };
  liveState: {
    currentTick: number;
    currentPrice: number | null;
    sqrtPriceX96: string | null;
    liquidity: string | null;
    token1PerToken0: number | null;
    snapshotUpdatedAt: string;
    stale: boolean;
    source: "rpc" | "cache" | "fallback";
  };
  analyticsState: {
    status: "placeholder" | "estimated" | "exact";
    estimatedPositionValueUsd: number | null;
    estimatedPnlUsd: number | null;
    estimatedApr: number | null;
    estimatedApy?: number | null;
    estimatedRoiPercent: number | null;
    estimatedNetReturnUsd: number | null;
    estimatedNetReturnPercent: number | null;
    estimatedImpermanentLossUsd: number | null;
    estimatedImpermanentLossPercent: number | null;
    feeState: {
      status: "placeholder" | "estimated" | "exact";
      estimatedUncollectedFeesUsd: number | null;
    };
  };
  syncMetadata?: {
    status: "NEVER" | "SUCCESS" | "PARTIAL" | "ERROR";
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    error: string | null;
  };
}

export function usePositionDetail(wallet?: `0x${string}`, positionId?: string) {
  return useQuery({
    queryKey: ["position-detail", wallet, positionId],
    enabled: Boolean(wallet && positionId),
    queryFn: async (): Promise<PositionDetailResponse> => {
      const response = await fetch(`${API_BASE_URL}/positions/${wallet}/${positionId}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch position detail: ${text || response.status}`);
      }
      return response.json();
    }
  });
}
