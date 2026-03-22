import { encodeFunctionData, parseAbi } from "viem";
import { env } from "../../config/env";
import type { AutomationTxRequest } from "../automation-tx-relayer";

/** Deadline for Uniswap interactions: now + TX_DEADLINE_SECONDS (default 300). */
export const RECOMMENDED_DEADLINE_SECONDS = 300;

function resolveDeadlineTimestamp(deadlineSeconds?: number): number {
  const sec = deadlineSeconds ?? env.TX_DEADLINE_SECONDS;
  return Math.floor(Date.now() / 1000) + sec;
}

function resolveSlippageBps(slippageBps?: number): number {
  const bps = slippageBps ?? env.DEFAULT_SLIPPAGE_BPS;
  return Math.max(1, Math.min(env.MAX_SLIPPAGE_BPS, Math.floor(bps)));
}
const automationExecutorAbi = parseAbi([
  "function executeRebalance(address owner,string positionId,int24 currentTickLower,int24 currentTickUpper,int24 proposedTickLower,int24 proposedTickUpper)",
  "function executeAutoCompound(address owner,string positionId,uint256 estimatedFeesUsdX1e6)"
]);

function executorAddressByChain(chainId: number): `0x${string}` | null {
  if (chainId === 42161) return (env.AUTOMATION_EXECUTOR_ADDRESS_ARBITRUM as `0x${string}` | undefined) ?? null;
  if (chainId === 1) return (env.AUTOMATION_EXECUTOR_ADDRESS_MAINNET as `0x${string}` | undefined) ?? null;
  if (chainId === 8453) return (env.AUTOMATION_EXECUTOR_ADDRESS_BASE as `0x${string}` | undefined) ?? null;
  if (chainId === 137) return (env.AUTOMATION_EXECUTOR_ADDRESS_POLYGON as `0x${string}` | undefined) ?? null;
  return null;
}

function toUsdX1e6(value: number | null | undefined): bigint {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.round(value * 1_000_000));
}

export function buildRebalanceTxRequest(input: {
  wallet: `0x${string}`;
  positionId: string;
  chainId: number;
  currentTickLower: number;
  currentTickUpper: number;
  proposedTickLower: number;
  proposedTickUpper: number;
  deadlineSeconds?: number;
  slippageBps?: number;
}): AutomationTxRequest | null {
  const to = executorAddressByChain(input.chainId);
  if (!to) return null;
  const data = encodeFunctionData({
    abi: automationExecutorAbi,
    functionName: "executeRebalance",
    args: [
      input.wallet,
      input.positionId,
      input.currentTickLower,
      input.currentTickUpper,
      input.proposedTickLower,
      input.proposedTickUpper
    ]
  });
  return {
    to,
    data,
    value: "0",
    gasLimit: "600000",
    deadlineTimestamp: resolveDeadlineTimestamp(input.deadlineSeconds),
    slippageBps: resolveSlippageBps(input.slippageBps)
  };
}

export function buildAutoCompoundTxRequest(input: {
  wallet: `0x${string}`;
  positionId: string;
  chainId: number;
  estimatedFeesUsd: number | null;
  deadlineSeconds?: number;
  slippageBps?: number;
}): AutomationTxRequest | null {
  const to = executorAddressByChain(input.chainId);
  if (!to) return null;
  const data = encodeFunctionData({
    abi: automationExecutorAbi,
    functionName: "executeAutoCompound",
    args: [input.wallet, input.positionId, toUsdX1e6(input.estimatedFeesUsd)]
  });
  return {
    to,
    data,
    value: "0",
    gasLimit: "450000",
    deadlineTimestamp: resolveDeadlineTimestamp(input.deadlineSeconds),
    slippageBps: resolveSlippageBps(input.slippageBps)
  };
}
