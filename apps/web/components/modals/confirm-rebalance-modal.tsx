"use client";

import { Button } from "@/components/ui/button";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { MetricRow } from "@/components/ui/metric-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { MobileBottomActionBar } from "@/components/mobile/mobile-bottom-action-bar";
import { WhyPanel } from "@/components/cards/why-panel";
import { RangeVisualizer } from "@/components/charts/range-visualizer";
import { RebalanceCostSimulator } from "@/components/cards/rebalance-cost-simulator";
import type { LpPosition } from "@/lib/types";
import type { StrategyMode, StrategyPreviewSummary } from "@/lib/strategy/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  strategyPreview: StrategyPreviewSummary | null;
  strategyMode: StrategyMode;
  currentPosition: LpPosition;
  gasEstimateUsd: number;
  walletAddress?: `0x${string}`;
  isConfirming?: boolean;
}

export function ConfirmRebalanceModal({
  isOpen,
  onClose,
  onConfirm,
  strategyPreview,
  strategyMode,
  currentPosition,
  gasEstimateUsd,
  walletAddress,
  isConfirming = false
}: Props) {
  if (!isOpen) return null;
  const hasPreview = Boolean(strategyPreview);
  const stale = hasPreview && Boolean(strategyPreview.stale);
  const shouldRebalance = strategyPreview?.shouldRebalance ?? false;
  const netBenefit = strategyPreview?.netExpectedBenefitUsd ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-800 bg-slate-900 p-4 pb-24 text-slate-100 sm:h-auto sm:max-w-lg sm:rounded-xl sm:p-6 sm:pb-6">
        <h2 className="text-lg font-semibold">Confirm Rebalance</h2>

        <div className="mt-4 grid gap-4 text-sm text-slate-200">
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm font-semibold">Current State</p>
            <div className="mt-3 space-y-2">
              <MetricRow label="pool" value={currentPosition.poolAddress} />
              <MetricRow label="pair" value={`${currentPosition.token0Symbol}/${currentPosition.token1Symbol}`} />
              <MetricRow label="fee tier" value={currentPosition.feeTier} />
              <MetricRow label="wallet" value={walletAddress ?? "not connected"} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm font-semibold">Strategy Recommendation</p>
            <div className="mt-3 space-y-2">
              <MetricRow label="strategy mode" value={strategyMode} />
            </div>
          </section>

          {!hasPreview && (
            <section className="rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-yellow-200">
              No strategy preview loaded.
            </section>
          )}

          {hasPreview && (
            <>
              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-sm font-semibold">Strategy Recommendation</p>
                <div className="mt-3 space-y-2">
                  <MetricRow label="market state" value={strategyPreview.marketState} />
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-sm font-semibold">Execution</p>
                <div className="mt-3 space-y-2">
                  <MetricRow
                    label="should rebalance"
                    value={shouldRebalance ? <StatusBadge status="REBALANCE_TRUE" /> : "NO"}
                  />
                  <MetricRow label="urgency" value={<UrgencyBadge urgency={strategyPreview.urgency} />} />
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-sm font-semibold">Current State</p>
                <div className="mt-3 space-y-2">
                  <MetricRow label="proposed tick range" value={`${strategyPreview.suggestedTickLower} - ${strategyPreview.suggestedTickUpper}`} />
                  <MetricRow label="price lower" value={strategyPreview.suggestedLowerPrice ?? "n/a"} />
                  <MetricRow label="price upper" value={strategyPreview.suggestedUpperPrice ?? "n/a"} />
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-sm font-semibold">Cost Analysis</p>
                <div className="mt-3 space-y-2">
                  <MetricRow
                    label="net expected benefit usd"
                    value={
                      <span className="flex items-center gap-2">
                        <StatusBadge status={netBenefit < 0 ? "NEGATIVE_NET" : "POSITIVE_NET"} />
                        <span>${netBenefit.toFixed(2)}</span>
                      </span>
                    }
                  />
                  <MetricRow label="estimated gas cost usd" value={`$${(strategyPreview.estimatedGasCostUsd || gasEstimateUsd).toFixed(2)}`} />
                  <MetricRow label="generatedAt" value={<TimestampWithAge iso={strategyPreview.generatedAt} />} />
                </div>
              </section>

              <RangeVisualizer
                currentLowerTick={currentPosition.tickLower}
                currentUpperTick={currentPosition.tickUpper}
                currentTick={currentPosition.currentTick ?? null}
                currentPrice={currentPosition.currentPrice ?? null}
                proposedLowerTick={strategyPreview.suggestedTickLower}
                proposedUpperTick={strategyPreview.suggestedTickUpper}
              />

              <WhyPanel
                marketState={strategyPreview.marketState}
                strategyMode={strategyMode}
                currentIssue={
                  currentPosition.currentTick != null && currentPosition.currentTick >= currentPosition.tickUpper
                    ? "Price is above the current range."
                    : currentPosition.currentTick != null && currentPosition.currentTick < currentPosition.tickLower
                      ? "Price is below the current range."
                      : "Price is near a range boundary."
                }
                expectedOutcome="Fee capture efficiency may improve after rebalancing."
                costUsd={strategyPreview.estimatedGasCostUsd || gasEstimateUsd}
                netExpectedBenefitUsd={netBenefit}
                shouldRebalance={shouldRebalance}
                explanationLines={strategyPreview.explanationLines}
              />

              <RebalanceCostSimulator
                estimatedGasCostUsd={strategyPreview.estimatedGasCostUsd || gasEstimateUsd}
                expectedFeeImprovementUsd={null}
                netExpectedBenefitUsd={netBenefit}
                shouldRebalance={shouldRebalance}
                urgency={strategyPreview.urgency}
              />

              {!shouldRebalance && (
                <section className="rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-yellow-200">
                  Strategy engine suggests NOT rebalancing.
                </section>
              )}

              {netBenefit < 0 && (
                <section className="rounded-xl border border-red-800 bg-red-950 p-4 text-red-200">
                  Expected net benefit is negative.
                </section>
              )}

              {stale && (
                <section className="rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-yellow-200">
                  Preview may be outdated.
                </section>
              )}
            </>
          )}
        </div>

        <div className="mt-5 hidden justify-end gap-2 sm:flex">
          <Button variant="outline" onClick={onClose} disabled={isConfirming}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm()} disabled={!hasPreview || isConfirming}>
            {isConfirming ? "Executing..." : "Confirm Rebalance"}
          </Button>
        </div>
        <MobileBottomActionBar className="sm:hidden">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={isConfirming}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" onClick={() => void onConfirm()} disabled={!hasPreview || isConfirming}>
            {isConfirming ? "Executing..." : "Confirm Rebalance"}
          </Button>
        </MobileBottomActionBar>
      </div>
    </div>
  );
}

function UrgencyBadge({ urgency }: { urgency: StrategyPreviewSummary["urgency"] }) {
  const cls =
    urgency === "HIGH"
      ? "border border-red-800 bg-red-950 text-red-300"
      : urgency === "MEDIUM"
        ? "border border-yellow-800 bg-yellow-950 text-yellow-300"
        : "border border-slate-700 bg-slate-800 text-slate-300";
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{urgency}</span>;
}

