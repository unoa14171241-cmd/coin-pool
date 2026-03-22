"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardMetrics } from "@/lib/types";
import type { ResponseMetadata } from "@/lib/response-metadata";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface DashboardSummaryResponse extends DashboardMetrics {
  metadata: {
    valuation: ResponseMetadata;
    yieldMetrics: ResponseMetadata;
    liveState: ResponseMetadata;
  };
}

export function useDashboard(wallet?: string, chainId?: number) {
  return useQuery({
    queryKey: ["dashboard", wallet, chainId],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<DashboardSummaryResponse> => {
      const response = await fetch(`${API_BASE_URL}/dashboard/${wallet}?chainId=${chainId ?? 42161}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch dashboard: ${text || response.status}`);
      }
      return response.json();
    }
  });
}
