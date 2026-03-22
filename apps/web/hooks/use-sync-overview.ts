"use client";

import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface SyncOverviewResponse {
  walletAddress: `0x${string}`;
  actorRole: "owner" | "operator";
  triggeredByWallet: `0x${string}`;
  chainId: number;
  syncStatus: {
    totalPositions: number;
    neverCount: number;
    successCount: number;
    partialCount: number;
    errorCount: number;
    lastSyncAttemptAt: string | null;
    lastSyncSuccessAt: string | null;
    latestSyncError: string | null;
    onchainStatesOwnedCount: number;
  };
  indexing: {
    totalIndexed: number;
    matchedLocalCount: number;
    unmatchedDiscoveredCount: number;
    indexedAt: string;
  };
}

export function useSyncOverview(input: {
  signerWallet?: `0x${string}`;
  targetWallet?: `0x${string}`;
  chainId?: number;
  auto?: boolean;
}) {
  const { signMessageAsync } = useSignMessage();
  const targetWallet = (input.targetWallet ?? input.signerWallet)?.toLowerCase() as `0x${string}` | undefined;
  return useQuery({
    queryKey: ["sync-overview", targetWallet, input.chainId],
    enabled: Boolean(input.auto && targetWallet && input.signerWallet && input.chainId != null),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<SyncOverviewResponse> => {
      if (!input.signerWallet || !targetWallet || input.chainId == null) {
        throw new Error("Wallet and chain context are required");
      }
      const signed = await buildSignedAuthHeaders({
        wallet: input.signerWallet,
        action: `GET /sync/${targetWallet}/overview`,
        signMessageAsync,
        chainId: input.chainId
      });
      const response = await fetch(`${API_BASE_URL}/sync/${targetWallet}/overview?chainId=${input.chainId}`, {
        headers: signed.headers
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch sync overview: ${text || response.status}`);
      }
      return response.json();
    }
  });
}
