"use client";

import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { buildSignedAuthHeaders } from "@/lib/wallet-auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type AutomationMetricsTrendItem = {
  bucketStart: string;
  total: number;
  completed: number;
  failed: number;
  precheckFailed: number;
  relayerFailed: number;
  successRate: number;
  relayerFailureRate: number;
  p95ElapsedMs: number | null;
};

export type AutomationMetricsResponse = {
  total: number;
  completed: number;
  failed: number;
  precheckFailed: number;
  successRate: number;
  relayerFailureCount: number;
  byType: Array<{
    type: string;
    total: number;
    completed: number;
    failed: number;
    precheckFailed: number;
  }>;
  byTxStatus: Array<{
    txStatus: string;
    count: number;
  }>;
  failureByErrorCode: Array<{
    errorCode: string;
    count: number;
    lastSeenAt: string;
  }>;
  trend: AutomationMetricsTrendItem[];
  alerts: {
    latestBucketStart: string | null;
    degradedSuccessRate: boolean;
    elevatedRelayerFailureRate: boolean;
    elevatedP95ElapsedMs: boolean;
  };
  alertThresholds: {
    minSuccessRate: number;
    maxRelayerFailureRate: number;
    maxP95ElapsedMs: number;
  };
  filters: {
    wallet: string | null;
    chainId: number | null;
    type: string | null;
    since: string | null;
    errorCodeLimit: number;
    trendBucket: "15m" | "1h";
    trendLimit: number;
  };
};

export function useAutomationMetrics(input: {
  signerWallet?: `0x${string}`;
  targetWallet?: `0x${string}`;
  chainId?: number;
  enabled?: boolean;
}) {
  const { signMessageAsync } = useSignMessage();
  return useQuery({
    queryKey: ["automation-metrics", input.signerWallet, input.targetWallet, input.chainId],
    enabled: Boolean(input.enabled && input.signerWallet),
    queryFn: async (): Promise<AutomationMetricsResponse> => {
      if (!input.signerWallet) throw new Error("Wallet not connected");
      const signed = await buildSignedAuthHeaders({
        wallet: input.signerWallet.toLowerCase() as `0x${string}`,
        action: "GET /automation/metrics",
        signMessageAsync
      });
      const walletQuery =
        input.targetWallet && /^0x[a-fA-F0-9]{40}$/.test(input.targetWallet)
          ? `wallet=${encodeURIComponent(input.targetWallet.toLowerCase())}&`
          : "";
      const chainQuery = input.chainId ? `chainId=${input.chainId}&` : "";
      const response = await fetch(
        `${API_BASE_URL}/automation/metrics?${walletQuery}${chainQuery}trendBucket=1h&trendLimit=24`,
        {
          headers: signed.headers
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch automation metrics: ${text || response.status}`);
      }
      return response.json();
    },
    staleTime: 30_000
  });
}
