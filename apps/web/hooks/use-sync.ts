"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface SyncRunResponse {
  walletAddress: `0x${string}`;
  requestedChainIds: number[];
  results: Array<{
    wallet: `0x${string}`;
    chainId: number;
    startedAt: string;
    finishedAt: string;
    outcome: "SUCCESS" | "PARTIAL" | "ERROR";
    discoveredTokenIds: string[];
    fetchedPositionsCount: number;
    matchedLocalPositionsCount: number;
    upsertedOnchainStatesCount: number;
    errorCount: number;
    errors: Array<{
      step: string;
      message: string;
      tokenId?: string;
    }>;
  }>;
  summary: {
    totalChains: number;
    successChains: number;
    partialChains: number;
    errorChains: number;
    totalErrors: number;
  };
}

export function useSync(wallet?: `0x${string}`) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  return useMutation({
    mutationFn: async (input?: { chainId?: number }): Promise<SyncRunResponse> => {
      if (!wallet) throw new Error("Wallet not connected");
      const walletPath = wallet.toLowerCase() as `0x${string}`;
      const query = input?.chainId != null ? `?chainId=${input.chainId}` : "";
      const signed = await buildSignedAuthHeaders({
        wallet,
        action: `POST /sync/${walletPath}`,
        signMessageAsync,
        chainId: input?.chainId
      });

      const response = await fetch(`${API_BASE_URL}/sync/${walletPath}${query}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signed.headers
        }
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to run sync: ${text || response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", wallet] });
      qc.invalidateQueries({ queryKey: ["dashboard", wallet] });
      qc.invalidateQueries({ queryKey: ["portfolio", wallet] });
      qc.invalidateQueries({ queryKey: ["activity", wallet] });
      qc.invalidateQueries({ queryKey: ["position-detail"] });
      qc.invalidateQueries({ queryKey: ["position-history"] });
    }
  });
}
