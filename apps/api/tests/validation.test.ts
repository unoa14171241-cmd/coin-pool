import { describe, expect, it } from "vitest";
import { createPositionSchema } from "../src/schemas/position";

describe("API validation", () => {
  it("accepts valid position payload", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "123",
      chainId: 42161,
      chainName: "Arbitrum",
      poolAddress: "0x0000000000000000000000000000000000000000",
      token0Address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      token1Address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      token0Symbol: "WETH",
      token1Symbol: "USDC",
      feeTier: 500,
      tickLower: 1000,
      tickUpper: 2000,
      createdTx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      slippageBps: 50,
      status: "IN_RANGE"
    };
    expect(createPositionSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects invalid slippage", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "123",
      chainId: 42161,
      chainName: "Arbitrum",
      poolAddress: "0x0000000000000000000000000000000000000000",
      token0Address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      token1Address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      token0Symbol: "WETH",
      token1Symbol: "USDC",
      feeTier: 500,
      tickLower: 1000,
      tickUpper: 2000,
      createdTx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      slippageBps: 1000,
      status: "IN_RANGE"
    };
    expect(createPositionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects non-numeric positionId", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "non-numeric",
      chainId: 42161,
      chainName: "Arbitrum",
      poolAddress: "0x0000000000000000000000000000000000000000",
      token0Address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      token1Address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      token0Symbol: "WETH",
      token1Symbol: "USDC",
      feeTier: 500,
      tickLower: 1000,
      tickUpper: 2000,
      createdTx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      slippageBps: 50,
      status: "IN_RANGE"
    };
    expect(createPositionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects when tickLower is not less than tickUpper", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "123",
      chainId: 42161,
      chainName: "Arbitrum",
      poolAddress: "0x0000000000000000000000000000000000000000",
      token0Address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      token1Address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      token0Symbol: "WETH",
      token1Symbol: "USDC",
      feeTier: 500,
      tickLower: 2000,
      tickUpper: 2000,
      createdTx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      slippageBps: 50,
      status: "IN_RANGE"
    };
    expect(createPositionSchema.safeParse(payload).success).toBe(false);
  });
});
