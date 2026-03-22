import type {
  RebalancePreviewRequest,
  StrategyApiResponse,
  StrategyMode,
  StrategyPreviewSummary,
  StrategyUrgency
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export async function fetchStrategyRecommendation(input: {
  wallet: `0x${string}`;
  positionId: string;
  mode?: StrategyMode;
}): Promise<StrategyApiResponse> {
  const modeParam = input.mode ? `?mode=${encodeURIComponent(input.mode)}` : "";
  const response = await fetch(`${API_BASE_URL}/positions/${input.wallet}/${input.positionId}/strategy${modeParam}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch strategy recommendation: ${text || response.status}`);
  }
  return response.json();
}

export async function fetchRebalancePreview(input: {
  wallet: `0x${string}`;
  positionId: string;
  body: RebalancePreviewRequest;
}): Promise<StrategyApiResponse> {
  const response = await fetch(`${API_BASE_URL}/positions/${input.wallet}/${input.positionId}/rebalance-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch rebalance preview: ${text || response.status}`);
  }
  return response.json();
}

export function toStrategyPreviewSummary(preview: StrategyApiResponse): StrategyPreviewSummary {
  const urgency = (preview.decision?.urgency ?? preview.urgency ?? "LOW") as StrategyUrgency;
  const shouldRebalance = preview.decision?.shouldRebalance ?? preview.shouldRebalance ?? false;
  const netExpectedBenefitUsd = preview.decision?.netExpectedBenefitUsd ?? preview.netExpectedBenefitUsd ?? 0;
  const estimatedGasCostUsd = preview.decision?.estimatedGasCostUsd ?? preview.estimatedGasCostUsd ?? 0;
  const suggestedTickLower = preview.preview?.proposedRange.tickLower ?? preview.suggestion?.suggestedTickLower ?? 0;
  const suggestedTickUpper = preview.preview?.proposedRange.tickUpper ?? preview.suggestion?.suggestedTickUpper ?? 0;
  return {
    marketState: preview.marketState,
    urgency,
    shouldRebalance,
    netExpectedBenefitUsd,
    estimatedGasCostUsd,
    suggestedTickLower,
    suggestedTickUpper,
    explanationLines: preview.explanationLines ?? [],
    generatedAt: (preview as { generatedAt?: string }).generatedAt ?? (preview as { computedAt?: string }).computedAt ?? new Date().toISOString(),
    source: (preview as { source?: string }).source ?? "strategy-engine",
    stale: (preview as { stale?: boolean }).stale ?? false,
    quality: (preview as { quality?: StrategyPreviewSummary["quality"] }).quality,
    suggestedLowerPrice: preview.suggestion?.suggestedLowerPrice ?? null,
    suggestedUpperPrice: preview.suggestion?.suggestedUpperPrice ?? null
  };
}
