import { describe, expect, it } from "vitest";
import {
  automationJobListQuerySchema,
  automationMetricsQuerySchema,
  automationJobItemSchema,
  automationPolicySchema,
  automationWorkerTickRequestSchema,
  automationWorkerTickResponseSchema,
  upsertAutomationPolicyRequestSchema
} from "../src/schemas/automation";

describe("automation policy/worker schemas", () => {
  it("accepts upsert policy payload", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      mode: "BALANCED",
      minNetBenefitUsd: 1,
      maxGasUsd: 20
    };
    expect(upsertAutomationPolicyRequestSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts policy item payload", () => {
    const payload = {
      id: "policy-1",
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: null,
      enabled: true,
      mode: "BALANCED",
      minNetBenefitUsd: 5,
      maxGasUsd: 30,
      maxSlippageBps: 100,
      cooldownMinutes: 60,
      staleSnapshotReject: true,
      autoCollectEnabled: true,
      autoCompoundEnabled: false,
      autoRebalanceEnabled: false,
      updatedAt: new Date().toISOString()
    };
    expect(automationPolicySchema.safeParse(payload).success).toBe(true);
  });

  it("accepts worker tick request/response payload", () => {
    const req = {
      wallet: "0x1111111111111111111111111111111111111111",
      maxJobs: 5
    };
    expect(automationWorkerTickRequestSchema.safeParse(req).success).toBe(true);
    const res = {
      ok: true,
      wallet: "0x1111111111111111111111111111111111111111",
      processed: 1,
      failed: 0,
      requeued: 0,
      workerId: "api-worker-1"
    };
    expect(automationWorkerTickResponseSchema.safeParse(res).success).toBe(true);
  });

  it("accepts automation job item payload", () => {
    const payload = {
      id: "job-1",
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "123",
      chainId: 42161,
      type: "REBALANCE",
      status: "QUEUED",
      priority: 100,
      scheduledAt: new Date().toISOString(),
      leaseUntil: null,
      attempt: 0,
      maxAttempts: 5,
      idempotencyKey: "k-1",
      payload: { estimatedGasUsd: 8, expectedProfitUsd: 22 },
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    expect(automationJobItemSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts automation job list query ids", () => {
    const fromCommaSeparated = automationJobListQuerySchema.safeParse({
      wallet: "0x1111111111111111111111111111111111111111",
      ids: "job-a,job-b,job-c",
      limit: "20"
    });
    expect(fromCommaSeparated.success).toBe(true);
    if (fromCommaSeparated.success) {
      expect(fromCommaSeparated.data.ids).toEqual(["job-a", "job-b", "job-c"]);
      expect(fromCommaSeparated.data.limit).toBe(20);
    }

    const fromRepeatedQuery = automationJobListQuerySchema.safeParse({
      wallet: "0x1111111111111111111111111111111111111111",
      ids: ["job-a", "job-b"]
    });
    expect(fromRepeatedQuery.success).toBe(true);
    if (fromRepeatedQuery.success) {
      expect(fromRepeatedQuery.data.ids).toEqual(["job-a", "job-b"]);
    }

    const includePayloadTrue = automationJobListQuerySchema.safeParse({
      wallet: "0x1111111111111111111111111111111111111111",
      includePayload: "true"
    });
    expect(includePayloadTrue.success).toBe(true);
    if (includePayloadTrue.success) {
      expect(includePayloadTrue.data.includePayload).toBe(true);
    }
  });

  it("accepts automation metrics query filters", () => {
    const parsed = automationMetricsQuerySchema.safeParse({
      wallet: "0x1111111111111111111111111111111111111111",
      chainId: "42161",
      type: "REBALANCE",
      since: new Date().toISOString(),
      errorCodeLimit: "15",
      trendBucket: "15m",
      trendLimit: "96"
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.chainId).toBe(42161);
      expect(parsed.data.type).toBe("REBALANCE");
      expect(parsed.data.errorCodeLimit).toBe(15);
      expect(parsed.data.trendBucket).toBe("15m");
      expect(parsed.data.trendLimit).toBe(96);
    }
  });
});
