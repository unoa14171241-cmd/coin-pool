export type TokenSwapQuoteInput = {
  amountInUsd: number;
  slippageBps?: number;
};

export type TokenSwapQuote = {
  amountOutUsd: number;
  priceImpactBps: number;
  estimatedGasUsd: number;
};

export function quoteSwap(input: TokenSwapQuoteInput): TokenSwapQuote {
  const slippageBps = Math.max(0, Math.min(500, input.slippageBps ?? 30));
  const priceImpactBps = Math.max(5, Math.round(slippageBps * 0.7));
  const amountOutUsd = input.amountInUsd * (1 - (priceImpactBps + slippageBps) / 10_000);
  return {
    amountOutUsd: Math.max(0, amountOutUsd),
    priceImpactBps,
    estimatedGasUsd: 2
  };
}
