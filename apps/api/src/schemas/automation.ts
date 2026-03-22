import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
const queryBooleanSchema = z.preprocess(
  (value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
    return value;
  },
  z.boolean()
);

export const automationEvaluateRequestSchema = z.object({
  wallet: addressSchema,
  mode: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).optional()
});

export const automationOperatorPermissionSchema = z.object({
  ownerWallet: addressSchema,
  operatorWallet: addressSchema,
  canEvaluate: z.boolean(),
  canExecute: z.boolean(),
  canPause: z.boolean(),
  canChangeStrategy: z.boolean(),
  active: z.boolean(),
  updatedAt: z.string().datetime()
});

export const upsertAutomationOperatorRequestSchema = z.object({
  ownerWallet: addressSchema,
  operatorWallet: addressSchema,
  canEvaluate: z.boolean().default(true),
  canExecute: z.boolean().default(false),
  canPause: z.boolean().default(false),
  canChangeStrategy: z.boolean().default(false),
  active: z.boolean().default(true)
});

export const automationEvaluateResponseSchema = z.object({
  ok: z.literal(true),
  wallet: addressSchema,
  actorRole: z.enum(["owner", "operator"]),
  triggeredByWallet: addressSchema,
  mode: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]),
  executionEnabled: z.boolean(),
  minimumNetBenefitUsd: z.number().nonnegative(),
  autoCompoundEnabled: z.boolean(),
  minimumCompoundFeesUsd: z.number().nonnegative(),
  note: z.string().min(1)
});

export const automationSmokeRequestSchema = z.object({
  wallet: addressSchema,
  mode: z.enum(["DRY_RUN", "LIVE"]).default("DRY_RUN"),
  chainId: z.number().int().positive().optional(),
  allowLiveSubmission: z.boolean().default(false),
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

export const automationSmokeResponseSchema = z.object({
  ok: z.literal(true),
  wallet: addressSchema,
  mode: z.enum(["DRY_RUN", "LIVE"]),
  actorRole: z.enum(["owner", "operator"]),
  triggeredByWallet: addressSchema,
  jobId: z.string().min(1),
  executionId: z.string().min(1).nullable(),
  executionStatus: z.string().nullable(),
  txStatus: z.string().nullable(),
  txHash: z.string().nullable(),
  note: z.string().min(1)
});

export const automationJobTypeSchema = z.enum(["EVALUATE", "REBALANCE", "COLLECT", "COMPOUND", "DISTRIBUTE"]);
export const automationJobStatusSchema = z.enum([
  "QUEUED",
  "LEASED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER"
]);

export const automationExecuteRequestSchema = z.object({
  wallet: addressSchema,
  positionId: z.string().min(1).optional(),
  chainId: z.number().int().optional(),
  type: automationJobTypeSchema,
  idempotencyKey: z.string().min(8).max(200),
  priority: z.number().int().min(1).max(1000).optional(),
  executeNow: z.boolean().default(true),
  payload: z
    .object({
      estimatedGasUsd: z.number().nonnegative().optional(),
      expectedProfitUsd: z.number().optional(),
      volatilityScore: z.number().min(0).max(1).optional(),
      oracleDeviationBps: z.number().int().min(0).optional(),
      poolLiquidityUsd: z.number().nonnegative().optional(),
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
    })
    .passthrough()
    .optional()
});

export const automationExecuteResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string().min(1),
  status: z.enum(["QUEUED", "SUCCEEDED", "FAILED", "DEAD_LETTER", "RUNNING", "LEASED", "CANCELLED"]),
  executedNow: z.boolean(),
  actorRole: z.enum(["owner", "operator"]),
  triggeredByWallet: addressSchema
});

const executionStatusFilterSchema = z.enum(["all", "success", "failed", "precheck_failed"]);

