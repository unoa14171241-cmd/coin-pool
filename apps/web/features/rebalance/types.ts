import type { LpPosition } from "@/lib/types";

export type RebalanceStepKey =
  | "reviewWithdraw"
  | "prepareOptionalSwap"
  | "prepareNewMint";

export interface TxPayload {
  step: RebalanceStepKey;
  chainId: number;
  to: `0x${string}`;
  functionName: string;
  data: `0x${string}`;
  value: bigint;
  estimatedGas: string;
  description: string;
}

export interface StepTxState {
  status: "idle" | "preparing" | "ready" | "confirmed" | "error";
  txHash?: `0x${string}`;
  payload?: TxPayload;
  error?: string;
}

export interface RebalanceFlowState {
  positionId: string;
  steps: Record<RebalanceStepKey, StepTxState>;
}

export interface RebalanceViewModel {
  position: LpPosition;
  suggestedLower: number;
  suggestedUpper: number;
  suggestedRangeNote: string;
}
