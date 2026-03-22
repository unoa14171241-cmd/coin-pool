import { describe, expect, it } from "vitest";
import {
  automationEvaluateRequestSchema,
  automationEvaluateResponseSchema,
  automationOperatorPermissionSchema,
  upsertAutomationOperatorRequestSchema
} from "../src/schemas/automation";

describe("automation schemas", () => {
  it("accepts evaluate request payload", () => {
    const payload = {
      wallet: "0x1111111111111111111111111111111111111111",
      mode: "BALANCED"
    };
    expect(automationEvaluateRequestSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts evaluate response payload", () => {
    const payload = {
      ok: true,
      wallet: "0x1111111111111111111111111111111111111111",
      actorRole: "owner",
      triggeredByWallet: "0x1111111111111111111111111111111111111111",
      mode: "BALANCED",
      executionEnabled: false,
      minimumNetBenefitUsd: 5,
      autoCompoundEnabled: false,
      minimumCompoundFeesUsd: 10,
      note: "Worker runs in dry-run mode by default."
    };
    expect(automationEvaluateResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts operator permission payloads", () => {
    const upsertPayload = {
      ownerWallet: "0x1111111111111111111111111111111111111111",
      operatorWallet: "0x2222222222222222222222222222222222222222",
      canEvaluate: true,
      canExecute: false,
      active: true
    };
    expect(upsertAutomationOperatorRequestSchema.safeParse(upsertPayload).success).toBe(true);

    const permissionPayload = {
      ...upsertPayload,
      canPause: false,
      canChangeStrategy: false,
      updatedAt: new Date().toISOString()
    };
    expect(automationOperatorPermissionSchema.safeParse(permissionPayload).success).toBe(true);
  });
});
