"use client";

import { useQuery } from "@tanstack/react-query";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type StrategyTemplateItem = {
  strategyId: string;
  strategyName: string;
  description: string;
  targetChain: number;
  dexProtocol: string;
  tokenA: string;
  tokenB: string;
  poolFeeTier: number;
  rangeMode: "STATIC" | "DYNAMIC" | "VOLATILITY_BASED";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  targetAPRNote?: string | null;
  enabled: boolean;
  recommendedMinCapital?: number | null;
  gasCostWarning?: string | null;
  operatorFeeRate: number;
  ownerProfitShareRate: number;
  createdByWallet: `0x${string}`;
  createdAt: string;
  updatedAt: string;
};

export function useStrategies(input?: {
  targetChain?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["strategies", input?.targetChain, input?.enabled],
    queryFn: async (): Promise<StrategyTemplateItem[]> => {
      const params = new URLSearchParams();
      if (input?.targetChain != null) params.set("targetChain", String(input.targetChain));
      if (input?.enabled != null) params.set("enabled", String(input.enabled));
      params.set("limit", "100");
      const response = await fetch(`${API_BASE_URL}/strategies?${params.toString()}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch strategies: ${text || response.status}`);
      }
      return response.json();
    },
    staleTime: 30_000
  });
}

