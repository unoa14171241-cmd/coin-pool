import { describe, expect, it, vi } from "vitest";
import { UniswapPositionReader } from "../src/services/onchain/uniswap-position-reader";

function buildPositionTuple(overrides?: Partial<readonly unknown[]>) {
  const base: readonly unknown[] = [
    0n,
    "0x00000000000000000000000000000000000000aa",
    "0x00000000000000000000000000000000000000b0",
    "0x00000000000000000000000000000000000000c0",
    500,
    -100,
    100,
    12345n,
    0n,
    0n,
    10n,
    20n
  ];
  if (!overrides) return base;
  return base.map((item, index) => (overrides[index] !== undefined ? overrides[index] : item));
}

describe("UniswapPositionReader", () => {
  it("reads token ids and positions via multicall", async () => {
    const mockClient = {
      readContract: vi.fn(async () => 2n),
      multicall: vi
        .fn()
        .mockResolvedValueOnce([
          { status: "success", result: 11n },
          { status: "success", result: 12n }
        ])
        .mockResolvedValueOnce([
          { status: "success", result: buildPositionTuple() },
          { status: "success", result: buildPositionTuple([undefined, "0x00000000000000000000000000000000000000ab"]) }
        ])
    } as any;

    const reader = new UniswapPositionReader({
      getClient: () => mockClient
    });

    const out = await reader.readWalletPositions({
      wallet: "0x00000000000000000000000000000000000000ff",
      chainId: 42161
    });

    expect(out.partialFailure).toBe(false);
    expect(out.source).toBe("rpc");
    expect(out.tokenIds).toEqual(["11", "12"]);
    expect(out.positions).toHaveLength(2);
    expect(out.positions[0].tokenId).toBe("11");
    expect(out.positions[0].fee).toBe(500);
    expect(out.positions[0].liquidity).toBe("12345");
  });

  it("falls back to single reads on multicall failures", async () => {
    const mockClient = {
      readContract: vi
        .fn()
        .mockResolvedValueOnce(2n)
        .mockResolvedValueOnce(22n)
        .mockResolvedValueOnce(buildPositionTuple([undefined, "0x00000000000000000000000000000000000000dd"])),
      multicall: vi
        .fn()
        .mockResolvedValueOnce([
          { status: "success", result: 21n },
          { status: "failure", error: new Error("token id failure") }
        ])
        .mockResolvedValueOnce([
          { status: "success", result: buildPositionTuple() },
          { status: "failure", error: new Error("position failure") }
        ])
    } as any;

    const reader = new UniswapPositionReader({
      getClient: () => mockClient
    });

    const out = await reader.readWalletPositions({
      wallet: "0x00000000000000000000000000000000000000ff",
      chainId: 42161
    });

    expect(out.source).toBe("fallback");
    expect(out.partialFailure).toBe(true);
    expect(out.tokenIds).toEqual(["21", "22"]);
    expect(out.positions).toHaveLength(2);
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it("returns fallback result when balance read fails", async () => {
    const mockClient = {
      readContract: vi.fn(async () => {
        throw new Error("rpc down");
      }),
      multicall: vi.fn()
    } as any;

    const reader = new UniswapPositionReader({
      getClient: () => mockClient
    });

    const out = await reader.readWalletPositions({
      wallet: "0x00000000000000000000000000000000000000ff",
      chainId: 42161
    });

    expect(out.source).toBe("fallback");
    expect(out.partialFailure).toBe(true);
    expect(out.tokenIds).toEqual([]);
    expect(out.positions).toEqual([]);
    expect(out.errors[0]?.step).toBe("balanceOf");
  });
});
