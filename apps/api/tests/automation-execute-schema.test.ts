import { describe, expect, it } from "vitest";
import {
  automationExecuteRequestSchema,
  automationExecuteResponseSchema,
  automationExecutionListQuerySchema,
  automationExecutionItemSchema
} from "../src/schemas/automation";

describe("automation execute schemas", () => {
  it("accepts execute request payload", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "123",
      chainId: 42161,
      type: "REBALANCE",
      idempotencyKey: "wallet-123-rebalance-1",
      executeNow: true,
      payload: {
        estimatedGasUsd: 8,
        expectedProfitUsd: 25,
        txRequest: {
          to: "0x2222222222222222222222222222222222222222",
          data: "0xabcdef",
          value: "0",
          gasLimit: "250000"
        }
      }
    };
    expect(automationExecuteRequestSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts execute response payload", () => {
    const payload = {
      ok: true,
      jobId: "job-1",
      status: "SUCCEEDED",
      executedNow: true,
      actorRole: "owner",
      triggeredByWallet: "0x1111111111111111111111111111111111111111"
    };
    expect(automationExecuteResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts execution item payload", () => {
    const payload = {
      id: "exec-1",
      jobId: "job-1",
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "123",
      chainId: 42161,
      type: "REBALANCE",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      txHash: null,
      txStatus: "NOT_SUBMITTED",
      costUsd: 5.2,
      profitUsd: 10.1,
      netProfitUsd: 4.9,
      errorCode: null,
      errorMessage: null,
      context: {
        policy: { maxGasUsd: 20, minNetBenefitUsd: 0 }
      }
    };
    expect(automationExecutionItemSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts execution list query ids", () => {
    const fromCommaSeparated = automationExecutionListQuerySchema.safeParse({
      wallet: "0x1111111111111111111111111111111111111111",
      ids: "exec-1,exec-2,exec-3",
      limit: "10"
    });
    expect(fromCommaSeparated.success).toBe(true);
    if (fromCommaSeparated.success) {
      expect(fromCommaSeparated.data.ids).toEqual(["exec-1", "exec-2", "exec-3"]);
      expect(fromCommaSeparated.data.limit).toBe(10);
    }

    const fromRepeatedQuery = automationExecutionListQuerySchema.safeParse({
      wallet: "0x1111111111111111111111111111111111111111",
      ids: ["exec-1", "exec-2"]
    });
    expect(fromRepeatedQuery.success).toBe(true);
    if (fromRepeatedQuery.success) {
      expect(fromRepeatedQuery.data.ids).toEqual(["exec-1", "exec-2"]);
    }

    const includePayloadTrue = automationExecutionListQuerySchema.safeParse({
      wallet: "0x1111111111111111111111111111111111111111",
      includePayload: "1"
    });
    expect(includePayloadTrue.success).toBe(true);
    if (includePayloadTrue.success) {
      expect(includePayloadTrue.data.includePayload).toBe(true);
    }
  });
});
