export interface OnchainFeeInput {
  tokensOwed0Raw: string | null;
  tokensOwed1Raw: string | null;
  token0Decimals: number | null;
  token1Decimals: number | null;
}

export interface FeeTokenAmounts {
  token0Amount: number | null;
  token1Amount: number | null;
  exact: boolean;
  note?: string;
}

export function convertOnchainTokensOwedToAmounts(input: OnchainFeeInput): FeeTokenAmounts {
  if (input.tokensOwed0Raw == null && input.tokensOwed1Raw == null) {
    return {
      token0Amount: null,
      token1Amount: null,
      exact: false,
      note: "No on-chain owed token values available."
    };
  }
  if (input.token0Decimals == null || input.token1Decimals == null) {
    return {
      token0Amount: null,
      token1Amount: null,
      exact: false,
      note: "Token decimals unavailable for on-chain fee conversion."
    };
  }

  const token0Amount = toDecimalAmount(input.tokensOwed0Raw ?? "0", input.token0Decimals);
  const token1Amount = toDecimalAmount(input.tokensOwed1Raw ?? "0", input.token1Decimals);
  if (token0Amount == null || token1Amount == null) {
    return {
      token0Amount: null,
      token1Amount: null,
      exact: false,
      note: "Failed to convert owed token units."
    };
  }

  return {
    token0Amount,
    token1Amount,
    exact: true
  };
}

function toDecimalAmount(raw: string, decimals: number): number | null {
  try {
    const units = BigInt(raw);
    const value = Number(units) / 10 ** decimals;
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(8));
  } catch {
    return null;
  }
}
