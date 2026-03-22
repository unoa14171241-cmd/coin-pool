import { describe, expect, it } from "vitest";
import { canonicalChainName, chainNameToChainId, isChainInputConsistent } from "../src/utils/chains";

describe("chain consistency utils", () => {
  it("returns canonical chain name by chainId", () => {
    expect(canonicalChainName(42161)).toBe("arbitrum");
    expect(canonicalChainName(1)).toBe("ethereum");
  });

  it("accepts known aliases", () => {
    expect(isChainInputConsistent(42161, "Arbitrum")).toBe(true);
    expect(isChainInputConsistent(42161, "arbitrum one")).toBe(true);
    expect(isChainInputConsistent(1, "mainnet")).toBe(true);
  });

  it("rejects mismatched chain names", () => {
    expect(isChainInputConsistent(42161, "Ethereum")).toBe(false);
    expect(isChainInputConsistent(8453, "Polygon")).toBe(false);
  });

  it("maps chain name to chainId", () => {
    expect(chainNameToChainId("Arbitrum")).toBe(42161);
    expect(chainNameToChainId("mainnet")).toBe(1);
    expect(chainNameToChainId("unknown-chain")).toBeNull();
  });
});
