"use client";

import { RiskDisclosure } from "@/components/risk-disclosure";
import { ErrorNotice } from "@/components/error-notice";
import { usePositions } from "@/hooks/use-positions";
import { calculateRangeFromPercent } from "@/lib/range";
import { useAccount } from "wagmi";
import { RebalanceCard } from "@/features/rebalance/rebalance-card";

export default function RebalancePage() {
  const { address, chain } = useAccount();
  const { data, isError, error, isLoading } = usePositions(address);

  if (!address) {
    return (
      <section>
        <h2 className="mb-4 text-2xl font-semibold">Rebalance</h2>
        <div className="rounded-xl border bg-white p-6 text-sm text-slate-700">
          Wallet is not connected. Connect wallet to view out-of-range positions.
        </div>
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Rebalance is semi-automated. You must review and confirm each transaction step manually.
        </p>
        <RiskDisclosure />
      </section>
    );
  }

  const outOfRange = (data ?? []).filter((p) => p.computedStatus === "OUT_OF_RANGE");

  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold">Rebalance</h2>
      <div className="mb-3 rounded-xl border bg-white p-3 text-sm">
        <p className="font-semibold">Rebalance flow</p>
        <p className="mt-1">1. Current State 2. Strategy Preview 3. Cost/Benefit Comparison 4. Confirm Modal 5. Execute 6. Result Summary</p>
      </div>
      {isError && <ErrorNotice message={error instanceof Error ? error.message : "Failed to load rebalance targets"} />}
      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {!isLoading && outOfRange.length === 0 && (
        <div className="rounded-xl border bg-white p-6 text-sm text-slate-700">
          No out-of-range positions found.
        </div>
      )}
      <div className="space-y-4">
        {outOfRange.map((position) => {
          const suggestion = calculateRangeFromPercent(position.currentPrice ?? 3000, 10);
          const effectiveChainId = position.chainId ?? chain?.id ?? 42161;
          const chainMismatch = Boolean(position.chainId && chain?.id && position.chainId !== chain.id);
          return (
            <div key={position.id} className="space-y-2">
              {chainMismatch && (
                <ErrorNotice message={`Connected chain (${chain?.id}) does not match position chain (${position.chainId}).`} />
              )}
              <RebalanceCard
                chainId={effectiveChainId}
                disabled={chainMismatch}
                disabledReason={
                  chainMismatch
                    ? "Switch wallet network to the position chain before preparing transactions."
                    : undefined
                }
                vm={{
                  position,
                  suggestedLower: suggestion.lowerPrice,
                  suggestedUpper: suggestion.upperPrice,
                  suggestedRangeNote: "Suggested range is a reference value."
                }}
              />
            </div>
          );
        })}
      </div>
      <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Important: Rebalance is an investment support workflow. No return is guaranteed, and each transaction requires your explicit confirmation.
      </p>
      <RiskDisclosure />
    </section>
  );
}
