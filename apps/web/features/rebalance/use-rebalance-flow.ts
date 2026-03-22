"use client";

import { useMemo, useState } from "react";
import type { LpPosition } from "@/lib/types";
import type { RebalanceFlowState, RebalanceStepKey } from "@/features/rebalance/types";
import {
  buildPrepareNewMintPayload,
  buildPrepareOptionalSwapPayload,
  buildReviewWithdrawPayload
} from "@/features/rebalance/payloads";

export function useRebalanceFlow(position: LpPosition, chainId: number) {
  const [flow, setFlow] = useState<RebalanceFlowState>({
    positionId: position.id,
    steps: {
      reviewWithdraw: { status: "idle" },
      prepareOptionalSwap: { status: "idle" },
      prepareNewMint: { status: "idle" }
    }
  });

  const payloadBuilders = useMemo(
    () => ({
      reviewWithdraw: () => buildReviewWithdrawPayload(position, chainId),
      prepareOptionalSwap: () => buildPrepareOptionalSwapPayload(position, chainId),
      prepareNewMint: () => buildPrepareNewMintPayload(position, chainId)
    }),
    [position, chainId]
  );

  async function prepareStep(step: RebalanceStepKey) {
    setFlow((prev) => ({
      ...prev,
      steps: {
        ...prev.steps,
        [step]: {
          ...prev.steps[step],
          status: "preparing",
          payload: undefined,
          error: undefined
        }
      }
    }));

    try {
      const payload = await payloadBuilders[step]();
      setFlow((prev) => ({
        ...prev,
        steps: {
          ...prev.steps,
          [step]: {
            ...prev.steps[step],
            status: "ready",
            payload,
            error: undefined
          }
        }
      }));
    } catch (e) {
      setFlow((prev) => ({
        ...prev,
        steps: {
          ...prev.steps,
          [step]: {
            ...prev.steps[step],
            status: "error",
            payload: undefined,
            error: e instanceof Error ? e.message : "Failed to prepare payload"
          }
        }
      }));
    }
  }

  function markConfirmed(step: RebalanceStepKey, txHash: `0x${string}`) {
    setFlow((prev) => ({
      ...prev,
      steps: {
        ...prev.steps,
        [step]: {
          ...prev.steps[step],
          status: "confirmed",
          txHash,
          error: undefined
        }
      }
    }));
  }

  return { flow, prepareStep, markConfirmed };
}
