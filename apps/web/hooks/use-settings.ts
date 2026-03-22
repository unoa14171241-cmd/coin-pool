"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface NotificationSettings {
  wallet: string;
  webhookUrl: string;
  telegram: string;
  discord: string;
}

export function useSettings(wallet?: string) {
  return useQuery({
    queryKey: ["settings", wallet],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<NotificationSettings> => {
      const response = await fetch(`${API_BASE_URL}/settings/${wallet}`);
      if (!response.ok) throw new Error("Failed to fetch settings");
      return response.json();
    }
  });
}

export function useSaveSettings(wallet?: string) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  return useMutation({
    mutationFn: async (payload: Omit<NotificationSettings, "wallet">) => {
      if (!wallet) throw new Error("Wallet not connected");
      const signed = await buildSignedAuthHeaders({
        wallet: wallet as `0x${string}`,
        action: "POST /settings",
        signMessageAsync
      });

      const response = await fetch(`${API_BASE_URL}/settings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signed.headers
        },
        body: JSON.stringify({ wallet, ...payload })
      });
      if (!response.ok) throw new Error("Failed to save settings");
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", wallet] });
    }
  });
}
