"use client";

import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface AutomationExecutionItem {
  id: string;
  jobId: string;
  wallet: string;
  positionId: string | null;
  chainId: number | null;
  type: "EVALUATE" | "REBALANCE" | "COLLECT" | "COMPOUND" | "DISTRIBUTE";
  status: string;
  startedAt: string;
  finishedAt: string | null;
  txHash: string | null;
  txStatus: string | null;
  costUsd: number | null;
  profitUsd: number | null;
  netProfitUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  context?: unknown;
}

export type ExecutionStatusFilter = "all" | "success" | "failed" | "precheck_failed";

export function useAutomationExecutions(input: {
  signerWallet?: `0x${string}`;
  targetWallet?: `0x${string}`;
  limit?: number;
  status?: ExecutionStatusFilter;
  enabled?: boolean;
}) {
  const { signMessageAsync } = useSignMessage();
  return useQuery({
    queryKey: ["automation-executions", input.signerWallet, input.targetWallet, input.limit, input.status],
    enabled: Boolean(input.enabled && input.signerWallet),
    queryFn: async (): Promise<AutomationExecutionItem[]> => {
      if (!input.signerWallet) throw new Error("Wallet not connected");
      const signed = await buildSignedAuthHeaders({
        wallet: input.signerWallet.toLowerCase() as `0x${string}`,
        action: "GET /automation/executions",
        signMessageAsync
      });
      const params = new URLSearchParams();
      if (input.targetWallet && /^0x[a-fA-F0-9]{40}$/.test(input.targetWallet)) {
        params.set("wallet", input.targetWallet.toLowerCase());
      }
      params.set("limit", String(input.limit ?? 50));
      if (input.status && input.status !== "all") {
        params.set("status", input.status);
      }
      const response = await fetch(`${API_BASE_URL}/automation/executions?${params.toString()}`, {
        headers: signed.headers
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch automation executions: ${text || response.status}`);
      }
      return response.json();
    },
    staleTime: 15_000
  });
}
