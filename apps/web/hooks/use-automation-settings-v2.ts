"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type AutomationSettingV2 = {
  id: string;
  wallet: `0x${string}`;
  positionId: string | null;
  chainId: number;
  strategyTemplateId: string | null;
  executionMode: "MANUAL_APPROVAL" | "AUTO_EXECUTE";
  autoRebalanceEnabled: boolean;
  autoCompoundEnabled: boolean;
  compoundSchedule: "DAILY" | "WEEKLY" | "THRESHOLD";
  minCompoundUsd: number | null;
  maxGasUsd: number | null;
  emergencyPaused: boolean;
  source?: "automation_setting" | "policy_fallback";
  updatedByWallet: `0x${string}`;
  createdAt: string;
  updatedAt: string;
};

export function useAutomationSettingsV2(input: {
  signerWallet?: `0x${string}`;
  targetWallet?: `0x${string}`;
  chainId?: number;
  enabled?: boolean;
}) {
  const { signMessageAsync } = useSignMessage();
  return useQuery({
    queryKey: ["automation-settings-v2", input.signerWallet, input.targetWallet, input.chainId],
    enabled: Boolean(input.enabled && input.signerWallet && input.targetWallet),
    queryFn: async (): Promise<AutomationSettingV2[]> => {
      if (!input.signerWallet || !input.targetWallet) return [];
      const signed = await buildSignedAuthHeaders({
        wallet: input.signerWallet.toLowerCase() as `0x${string}`,
        action: "GET /automation/settings",
        signMessageAsync
      });
      const qs = new URLSearchParams({
        wallet: input.targetWallet.toLowerCase(),
        fallback: "true"
      });
      if (input.chainId) qs.set("chainId", String(input.chainId));
      const response = await fetch(`${API_BASE_URL}/automation/settings?${qs.toString()}`, {
        headers: signed.headers
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch automation settings: ${text || response.status}`);
      }
      return response.json();
    },
    staleTime: 30_000
  });
}

export function useUpsertAutomationSettingsV2(signerWallet?: `0x${string}`) {
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      wallet: `0x${string}`;
      positionId?: string;
      chainId: number;
      executionMode: "MANUAL_APPROVAL" | "AUTO_EXECUTE";
      autoRebalanceEnabled: boolean;
      autoCompoundEnabled: boolean;
      compoundSchedule: "DAILY" | "WEEKLY" | "THRESHOLD";
      minCompoundUsd?: number;
      maxGasUsd?: number;
      emergencyPaused: boolean;
      strategyTemplateId?: string;
    }): Promise<AutomationSettingV2> => {
      if (!signerWallet) throw new Error("Wallet not connected");
      const signed = await buildSignedAuthHeaders({
        wallet: signerWallet.toLowerCase() as `0x${string}`,
        action: "POST /automation/settings",
        signMessageAsync
      });
      const response = await fetch(`${API_BASE_URL}/automation/settings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signed.headers
        },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to save automation settings: ${text || response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-settings-v2"] });
      qc.invalidateQueries({ queryKey: ["automation-config"] });
    }
  });
}

