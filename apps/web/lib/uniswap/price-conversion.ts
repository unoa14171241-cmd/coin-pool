import {
  type OperationalConversionResult,
  operationalPriceToTick,
  operationalTickToPrice
} from "@/lib/uniswap/tick";

export interface TokenMeta {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface PriceConversionContext {
  token0: TokenMeta;
  token1: TokenMeta;
  quoteToken: "token0" | "token1";
}

export interface PrecisePriceToTickInput {
  price: string;
  context: PriceConversionContext;
  tickSpacing: number;
}

export interface PreciseTickToPriceInput {
  tick: number;
  context: PriceConversionContext;
}

export function precisePriceToTick(input: PrecisePriceToTickInput): OperationalConversionResult {
  validateContext(input.context);
  return operationalPriceToTick({
    price: input.price,
    token0Decimals: input.context.token0.decimals,
    token1Decimals: input.context.token1.decimals,
    quoteToken: input.context.quoteToken,
    tickSpacing: input.tickSpacing
  });
}

export function preciseTickToPrice(input: PreciseTickToPriceInput): OperationalConversionResult {
  validateContext(input.context);
  return operationalTickToPrice({
    tick: input.tick,
    token0Decimals: input.context.token0.decimals,
    token1Decimals: input.context.token1.decimals,
    quoteToken: input.context.quoteToken
  });
}

function validateContext(context: PriceConversionContext) {
  if (context.token0.decimals < 0 || context.token1.decimals < 0) {
    throw new Error("token decimals must be >= 0");
  }
  if (context.quoteToken !== "token0" && context.quoteToken !== "token1") {
    throw new Error("quoteToken must be token0 or token1");
  }
}
