import { describe, expect, it } from "vitest";
import { validateApproveTarget, validateChainId, validateSlippagePercent } from "../lib/security";

describe("security guards", () => {
  it("accepts supported chain and safe slippage", () => {
    expect(() => validateChainId(42161)).not.toThrow();
    expect(() => validateSlippagePercent(0.5)).not.toThrow();
  });

  it("rejects unsupported chain", () => {
    expect(() => validateChainId(10)).toThrow();
  });

  it("rejects non-whitelisted approve target", () => {
    expect(() => validateApproveTarget("0xabc", ["0xdef"])).toThrow();
  });
});
