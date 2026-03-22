import { describe, expect, it } from "vitest";
import {
  distributionWalletSchema,
  profitClaimRequestSchema,
  profitClaimResponseSchema,
  profitDistributionRunRequestSchema,
  profitDistributionRunResponseSchema,
  profitDistributionSchema,
  positionRevenuePolicySchema,
  upsertDistributionWalletSchema,
  upsertPositionRevenuePolicySchema
} from "../src/schemas/profit";

describe("profit schemas", () => {
  it("accepts distribution run request/response", () => {
    const req = {
      wallet: "0x1111111111111111111111111111111111111111",
      chainId: 42161,
      distributionAt: new Date().toISOString()
    };
    expect(profitDistributionRunRequestSchema.safeParse(req).success).toBe(true);

    const res = {
      ok: true,
      distributionId: "dist-1",
      itemId: "item-1",
      itemCount: 1,
      totalProfitUsd: 12.34,
      autoPayout: false
    };
    expect(profitDistributionRunResponseSchema.safeParse(res).success).toBe(true);
  });

  it("accepts distribution payload", () => {
    const payload = {
      id: "dist-1",
      distributionAt: new Date().toISOString(),
      status: "CALCULATED",
      source: "LP",
      chainId: 42161,
      totalProfitUsd: 10,
      txHash: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      executedAt: null,
      items: [
        {
          id: "item-1",
          wallet: "0x1111111111111111111111111111111111111111",
          amountUsd: 10,
          tokenAddress: null,
          amountToken: null,
          status: "CLAIMABLE",
          paidTxHash: null,
          claimedAt: null,
          autoPayout: false
        }
      ]
    };
    expect(profitDistributionSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts claim request/response", () => {
    const req = {
      distributionItemId: "item-1",
      idempotencyKey: "claim-item-1-attempt-1",
      chainId: 42161,
      waitForConfirmation: true,
      txRequest: {
        to: "0x1111111111111111111111111111111111111111",
        data: "0xabcdef",
        value: "0"
      }
    };
    expect(profitClaimRequestSchema.safeParse(req).success).toBe(true);

    const reqWithPaidTxHash = {
      distributionItemId: "item-1",
      paidTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
    };
    expect(profitClaimRequestSchema.safeParse(reqWithPaidTxHash).success).toBe(true);

    const res = {
      ok: true,
      distributionItemId: "item-1",
      status: "PAID",
      claimedAt: new Date().toISOString(),
      paidTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
    };
    expect(profitClaimResponseSchema.safeParse(res).success).toBe(true);
  });

  it("accepts distribution wallet settings", () => {
    const upsert = {
      wallet: "0x1111111111111111111111111111111111111111",
      enabled: true,
      payoutMode: "AUTO",
      minPayoutUsd: 15,
      destination: "0x1111111111111111111111111111111111111111"
    };
    expect(upsertDistributionWalletSchema.safeParse(upsert).success).toBe(true);
    expect(distributionWalletSchema.safeParse(upsert).success).toBe(true);
  });

  it("accepts revenue policy settings", () => {
    const upsert = {
      wallet: "0x1111111111111111111111111111111111111111",
      positionId: "123",
      ownerShareBps: 7000,
      operatorShareBps: 2000,
      platformShareBps: 1000,
      active: true
    };
    expect(upsertPositionRevenuePolicySchema.safeParse(upsert).success).toBe(true);
    expect(
      positionRevenuePolicySchema.safeParse({
        positionId: "123",
        ownerShareBps: 7000,
        operatorShareBps: 2000,
        platformShareBps: 1000,
        active: true,
        effectiveFrom: new Date().toISOString()
      }).success
    ).toBe(true);
  });
});
