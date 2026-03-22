"use client";

import { useQuery } from "@tanstack/react-query";
import type { LpPosition } from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function usePositions(wallet?: string) {
  return useQuery({
    queryKey: ["positions", wallet],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<LpPosition[]> => {
      const response = await fetch(`${API_BASE_URL}/positions/${wallet}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch positions: ${text || response.status}`);
      }
      return response.json();
    }
  });
}
