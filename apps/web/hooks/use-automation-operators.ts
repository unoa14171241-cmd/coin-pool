"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface AutomationOperatorPermission {
  ownerWallet: `0x${string}`;
  operatorWallet: `0x${string}`;
  canEvaluate: boolean;
  canExecute: boolean;
  canPause: boolean;
  canChangeStrategy: boolean;
  active: boolean;
  updatedAt: string;
}

export function useLoadAutomationOperators(signerWallet?: `0x${string}`) {
  const { signMessageAsync } = useSignMessage();
  return useMutation({
    mutationFn: async (input: { ownerWallet: `0x${string}` }): Promise<AutomationOperatorPermission[]> => {
      if (!signerWallet) throw new Error("Wallet not connected");
      const signerLower = signerWallet.toLowerCase() as `0x${string}`;
      const ownerLower = input.ownerWallet.toLowerCase() as `0x${string}`;
      const signed = await buildSignedAuthHeaders({
        wallet: signerLower,
        action: `GET /automation/operators/${ownerLower}`,
        signMessageAsync
      });

      const response = await fetch(`${API_BASE_URL}/automation/operators/${ownerLower}`, {
        method: "GET",
        headers: signed.headers
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to load operator permissions: ${text || response.status}`);
      }
      return response.json();
    }
  });
}

export function useUpsertAutomationOperator(signerWallet?: `0x${string}`) {
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ownerWallet: `0x${string}`;
      operatorWallet: `0x${string}`;
      canEvaluate: boolean;
      canExecute: boolean;
      canPause: boolean;
      canChangeStrategy: boolean;
      active: boolean;
    }) => {
      if (!signerWallet) throw new Error("Wallet not connected");
      const signerLower = signerWallet.toLowerCase() as `0x${string}`;
      const signed = await buildSignedAuthHeaders({
        wallet: signerLower,
        action: "POST /automation/operators",
        signMessageAsync
      });

      const response = await fetch(`${API_BASE_URL}/automation/operators`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signed.headers
        },
        body: JSON.stringify({
          ownerWallet: input.ownerWallet.toLowerCase(),
          operatorWallet: input.operatorWallet.toLowerCase(),
          canEvaluate: input.canEvaluate,
          canExecute: input.canExecute,
          canPause: input.canPause,
          canChangeStrategy: input.canChangeStrategy,
          active: input.active
        })
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to save operator permission: ${text || response.status}`);
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["automation-operators", variables.ownerWallet.toLowerCase()] });
    }
  });
}
