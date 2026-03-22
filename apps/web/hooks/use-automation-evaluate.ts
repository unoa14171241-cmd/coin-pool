"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface AutomationRuntimeConfig {
  executionEnabled: boolean;
  minimumNetBenefitUsd: number;
  autoCompoundEnabled: boolean;
  minimumCompoundFeesUsd: number;
  relayer?: {
    enabled: boolean;
    urlConfigured: boolean;
    ready: boolean;
    waitConfirmation: boolean;
    timeoutMs: number;
  };
}

export interface AutomationPreflightResponse {
  ok: boolean;
  checks: Array<{
    id: string;
    label: string;
    status: "OK" | "WARN" | "ERROR";
    message: string;
    blocking: boolean;
  }>;
  summary: {
    total: number;
    ok: number;
    warn: number;
    error: number;
  };
}

export interface AutomationEvaluateResponse {
  ok: true;
  wallet: `0x${string}`;
  actorRole: "owner" | "operator";
  triggeredByWallet: `0x${string}`;
  mode: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  executionEnabled: boolean;
  minimumNetBenefitUsd: number;
  autoCompoundEnabled: boolean;
  minimumCompoundFeesUsd: number;
  note: string;
}

export interface AutomationSmokeResponse {
  ok: true;
  wallet: `0x${string}`;
  mode: "DRY_RUN" | "LIVE";
  actorRole: "owner" | "operator";
  triggeredByWallet: `0x${string}`;
  jobId: string;
  executionId: string | null;
  executionStatus: string | null;
  txStatus: string | null;
  txHash: string | null;
  note: string;
}

export function useAutomationRuntimeConfig() {
  return useQuery({
    queryKey: ["automation-config"],
    queryFn: async (): Promise<AutomationRuntimeConfig> => {
      const response = await fetch(`${API_BASE_URL}/automation/config`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch automation config: ${text || response.status}`);
      }
      return response.json();
    },
    staleTime: 30_000
  });
}

export function useAutomationPreflight() {
  return useQuery({
    queryKey: ["automation-preflight"],
    queryFn: async (): Promise<AutomationPreflightResponse> => {
      const response = await fetch(`${API_BASE_URL}/automation/preflight`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch automation preflight: ${text || response.status}`);
      }
      return response.json();
    },
    staleTime: 30_000
  });
}

export function useAutomationEvaluate(wallet?: `0x${string}`) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  return useMutation({
    mutationFn: async (input?: {
      mode?: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
      wallet?: `0x${string}`;
    }): Promise<AutomationEvaluateResponse> => {
      if (!wallet) throw new Error("Wallet not connected");
      const walletLower = wallet.toLowerCase() as `0x${string}`;
      const targetWallet = (input?.wallet ?? walletLower).toLowerCase() as `0x${string}`;
      const signed = await buildSignedAuthHeaders({
        wallet: walletLower,
        action: "POST /automation/evaluate",
        signMessageAsync
      });

      const response = await fetch(`${API_BASE_URL}/automation/evaluate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signed.headers
        },
        body: JSON.stringify({
          wallet: targetWallet,
          ...(input?.mode ? { mode: input.mode } : {})
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to run automation worker: ${text || response.status}`);
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      const targetWallet = (variables?.wallet ?? wallet) as `0x${string}` | undefined;
      qc.invalidateQueries({ queryKey: ["positions", targetWallet] });
      qc.invalidateQueries({ queryKey: ["dashboard", targetWallet] });
      qc.invalidateQueries({ queryKey: ["portfolio", targetWallet] });
      qc.invalidateQueries({ queryKey: ["activity", targetWallet] });
      qc.invalidateQueries({ queryKey: ["position-detail"] });
      qc.invalidateQueries({ queryKey: ["position-history"] });
      qc.invalidateQueries({ queryKey: ["automation-config"] });
    }
  });
}

export function useAutomationSmokeTest(wallet?: `0x${string}`) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  return useMutation({
    mutationFn: async (input?: {
      wallet?: `0x${string}`;
      mode?: "DRY_RUN" | "LIVE";
      chainId?: number;
      allowLiveSubmission?: boolean;
      txRequest?: {
        to: `0x${string}`;
        data: `0x${string}`;
        value?: string;
        gasLimit?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
    }): Promise<AutomationSmokeResponse> => {
      if (!wallet) throw new Error("Wallet not connected");
      const walletLower = wallet.toLowerCase() as `0x${string}`;
      const targetWallet = (input?.wallet ?? walletLower).toLowerCase() as `0x${string}`;
      const signed = await buildSignedAuthHeaders({
        wallet: walletLower,
        action: "POST /automation/smoke",
        signMessageAsync
      });
      const response = await fetch(`${API_BASE_URL}/automation/smoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signed.headers
        },
        body: JSON.stringify({
          wallet: targetWallet,
          mode: input?.mode ?? "DRY_RUN",
          ...(input?.chainId ? { chainId: input.chainId } : {}),
          ...(input?.allowLiveSubmission != null ? { allowLiveSubmission: input.allowLiveSubmission } : {}),
          ...(input?.txRequest ? { txRequest: input.txRequest } : {})
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to run smoke test: ${text || response.status}`);
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      const targetWallet = (variables?.wallet ?? wallet) as `0x${string}` | undefined;
      qc.invalidateQueries({ queryKey: ["activity", targetWallet] });
      qc.invalidateQueries({ queryKey: ["automation-config"] });
      qc.invalidateQueries({ queryKey: ["automation-metrics"] });
      qc.invalidateQueries({ queryKey: ["positions", targetWallet] });
    }
  });
}
