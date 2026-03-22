"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MetricRow } from "@/components/ui/metric-row";
import { WarningBox } from "@/components/ui/warning-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmRebalanceModal } from "@/components/modals/confirm-rebalance-modal";
import { WhyPanel } from "@/components/cards/why-panel";
import { RangeVisualizer } from "@/components/charts/range-visualizer";
import { RebalanceCostSimulator } from "@/components/cards/rebalance-cost-simulator";
import type { RebalanceViewModel } from "@/features/rebalance/types";
import { useRebalanceFlow } from "@/features/rebalance/use-rebalance-flow";
import { useUniswapV3Adapter } from "@/hooks/use-uniswap-v3-adapter";
import { displayPriceToApproxTick } from "@/lib/uniswap/tick";
import { fetchRebalancePreview, toStrategyPreviewSummary } from "@/lib/strategy/client";
import type { StrategyApiResponse, StrategyMode, StrategyPreviewSummary } from "@/lib/strategy/types";
import { useAccount, useSignMessage } from "wagmi";

interface Props {
  vm: RebalanceViewModel;
  chainId: number;
  disabled?: boolean;
  disabledReason?: string;
}

export function RebalanceCard({ vm, chainId, disabled = false, disabledReason }: Props) {
  const { position, suggestedLower, suggestedUpper, suggestedRangeNote } = vm;
  const { flow, prepareStep, markConfirmed } = useRebalanceFlow(position, chainId);
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const adapter = useUniswapV3Adapter();
  const [isCollecting, setIsCollecting] = useState(false);
  const [isRebalancing, setIsRebalancing] = useState(false);
  const [isStrategyLoading, setIsStrategyLoading] = useState(false);
  const [strategyMode, setStrategyMode] = useState<StrategyMode>("BALANCED");
  const [strategyPreview, setStrategyPreview] = useState<StrategyApiResponse | null>(null);
  const [strategyPreviewSummary, setStrategyPreviewSummary] = useState<StrategyPreviewSummary | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-slate-100 shadow-sm">
      <p className="font-medium">
        {position.token0Symbol}/{position.token1Symbol} - #{position.id}
      </p>
      <p className="text-sm text-yellow-300">Out of range</p>

      <div className="mt-2 space-y-2 text-sm">
        <MetricRow label="fee tier" value={position.feeTier} />
        <MetricRow label="tick lower" value={position.tickLower} />
        <MetricRow label="tick upper" value={position.tickUpper} />
        <MetricRow label="current price" value={position.currentPrice ?? "price unavailable"} />
        <MetricRow
          label="estimated gas"
          value={
            flow.steps.prepareNewMint.payload?.estimatedGas ??
            flow.steps.prepareOptionalSwap.payload?.estimatedGas ??
            flow.steps.reviewWithdraw.payload?.estimatedGas ??
            "~0.006 ETH"
          }
        />
      </div>

      <div className="mt-4 rounded-lg bg-slate-800 p-3 text-sm">
        <MetricRow label="suggested range" value={`${suggestedLower} - ${suggestedUpper}`} />
        <p className="mt-2 text-xs text-slate-400">{suggestedRangeNote}</p>
      </div>
      <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
        <p className="font-semibold">Strategy Preview</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant={strategyMode === "CONSERVATIVE" ? "default" : "outline"} onClick={() => setStrategyMode("CONSERVATIVE")}>
            Conservative
          </Button>
          <Button size="sm" variant={strategyMode === "BALANCED" ? "default" : "outline"} onClick={() => setStrategyMode("BALANCED")}>
            Balanced
          </Button>
          <Button size="sm" variant={strategyMode === "AGGRESSIVE" ? "default" : "outline"} onClick={() => setStrategyMode("AGGRESSIVE")}>
            Aggressive
          </Button>
        </div>
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          disabled={disabled || !address || isStrategyLoading}
          onClick={async () => {
            if (!address) {
              setActionError("Wallet is not connected.");
              return;
            }
            setActionError(null);
            setIsStrategyLoading(true);
            try {
              const preview = await fetchRebalancePreview({
                wallet: address,
                positionId: position.id,
                body: { mode: strategyMode }
              });
              setStrategyPreview(preview);
              setStrategyPreviewSummary(toStrategyPreviewSummary(preview));
            } catch (e) {
              setActionError(e instanceof Error ? e.message : "Failed to load strategy preview");
            } finally {
              setIsStrategyLoading(false);
            }
          }}
        >
          {isStrategyLoading ? "Loading strategy..." : "Load Strategy Preview"}
        </Button>
        {strategyPreview && (
          <div className="mt-2 text-xs text-slate-300">
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
              <div className="space-y-2">
                <MetricRow label="state" value={strategyPreview.marketState} />
                <MetricRow label="urgency" value={strategyPreview.decision?.urgency ?? strategyPreview.urgency ?? "-"} />
                <MetricRow
                  label="should rebalance"
                  value={(strategyPreview.decision?.shouldRebalance ?? strategyPreview.shouldRebalance) ? <StatusBadge status="REBALANCE_TRUE" /> : "NO"}
                />
                <MetricRow
                  label="net expected benefit"
                  value={
                    <span className="flex items-center gap-2">
                      <StatusBadge status={(strategyPreview.decision?.netExpectedBenefitUsd ?? strategyPreview.netExpectedBenefitUsd ?? 0) < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />
                      <span>${(strategyPreview.decision?.netExpectedBenefitUsd ?? strategyPreview.netExpectedBenefitUsd ?? 0).toFixed(2)}</span>
                    </span>
                  }
                />
                {strategyPreview.preview && (
                  <MetricRow
                    label="proposed ticks"
                    value={`${strategyPreview.preview.proposedRange.tickLower} - ${strategyPreview.preview.proposedRange.tickUpper}`}
                  />
                )}
              </div>
            </div>
            {(strategyPreview.explanationLines ?? []).slice(0, 3).map((line) => (
              <p key={line}>- {line}</p>
            ))}
            <div className="mt-3 grid gap-3">
              <RangeVisualizer
                currentLowerTick={position.tickLower}
                currentUpperTick={position.tickUpper}
                currentTick={position.currentTick ?? null}
                currentPrice={position.currentPrice ?? null}
                proposedLowerTick={strategyPreview.preview?.proposedRange.tickLower ?? strategyPreview.suggestion?.suggestedTickLower}
                proposedUpperTick={strategyPreview.preview?.proposedRange.tickUpper ?? strategyPreview.suggestion?.suggestedTickUpper}
              />
              <WhyPanel
                marketState={strategyPreview.marketState}
                strategyMode={strategyMode}
                currentIssue={
                  position.currentTick != null && position.currentTick >= position.tickUpper
                    ? "Price is above the current range."
                    : position.currentTick != null && position.currentTick < position.tickLower
                      ? "Price is below the current range."
                      : "Price is near a range boundary."
                }
                expectedOutcome="Fee capture efficiency may improve after rebalancing."
                costUsd={strategyPreview.decision?.estimatedGasCostUsd ?? strategyPreview.estimatedGasCostUsd ?? null}
                netExpectedBenefitUsd={strategyPreview.decision?.netExpectedBenefitUsd ?? strategyPreview.netExpectedBenefitUsd ?? null}
                shouldRebalance={strategyPreview.decision?.shouldRebalance ?? strategyPreview.shouldRebalance}
                explanationLines={strategyPreview.explanationLines}
              />
              <RebalanceCostSimulator
                estimatedGasCostUsd={strategyPreview.decision?.estimatedGasCostUsd ?? strategyPreview.estimatedGasCostUsd ?? null}
                expectedFeeImprovementUsd={strategyPreview.preview?.expectedFeeImprovementUsd ?? null}
                netExpectedBenefitUsd={strategyPreview.decision?.netExpectedBenefitUsd ?? strategyPreview.netExpectedBenefitUsd ?? null}
                shouldRebalance={strategyPreview.decision?.shouldRebalance ?? strategyPreview.shouldRebalance}
                urgency={strategyPreview.decision?.urgency ?? strategyPreview.urgency}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            await prepareStep("reviewWithdraw");
          }}
          disabled={disabled || flow.steps.reviewWithdraw.status === "preparing"}
        >
          Review Withdraw
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await prepareStep("prepareOptionalSwap");
          }}
          disabled={disabled || flow.steps.prepareOptionalSwap.status === "preparing"}
        >
          Prepare Optional Swap
        </Button>
        <Button
          onClick={async () => {
            await prepareStep("prepareNewMint");
          }}
          disabled={disabled || flow.steps.prepareNewMint.status === "preparing"}
        >
          Prepare New Mint
        </Button>
      </div>

      {disabled && (
        <WarningBox
          type="WARNING"
          title="Safety Lock"
          description={disabledReason ?? "This position is currently locked due to safety checks."}
          className="mt-3"
        />
      )}

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
        <p className="text-sm font-semibold text-slate-100">Execution Status</p>
        <div className="mt-2 space-y-2">
          {flow.steps.reviewWithdraw.status === "preparing" && <MetricRow label="withdraw" value="Preparing payload..." />}
          {flow.steps.prepareOptionalSwap.status === "preparing" && <MetricRow label="swap" value="Preparing payload..." />}
          {flow.steps.prepareNewMint.status === "preparing" && <MetricRow label="mint" value="Preparing payload..." />}
          {flow.steps.reviewWithdraw.error && <MetricRow label="withdraw error" value={<span className="text-red-300">{flow.steps.reviewWithdraw.error}</span>} />}
          {flow.steps.prepareOptionalSwap.error && <MetricRow label="swap error" value={<span className="text-red-300">{flow.steps.prepareOptionalSwap.error}</span>} />}
          {flow.steps.prepareNewMint.error && <MetricRow label="mint error" value={<span className="text-red-300">{flow.steps.prepareNewMint.error}</span>} />}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
        <p className="text-sm font-semibold text-slate-100">Transaction Hashes</p>
        <div className="mt-2 space-y-2">
          <MetricRow label="review withdraw txHash" value={flow.steps.reviewWithdraw.txHash ?? "-"} />
          <MetricRow label="prepare optional swap txHash" value={flow.steps.prepareOptionalSwap.txHash ?? "-"} />
          <MetricRow label="prepare new mint txHash" value={flow.steps.prepareNewMint.txHash ?? "-"} />
        </div>
      </div>

      {!disabled ? (
        <div className="mt-4 rounded-lg bg-slate-800 p-3 text-xs text-slate-200">
          <p className="text-sm font-semibold text-slate-100">Prepared Payload Preview</p>
          <div className="mt-2 space-y-2">
            <MetricRow
              label="withdraw"
              value={
                flow.steps.reviewWithdraw.payload
                  ? `${flow.steps.reviewWithdraw.payload.functionName} -> ${flow.steps.reviewWithdraw.payload.to}`
                  : "-"
              }
            />
            <MetricRow
              label="swap"
              value={
                flow.steps.prepareOptionalSwap.payload
                  ? `${flow.steps.prepareOptionalSwap.payload.functionName} -> ${flow.steps.prepareOptionalSwap.payload.to}`
                  : "-"
              }
            />
            <MetricRow
              label="mint"
              value={
                flow.steps.prepareNewMint.payload
                  ? `${flow.steps.prepareNewMint.payload.functionName} -> ${flow.steps.prepareNewMint.payload.to}`
                  : "-"
              }
            />
          </div>
        </div>
      ) : (
        <WarningBox
          type="WARNING"
          title="Payload Preview Hidden"
          description="Payload preview is hidden until network mismatch is resolved."
          className="mt-4"
        />
      )}

      {process.env.NODE_ENV === "development" && (
        <div className="mt-4 flex gap-2 rounded-lg border border-amber-800 bg-amber-950/50 p-2 text-xs text-amber-200">
          <span className="self-center font-semibold">[DEV ONLY]</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              markConfirmed(
                "reviewWithdraw",
                "0x1111111111111111111111111111111111111111111111111111111111111111"
              )
            }
            disabled={disabled}
          >
            Mock Confirm Withdraw
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              markConfirmed(
                "prepareOptionalSwap",
                "0x2222222222222222222222222222222222222222222222222222222222222222"
              )
            }
            disabled={disabled}
          >
            Mock Confirm Swap
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              markConfirmed(
                "prepareNewMint",
                "0x3333333333333333333333333333333333333333333333333333333333333333"
              )
            }
            disabled={disabled}
          >
            Mock Confirm Mint
          </Button>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            if (!address) {
              setActionError("Wallet is not connected.");
              return;
            }
            setActionError(null);
            setActionMessage(null);
            setIsCollecting(true);
            try {
              const result = await adapter.collectFees(position.id);
              await saveActivityLog({
                wallet: address,
                signMessageAsync,
                type: "Collect",
                positionId: position.id,
                txHash: result.txHash,
                message: `Collected fees for position ${position.id}. amount0=${result.amount0 ?? "n/a"}, amount1=${result.amount1 ?? "n/a"}`
              });
              setActionMessage(`Collect executed: ${result.txHash}`);
            } catch (e) {
              setActionError(e instanceof Error ? e.message : "Collect failed");
            } finally {
              setIsCollecting(false);
            }
          }}
          disabled={disabled || isCollecting || isRebalancing}
        >
          {isCollecting ? "Collecting..." : "Execute Collect"}
        </Button>
        <Button
          size="sm"
          onClick={() => setIsConfirmModalOpen(true)}
          disabled={disabled || isCollecting || isRebalancing}
        >
          {isRebalancing ? "Rebalancing..." : "Review & Execute"}
        </Button>
      </div>
      {actionMessage && <WarningBox type="SUCCESS" title="Execution Result" description={actionMessage} className="mt-3" />}
      {actionError && <WarningBox type="DANGER" title="Execution Error" description={actionError} className="mt-3" />}
      <ConfirmRebalanceModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={async () => {
          if (!address) {
            setActionError("Wallet is not connected.");
            return;
          }
          if (!strategyPreviewSummary) {
            setActionError("No strategy preview loaded.");
            return;
          }
          setActionError(null);
          setActionMessage(null);
          setIsRebalancing(true);
          try {
            const [nextTickLower, nextTickUpper] = resolveExecutionTicks({
              previewSummary: strategyPreviewSummary,
              previewRaw: strategyPreview,
              suggestedLower,
              suggestedUpper
            });
            const result = await adapter.rebalance(position.id, nextTickLower, nextTickUpper);
            await saveActivityLog({
              wallet: address,
              signMessageAsync,
              type: "Rebalance",
              positionId: position.id,
              txHash: result.txHash,
              message: `Rebalanced position ${position.id} -> newTokenId=${result.newPositionTokenId ?? "unknown"}`
            });
            setActionMessage(`Rebalance executed: ${result.txHash}`);
            setIsConfirmModalOpen(false);
          } catch (e) {
            setActionError(e instanceof Error ? e.message : "Rebalance failed");
          } finally {
            setIsRebalancing(false);
          }
        }}
        strategyPreview={strategyPreviewSummary}
        strategyMode={strategyMode}
        currentPosition={position}
        gasEstimateUsd={strategyPreviewSummary?.estimatedGasCostUsd ?? 0}
        walletAddress={address}
        isConfirming={isRebalancing}
      />
    </div>
  );
}

