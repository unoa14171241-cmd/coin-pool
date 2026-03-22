import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

export const automationExecutionModeSchema = z.enum(["MANUAL_APPROVAL", "AUTO_EXECUTE"]);
export const compoundScheduleModeSchema = z.enum(["DAILY", "WEEKLY", "THRESHOLD"]);

export const upsertAutomationSettingRequestSchema = z.object({
  wallet: addressSchema,
  positionId: z.string().min(1).optional(),
  chainId: z.number().int().positive(),
  strategyTemplateId: z.string().min(1).optional(),
  executionMode: automationExecutionModeSchema.default("MANUAL_APPROVAL"),
  autoRebalanceEnabled: z.boolean().default(false),
  autoCompoundEnabled: z.boolean().default(false),
  compoundSchedule: compoundScheduleModeSchema.default("THRESHOLD"),
  minCompoundUsd: z.number().nonnegative().optional(),
  maxGasUsd: z.number().nonnegative().optional(),
  emergencyPaused: z.boolean().default(false)
});

export const automationSettingListQuerySchema = z.object({
  wallet: addressSchema,
  chainId: z.coerce.number().int().positive().optional(),
  positionId: z.string().min(1).optional(),
  fallback: z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
    return value;
  }, z.boolean().default(true))
});

export const automationSettingResponseSchema = z.object({
  id: z.string().min(1),
  wallet: addressSchema,
  positionId: z.string().nullable(),
  chainId: z.number().int().positive(),
  strategyTemplateId: z.string().nullable(),
  executionMode: automationExecutionModeSchema,
  autoRebalanceEnabled: z.boolean(),
  autoCompoundEnabled: z.boolean(),
  compoundSchedule: compoundScheduleModeSchema,
  minCompoundUsd: z.number().nullable(),
  maxGasUsd: z.number().nullable(),
  emergencyPaused: z.boolean(),
  source: z.enum(["automation_setting", "policy_fallback"]).optional(),
  updatedByWallet: addressSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

