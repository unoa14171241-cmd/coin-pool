import { describe, expect, it } from "vitest";
import {
  precisePriceToTick,
  preciseTickToPrice,
  type PriceConversionContext
} from "../lib/uniswap/price-conversion";

const wethUsdcContext: PriceConversionContext = {
  token0: {
    address: "0x0000000000000000000000000000000000000001",
    symbol: "WETH",
    decimals: 18
  },
  token1: {
    address: "0x0000000000000000000000000000000000000002",
    symbol: "USDC",
    decimals: 6
  },
  quoteToken: "token1"
};

describe("precise price conversion", () => {
  it("converts token1 quote price to usable tick", () => {
    const conversion = precisePriceToTick({
      price: "3000",
      context: wethUsdcContext,
      tickSpacing: 60
    });
    expect(conversion.tick % 60 === 0).toBe(true); // avoid -0 vs +0
    expect(BigInt(conversion.sqrtPriceX96)).toBeGreaterThan(0n);
  });

  it("supports reverse quote token orientation", () => {
    const conversion = precisePriceToTick({
      price: (1 / 3000).toString(),
      context: { ...wethUsdcContext, quoteToken: "token0" },
      tickSpacing: 60
    });
    expect(conversion.tick % 60 === 0).toBe(true); // avoid -0 vs +0
    expect(BigInt(conversion.sqrtPriceX96)).toBeGreaterThan(0n);
  });

  it("returns deterministic price string from tick", () => {
    const conversion = preciseTickToPrice({
      tick: 0,
      context: {
        token0: {
          address: "0x0000000000000000000000000000000000000011",
          symbol: "A",
          decimals: 6
        },
        token1: {
          address: "0x0000000000000000000000000000000000000012",
          symbol: "B",
          decimals: 6
        },
        quoteToken: "token1"
      }
    });
    expect(conversion.price).toBe("1");
    expect(BigInt(conversion.sqrtPriceX96)).toBeGreaterThan(0n);
  });
});
