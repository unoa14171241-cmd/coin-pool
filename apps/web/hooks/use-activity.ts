"use client";

import { useQuery } from "@tanstack/react-query";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface ActivityItem {
  id: string;
  wallet: string;
  positionId: string | null;
  type: string;
  source?: "user-action" | "chain-sync" | "worker" | string;
  tx: string | null;
  message: string;
  quality: "exact" | "estimated" | "heuristic" | "placeholder";
  generatedAt: string;
  stale: boolean;
  chainId?: number | null;
  success: boolean;
  error?: string | null;
  createdAt: string;
}

export function useActivity(wallet?: string) {
  return useQuery({
    queryKey: ["activity", wallet],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<ActivityItem[]> => {
      const response = await fetch(`${API_BASE_URL}/activity/${wallet}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch activity: ${text || response.status}`);
      }
      return response.json();
    }
  });
}
