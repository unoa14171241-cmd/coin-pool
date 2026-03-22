import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

export const strategyRangeModeSchema = z.enum(["STATIC", "DYNAMIC", "VOLATILITY_BASED"]);
export const strategyRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const strategyTemplateSchema = z.object({
  strategyId: z.string().min(1).max(120),
  strategyName: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  targetChain: z.number().int().positive(),
  dexProtocol: z.string().min(1).max(80),
  tokenA: z.string().min(1).max(80),
  tokenB: z.string().min(1).max(80),
  poolFeeTier: z.number().int().min(1),
  rangeMode: strategyRangeModeSchema,
  rebalanceRule: z.record(z.unknown()),
  compoundRule: z.record(z.unknown()),
  riskLevel: strategyRiskLevelSchema,
  targetAPRNote: z.string().max(500).nullable().optional(),
  enabled: z.boolean(),
  recommendedMinCapital: z.number().nonnegative().nullable().optional(),
  gasCostWarning: z.string().max(500).nullable().optional(),
  operatorFeeRate: z.number().min(0).max(1),
  ownerProfitShareRate: z.number().min(0).max(1),
  createdByWallet: addressSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const createStrategyTemplateRequestSchema = strategyTemplateSchema
  .omit({ createdByWallet: true, createdAt: true, updatedAt: true })
  .extend({
    createVersion: z.boolean().default(true),
    changeSummary: z.string().max(300).optional()
  });

export const strategyTemplateListQuerySchema = z.object({
  targetChain: z.coerce.number().int().positive().optional(),
  dexProtocol: z.string().min(1).optional(),
  enabled: z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
    return value;
  }, z.boolean().optional()),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const createStrategyVersionRequestSchema = z.object({
  changeSummary: z.string().max(300).optional(),
  payload: z.record(z.unknown())
});

