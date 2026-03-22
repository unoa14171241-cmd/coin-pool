"use client";

import { useQuery } from "@tanstack/react-query";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface DailyProfitItem {
  date: string;
  totalFeesUsd: number;
  totalPnlUsd: number;
  estimatedIlUsd: number;
  positionCount: number;
  note?: "estimated" | "cumulative";
}

export interface DailyProfitResponse {
  walletAddress: `0x${string}`;
  chainId: number;
  from: string;
  to: string;
  daily: DailyProfitItem[];
  metadata: {
    source: string;
    quality: "estimated" | "placeholder";
    generatedAt: string;
  };
}

export function useDailyProfit(
  wallet?: string,
  chainId?: number,
  options?: { from?: string; to?: string }
) {
  const from = options?.from ?? "";
  const to = options?.to ?? "";
  const query = [from && `from=${encodeURIComponent(from)}`, to && `to=${encodeURIComponent(to)}`]
    .filter(Boolean)
    .join("&");

  return useQuery({
    queryKey: ["daily-profit", wallet, chainId, from, to],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<DailyProfitResponse> => {
      const url = `${API_BASE_URL}/positions/${wallet}/daily-profit?chainId=${chainId ?? 42161}${query ? `&${query}` : ""}`;
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch daily profit: ${text || response.status}`);
      }
      return response.json();
    },
    staleTime: 60_000
  });
}