export const automationExecutionListQuerySchema = z.object({
  wallet: addressSchema.optional(),
  jobId: z.string().min(1).optional(),
  status: executionStatusFilterSchema.optional().default("all"),
  ids: z.preprocess(
    (value) => {
      if (value == null) return undefined;
      const rawValues = Array.isArray(value) ? value : [value];
      const tokens = rawValues
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return tokens;
    },
    z.array(z.string().min(1)).max(200).optional()
  ),
  includePayload: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const automationExecutionItemSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  wallet: addressSchema,
  positionId: z.string().nullable(),
  chainId: z.number().int().nullable(),
  type: automationJobTypeSchema,
  status: z.string().min(1),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  txHash: z.string().nullable(),
  txStatus: z.string().nullable(),
  costUsd: z.number().nullable(),
  profitUsd: z.number().nullable(),
  netProfitUsd: z.number().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  context: z.unknown().nullable().optional()
});

export const automationPolicySchema = z.object({
  id: z.string().min(1),
  wallet: addressSchema,
  positionId: z.string().nullable(),
  enabled: z.boolean(),
  mode: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]),
  minNetBenefitUsd: z.number().nonnegative(),
  maxGasUsd: z.number().positive(),
  maxSlippageBps: z.number().int().min(1).max(500),
  cooldownMinutes: z.number().int().min(0),
  staleSnapshotReject: z.boolean(),
  autoCollectEnabled: z.boolean(),
  autoCompoundEnabled: z.boolean(),
  autoRebalanceEnabled: z.boolean(),
  updatedAt: z.string().datetime()
});

export const upsertAutomationPolicyRequestSchema = z.object({
  wallet: addressSchema,
  positionId: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  mode: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).default("BALANCED"),
  minNetBenefitUsd: z.number().nonnegative().default(0),
  maxGasUsd: z.number().positive().default(20),
  maxSlippageBps: z.number().int().min(1).max(500).default(100),
  cooldownMinutes: z.number().int().min(0).default(60),
  staleSnapshotReject: z.boolean().default(true),
  autoCollectEnabled: z.boolean().default(true),
  autoCompoundEnabled: z.boolean().default(false),
  autoRebalanceEnabled: z.boolean().default(false)
});

export const automationPolicyListQuerySchema = z.object({
  wallet: addressSchema,
  positionId: z.string().min(1).optional()
});

export const automationWorkerTickRequestSchema = z.object({
  wallet: addressSchema,
  maxJobs: z.number().int().min(1).max(50).default(5),
  workerId: z.string().min(1).max(120).optional(),
  retryFailedLimit: z.number().int().min(0).max(100).default(0)
});

export const automationWorkerTickResponseSchema = z.object({
  ok: z.literal(true),
  wallet: addressSchema,
  processed: z.number().int().min(0),
  failed: z.number().int().min(0),
  requeued: z.number().int().min(0),
  workerId: z.string().min(1)
});

export const automationMetricsQuerySchema = z.object({
  wallet: addressSchema.optional(),
  chainId: z.coerce.number().int().positive().optional(),
  type: automationJobTypeSchema.optional(),
  since: z.string().datetime().optional(),
  errorCodeLimit: z.coerce.number().int().min(1).max(100).default(20),
  trendBucket: z.enum(["15m", "1h"]).default("1h"),
  trendLimit: z.coerce.number().int().min(1).max(200).default(48)
});

export const automationJobListQuerySchema = z.object({
  wallet: addressSchema.optional(),
  status: automationJobStatusSchema.optional(),
  type: automationJobTypeSchema.optional(),
  ids: z.preprocess(
    (value) => {
      if (value == null) return undefined;
      const rawValues = Array.isArray(value) ? value : [value];
      const tokens = rawValues
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return tokens;
    },
    z.array(z.string().min(1)).max(200).optional()
  ),
  includePayload: queryBooleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const automationJobItemSchema = z.object({
  id: z.string().min(1),
  wallet: addressSchema,
  positionId: z.string().nullable(),
  chainId: z.number().int().nullable(),
  type: automationJobTypeSchema,
  status: automationJobStatusSchema,
  priority: z.number().int(),
  scheduledAt: z.string().datetime(),
  leaseUntil: z.string().datetime().nullable(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
  payload: z.unknown().nullable().optional(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
