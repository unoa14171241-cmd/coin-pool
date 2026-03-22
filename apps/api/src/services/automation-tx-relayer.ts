import { env } from "../config/env";
import { createPublicClient, http } from "viem";
import { chainMap, rpcUrlByChain } from "../web3/chains";

export type AutomationTxRequest = {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  /** Unix timestamp (秒)。Executor/relayerが使用 */
  deadlineTimestamp?: number;
  /** bps。0.5%=50, 1%=100。ポジション単位で設定可能 */
  slippageBps?: number;
};

export type AutomationRelayerSubmitInput = {
  jobId: string;
  executionId: string;
  wallet: string;
  chainId: number | null;
  type: "EVALUATE" | "REBALANCE" | "COLLECT" | "COMPOUND" | "DISTRIBUTE";
  txRequest: AutomationTxRequest;
};

export type AutomationRelayerSubmitResult =
  | {
      submitted: false;
      reason: string;
      context: Record<string, unknown>;
    }
  | {
      submitted: true;
      txHash: string;
      txStatus: "TX_SUBMITTED" | "TX_CONFIRMED";
      context: Record<string, unknown>;
    };

export type AutomationTxConfirmationResult =
  | { confirmed: true }
  | { confirmed: false; reason: string };

export function getAutomationRelayerState() {
  const urlConfigured = Boolean(env.AUTOMATION_RELAYER_URL);
  return {
    enabled: env.AUTOMATION_RELAYER_ENABLED,
    urlConfigured,
    ready: env.AUTOMATION_RELAYER_ENABLED && urlConfigured,
    waitConfirmation: env.AUTOMATION_RELAYER_WAIT_CONFIRMATION,
    timeoutMs: env.AUTOMATION_RELAYER_TIMEOUT_MS
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexLike(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function isAddressLike(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isTxHashLike(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function parseAutomationTxRequestFromPayload(payload: Record<string, unknown>): AutomationTxRequest | null {
  if (!isRecord(payload.txRequest)) return null;
  const tx = payload.txRequest;
  if (!isAddressLike(tx.to) || !isHexLike(tx.data)) return null;
  const out: AutomationTxRequest = {
    to: tx.to,
    data: tx.data
  };
  if (typeof tx.value === "string") out.value = tx.value;
  if (typeof tx.gasLimit === "string") out.gasLimit = tx.gasLimit;
  if (typeof tx.maxFeePerGas === "string") out.maxFeePerGas = tx.maxFeePerGas;
  if (typeof tx.maxPriorityFeePerGas === "string") out.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
  if (typeof tx.deadlineTimestamp === "number" && Number.isFinite(tx.deadlineTimestamp))
    out.deadlineTimestamp = Math.floor(tx.deadlineTimestamp);
  if (typeof tx.slippageBps === "number" && Number.isFinite(tx.slippageBps))
    out.slippageBps = Math.max(1, Math.min(500, Math.floor(tx.slippageBps)));
  return out;
}

export async function submitAutomationTxViaRelayer(input: AutomationRelayerSubmitInput): Promise<AutomationRelayerSubmitResult> {
  if (!env.AUTOMATION_RELAYER_ENABLED) {
    return {
      submitted: false,
      reason: "relayer_disabled",
      context: { relayerEnabled: false }
    };
  }
  if (!env.AUTOMATION_RELAYER_URL) {
    return {
      submitted: false,
      reason: "relayer_url_missing",
      context: { relayerEnabled: true, relayerUrlMissing: true }
    };
  }
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (env.AUTOMATION_RELAYER_API_KEY) {
    headers["x-api-key"] = env.AUTOMATION_RELAYER_API_KEY;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AUTOMATION_RELAYER_TIMEOUT_MS);
  try {
    const response = await fetch(env.AUTOMATION_RELAYER_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        wallet: input.wallet,
        chainId: input.chainId,
        type: input.type,
        jobId: input.jobId,
        executionId: input.executionId,
        txRequest: input.txRequest
      })
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        submitted: false,
        reason: `relayer_http_${response.status}`,
        context: {
          relayerEnabled: true,
          relayerUrl: env.AUTOMATION_RELAYER_URL,
          status: response.status,
          body
        }
      };
    }
    if (!isRecord(body)) {
      return {
        submitted: false,
        reason: "relayer_invalid_response",
        context: {
          relayerEnabled: true,
          relayerUrl: env.AUTOMATION_RELAYER_URL
        }
      };
    }
    const txHash = body.txHash;
    if (!isTxHashLike(txHash)) {
      return {
        submitted: false,
        reason: "relayer_missing_tx_hash",
        context: {
          relayerEnabled: true,
          relayerUrl: env.AUTOMATION_RELAYER_URL,
          body
        }
      };
    }
    const statusRaw = typeof body.status === "string" ? body.status.toUpperCase() : "SUBMITTED";
    const txStatus = statusRaw === "CONFIRMED" ? "TX_CONFIRMED" : "TX_SUBMITTED";
    return {
      submitted: true,
      txHash,
      txStatus,
      context: {
        relayerEnabled: true,
        relayerUrl: env.AUTOMATION_RELAYER_URL,
        relayerStatus: statusRaw
      }
    };
  } catch (error) {
    return {
      submitted: false,
      reason: error instanceof Error ? `relayer_error:${error.message}` : "relayer_error:unknown",
      context: {
        relayerEnabled: true,
        relayerUrl: env.AUTOMATION_RELAYER_URL
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function confirmAutomationTxOnchain(input: {
  chainId: number | null;
  txHash: string;
  timeoutMs?: number;
}): Promise<AutomationTxConfirmationResult> {
  if (!input.chainId) {
    return { confirmed: false, reason: "chain_id_missing" };
  }
  const chain = chainMap[input.chainId as keyof typeof chainMap];
  const rpc = rpcUrlByChain[input.chainId];
  if (!chain || !rpc) {
    return { confirmed: false, reason: "rpc_not_configured" };
  }
  if (!isTxHashLike(input.txHash)) {
    return { confirmed: false, reason: "invalid_tx_hash" };
  }
  try {
    const client = createPublicClient({
      chain,
      transport: http(rpc)
    });
    const receipt = await client.waitForTransactionReceipt({
      hash: input.txHash as `0x${string}`,
      timeout: input.timeoutMs ?? env.AUTOMATION_TX_CONFIRM_TIMEOUT_MS
    });
    if (receipt.status !== "success") {
      return { confirmed: false, reason: "tx_reverted" };
    }
    return { confirmed: true };
  } catch (error) {
    return {
      confirmed: false,
      reason: error instanceof Error ? `tx_confirm_error:${error.message}` : "tx_confirm_error:unknown"
    };
  }
}
