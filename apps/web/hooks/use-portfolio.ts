"use client";

import { useQuery } from "@tanstack/react-query";
import type { ResponseMetadata } from "@/lib/response-metadata";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface PortfolioSummaryResponse {
  walletAddress: `0x${string}`;
  chainId: number;
  totalEstimatedValueUsd: number;
  totalEstimatedFeesUsd: number;
  totalEstimatedPnlUsd: number;
  totalEstimatedImpermanentLossUsd: number;
  averageEstimatedApr: number | null;
  positionsCount: number;
  outOfRangeCount: number;
  highVolatilityPoolsCount: number;
  rangePoolsCount: number;
  negativeNetBenefitPositionsCount: number;
  metadata: {
    valuation: ResponseMetadata;
    yieldMetrics: ResponseMetadata;
    strategy: ResponseMetadata;
  };
}

export function usePortfolio(wallet?: string, chainId?: number) {
  return useQuery({
    queryKey: ["portfolio", wallet, chainId],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<PortfolioSummaryResponse> => {
      const response = await fetch(`${API_BASE_URL}/portfolio/${wallet}?chainId=${chainId ?? 42161}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch portfolio: ${text || response.status}`);
      }
      return response.json();
    }
  });
}
