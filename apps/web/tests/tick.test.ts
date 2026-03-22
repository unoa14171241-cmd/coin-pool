import { describe, expect, it } from "vitest";
import {
  ceilToUsableTick,
  displayPriceToApproxTick,
  displayTickToApproxPrice,
  floorToUsableTick,
  nearestUsableTick,
  operationalPriceToTick,
  operationalTickToPrice
} from "../lib/uniswap/tick";

describe("tick utilities", () => {
  it("rounds to nearest usable tick", () => {
    expect(nearestUsableTick(1007, 10)).toBe(1010);
  });

  it("floors lower tick and ceils upper tick by spacing", () => {
    expect(floorToUsableTick(1017, 10)).toBe(1010);
    expect(ceilToUsableTick(1017, 10)).toBe(1020);
  });

  it("handles negative ticks with floor/ceil semantics", () => {
    expect(floorToUsableTick(-1017, 10)).toBe(-1020);
    expect(ceilToUsableTick(-1017, 10)).toBe(-1010);
  });

  it("clamps floor/ceil results to Uniswap tick bounds", () => {
    expect(floorToUsableTick(-9_999_999, 60)).toBe(-887272);
    expect(ceilToUsableTick(9_999_999, 60)).toBe(887272);
  });

  it("converts price and tick", () => {
    const tick = displayPriceToApproxTick(3000);
    const price = displayTickToApproxPrice(tick);
    expect(price).toBeGreaterThan(0);
  });

  it("converts using operational functions with decimals/orientation", () => {
    const prepared = operationalPriceToTick({
      price: "3000",
      token0Decimals: 18,
      token1Decimals: 6,
      quoteToken: "token1",
      tickSpacing: 60
    });
    expect(prepared.tick % 60 === 0).toBe(true); // avoid -0 vs +0 (Object.is)
    expect(Number(prepared.price)).toBeGreaterThan(0);
    expect(BigInt(prepared.sqrtPriceX96)).toBeGreaterThan(0n);

    const inverse = operationalTickToPrice({
      tick: prepared.tick,
      token0Decimals: 18,
      token1Decimals: 6,
      quoteToken: "token1"
    });
    expect(Number(inverse.price)).toBeGreaterThan(0);
    expect(BigInt(inverse.sqrtPriceX96)).toBeGreaterThan(0n);
  });
});
