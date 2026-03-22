import { describe, expect, it } from "vitest";
import { buildAutoCompoundTxRequest, buildRebalanceTxRequest } from "../src/services/strategy/tx-request-builders";

const WALLET = "0x1111111111111111111111111111111111111111" as const;

describe("strategy tx request builders", () => {
  it("returns null for unsupported chain or missing executor address", () => {
    const req = buildRebalanceTxRequest({
      wallet: WALLET,
      positionId: "p1",
      chainId: 99999,
      currentTickLower: -120,
      currentTickUpper: 120,
      proposedTickLower: -60,
      proposedTickUpper: 60
    });
    expect(req).toBeNull();
  });

  it("returns null for unsupported chain on auto-compound", () => {
    const req = buildAutoCompoundTxRequest({
      wallet: WALLET,
      positionId: "p1",
      chainId: 99999,
      estimatedFeesUsd: 12.5
    });
    expect(req).toBeNull();
  });
});
