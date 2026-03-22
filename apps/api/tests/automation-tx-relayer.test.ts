import { describe, expect, it } from "vitest";
import { confirmAutomationTxOnchain, parseAutomationTxRequestFromPayload } from "../src/services/automation-tx-relayer";

describe("automation tx relayer payload parser", () => {
  it("parses txRequest when payload is valid", () => {
    const parsed = parseAutomationTxRequestFromPayload({
      txRequest: {
        to: "0x1111111111111111111111111111111111111111",
        data: "0xabcdef",
        value: "0",
        gasLimit: "300000"
      }
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.to).toBe("0x1111111111111111111111111111111111111111");
    expect(parsed?.data).toBe("0xabcdef");
  });

  it("returns null when txRequest shape is invalid", () => {
    const parsed = parseAutomationTxRequestFromPayload({
      txRequest: {
        to: "not-an-address",
        data: "invalid-hex"
      }
    });
    expect(parsed).toBeNull();
  });

  it("returns not confirmed when chain id is missing", async () => {
    const out = await confirmAutomationTxOnchain({
      chainId: null,
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
    });
    expect(out.confirmed).toBe(false);
  });
});