async function saveActivityLog(input: {
  wallet: `0x${string}`;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  type: "Collect" | "Rebalance";
  positionId: string;
  txHash: string;
  message: string;
}) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  const action = encodeURIComponent("POST /activity");
  const challengeRes = await fetch(`${apiBaseUrl}/auth/challenge/${input.wallet}?action=${action}`);
  if (!challengeRes.ok) throw new Error("Failed to get auth challenge");
  const challenge = (await challengeRes.json()) as { message: string };
  const signature = await input.signMessageAsync({ message: challenge.message });
  const messageB64 = utf8ToBase64(challenge.message);
  const response = await fetch(`${apiBaseUrl}/activity`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet-address": input.wallet.toLowerCase(),
      "x-wallet-signature": signature,
      "x-wallet-message-b64": messageB64
    },
    body: JSON.stringify({
      wallet: input.wallet,
      positionId: input.positionId,
      type: input.type,
      source: "user-action",
      tx: input.txHash,
      message: input.message
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save activity log: ${text || response.status}`);
  }
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function resolveExecutionTicks(input: {
  previewSummary: StrategyPreviewSummary | null;
  previewRaw: StrategyApiResponse | null;
  suggestedLower: number;
  suggestedUpper: number;
}): [number, number] {
  const fromPreviewLower =
    input.previewSummary?.suggestedTickLower ??
    input.previewRaw?.preview?.proposedRange.tickLower ??
    input.previewRaw?.suggestion?.suggestedTickLower;
  const fromPreviewUpper =
    input.previewSummary?.suggestedTickUpper ??
    input.previewRaw?.preview?.proposedRange.tickUpper ??
    input.previewRaw?.suggestion?.suggestedTickUpper;
  let lower = fromPreviewLower ?? displayPriceToApproxTick(input.suggestedLower);
  let upper = fromPreviewUpper ?? displayPriceToApproxTick(input.suggestedUpper);

  if (lower >= upper) {
    const base = Math.min(lower, upper);
    lower = base - 1;
    upper = base + 1;
  }
  return [lower, upper];
}
