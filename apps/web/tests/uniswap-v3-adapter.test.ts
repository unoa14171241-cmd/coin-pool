import { describe, expect, it, vi } from "vitest";
import { UniswapV3Adapter } from "../lib/adapters/uniswap-v3-adapter";

vi.mock("@/lib/uniswap/pool", () => {
  return {
    derivePoolAddressFromFactory: vi.fn(async (input: {
      chainId: number;
      token0Address: `0x${string}`;
      token1Address: `0x${string}`;
      feeTier: number;
    }) => ({
      poolAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984" as `0x${string}`,
      sortedToken0Address:
        input.token0Address.toLowerCase() <= input.token1Address.toLowerCase() ? input.token0Address : input.token1Address,
      sortedToken1Address:
        input.token0Address.toLowerCase() <= input.token1Address.toLowerCase() ? input.token1Address : input.token0Address,
      feeTier: input.feeTier,
      source: "UniswapV3Factory.getPool(token0,token1,fee)" as const
    }))
  };
});

describe("UniswapV3Adapter tick normalization", () => {
  it("normalizes ticks with floor(lower) and ceil(upper)", async () => {
    const adapter = new UniswapV3Adapter();
    const prepared = await adapter.prepareCreatePosition({
      chainId: 42161,
      recipient: "0x1111111111111111111111111111111111111111",
      feeTier: 500,
      tickLower: 1017,
      tickUpper: 1091,
      amountEth: "0.1",
      amountUsdc: "300",
      slippageBps: 50
    });

    expect(prepared.summary.tickLower).toBe(1010);
    expect(prepared.summary.tickUpper).toBe(1100);
    expect(prepared.summary.poolDerivation.source).toBe("UniswapV3Factory.getPool(token0,token1,fee)");
    expect(prepared.summary.poolDerivation.feeTier).toBe(500);
    expect(prepared.summary.poolSource).toContain(prepared.summary.poolDerivation.factoryAddress);
  });

  it("keeps poolDerivation sorted tokens consistent with summary token order", async () => {
    const adapter = new UniswapV3Adapter();
    const prepared = await adapter.prepareCreatePosition({
      chainId: 42161,
      recipient: "0x1111111111111111111111111111111111111111",
      feeTier: 3000,
      tickLower: -123,
      tickUpper: 456,
      amountEth: "0.2",
      amountUsdc: "500",
      slippageBps: 50
    });

    const derivation = prepared.summary.poolDerivation;
    expect(derivation.token0Address.toLowerCase() <= derivation.token1Address.toLowerCase()).toBe(true);
    expect(derivation.token0Address).toBe(prepared.summary.token0Address);
    expect(derivation.token1Address).toBe(prepared.summary.token1Address);
    expect(derivation.feeTier).toBe(prepared.summary.feeTier);
  });

  it("throws when normalized lower and upper collapse", async () => {
    const adapter = new UniswapV3Adapter();
    await expect(
      adapter.prepareCreatePosition({
        chainId: 42161,
        recipient: "0x1111111111111111111111111111111111111111",
        feeTier: 500,
        tickLower: 1000,
        tickUpper: 1000,
        amountEth: "0.1",
        amountUsdc: "300",
        slippageBps: 50
      })
    ).rejects.toThrow("Normalized ticks are invalid. Adjust the range and retry.");
  });
});
