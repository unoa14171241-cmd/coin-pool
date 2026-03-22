import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid tx hash");

export const profitDistributionListQuerySchema = z.object({
  wallet: addressSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const profitDistributionItemSchema = z.object({
  id: z.string().min(1),
  wallet: addressSchema,
  amountUsd: z.number(),
  tokenAddress: addressSchema.nullable(),
  amountToken: z.string().nullable(),
  status: z.enum(["CLAIMABLE", "EXECUTING", "PAID", "FAILED"]),
  paidTxHash: txHashSchema.nullable(),
  claimedAt: z.string().datetime().nullable(),
  autoPayout: z.boolean()
});

export const profitDistributionSchema = z.object({
  id: z.string().min(1),
  distributionAt: z.string().datetime(),
  status: z.enum(["DRAFT", "CALCULATED", "EXECUTING", "COMPLETED", "FAILED"]),
  source: z.string().min(1),
  chainId: z.number().int().nullable(),
  totalProfitUsd: z.number(),
  txHash: txHashSchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  executedAt: z.string().datetime().nullable(),
  items: z.array(profitDistributionItemSchema)
});

export const profitClaimRequestSchema = z.object({
  distributionItemId: z.string().min(1),
  paidTxHash: txHashSchema.optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
  chainId: z.number().int().positive().optional(),
  waitForConfirmation: z.boolean().default(true),
  txRequest: z
    .object({
      to: addressSchema,
      data: z.string().regex(/^0x[0-9a-fA-F]*$/, "Invalid calldata hex"),
      value: z.string().optional(),
      gasLimit: z.string().optional(),
      maxFeePerGas: z.string().optional(),
      maxPriorityFeePerGas: z.string().optional()
    })
    .optional()
});

export const profitClaimResponseSchema = z.object({
  ok: z.literal(true),
  distributionItemId: z.string().min(1),
  status: z.enum(["PAID"]),
  claimedAt: z.string().datetime(),
  paidTxHash: txHashSchema.nullable()
});

export const distributionWalletSchema = z.object({
  wallet: addressSchema,
  enabled: z.boolean(),
  payoutMode: z.enum(["AUTO", "CLAIM"]),
  minPayoutUsd: z.number().nonnegative(),
  destination: addressSchema.nullable()
});

export const upsertDistributionWalletSchema = z.object({
  wallet: addressSchema,
  enabled: z.boolean().default(true),
  payoutMode: z.enum(["AUTO", "CLAIM"]).default("CLAIM"),
  minPayoutUsd: z.number().nonnegative().default(10),
  destination: addressSchema.optional()
});

export const positionRevenuePolicySchema = z.object({
  positionId: z.string().min(1),
  ownerShareBps: z.number().int().min(0).max(10_000),
  operatorShareBps: z.number().int().min(0).max(10_000),
  platformShareBps: z.number().int().min(0).max(10_000),
  active: z.boolean(),
  effectiveFrom: z.string().datetime()
});

export const upsertPositionRevenuePolicySchema = z
  .object({
    wallet: addressSchema,
    positionId: z.string().min(1),
    ownerShareBps: z.number().int().min(0).max(10_000),
    operatorShareBps: z.number().int().min(0).max(10_000),
    platformShareBps: z.number().int().min(0).max(10_000),
    active: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.ownerShareBps + value.operatorShareBps + value.platformShareBps !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerShareBps"],
        message: "ownerShareBps + operatorShareBps + platformShareBps must equal 10000"
      });
    }
  });

export const dailyDistributionTriggerRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotencyKey: z.string().min(8).max(200)
});

export const profitDistributionRunRequestSchema = z.object({
  wallet: addressSchema,
  chainId: z.number().int().optional(),
  distributionAt: z.string().datetime().optional()
});

export const profitDistributionRunResponseSchema = z.object({
  ok: z.literal(true),
  distributionId: z.string().min(1),
  itemId: z.string().min(1),
  itemCount: z.number().int().min(1),
  totalProfitUsd: z.number(),
  autoPayout: z.boolean()
});
