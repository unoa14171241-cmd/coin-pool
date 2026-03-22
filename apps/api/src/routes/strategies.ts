import { Prisma } from "@prisma/client";
import { Router } from "express";
import { randomUUID } from "crypto";
import { requireWalletSignature } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  createStrategyTemplateRequestSchema,
  createStrategyVersionRequestSchema,
  strategyTemplateListQuerySchema,
  strategyTemplateSchema
} from "../schemas/strategy";
import { normalizeWalletAddress } from "../services/auth/wallet-authorization";
import { writeAuditLogV2 } from "../services/audit-v2";

const router = Router();

router.get("/strategies", async (req, res) => {
  const parsed = strategyTemplateListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const where: Prisma.Sql[] = [];
  if (parsed.data.targetChain != null) where.push(Prisma.sql`"targetChain" = ${parsed.data.targetChain}`);
  if (parsed.data.dexProtocol) where.push(Prisma.sql`"dexProtocol" = ${parsed.data.dexProtocol}`);
  if (parsed.data.enabled != null) where.push(Prisma.sql`"enabled" = ${parsed.data.enabled}`);
  const whereSql = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<{
      strategyId: string;
      strategyName: string;
      description: string;
      targetChain: number;
      dexProtocol: string;
      tokenA: string;
      tokenB: string;
      poolFeeTier: number;
      rangeMode: "STATIC" | "DYNAMIC" | "VOLATILITY_BASED";
      rebalanceRule: unknown;
      compoundRule: unknown;
      riskLevel: "LOW" | "MEDIUM" | "HIGH";
      targetAPRNote: string | null;
      enabled: boolean;
      recommendedMinCapital: number | null;
      gasCostWarning: string | null;
      operatorFeeRate: number;
      ownerProfitShareRate: number;
      createdByWallet: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT
      "strategyId","strategyName","description","targetChain","dexProtocol","tokenA","tokenB","poolFeeTier",
      "rangeMode","rebalanceRule","compoundRule","riskLevel","targetAPRNote","enabled","recommendedMinCapital",
      "gasCostWarning","operatorFeeRate","ownerProfitShareRate","createdByWallet","createdAt","updatedAt"
    FROM "StrategyTemplate"
    ${whereSql}
    ORDER BY "updatedAt" DESC
    LIMIT ${parsed.data.limit};
  `;
  return res.json(
    rows.map((row) =>
      strategyTemplateSchema.parse({
        ...row,
        createdByWallet: row.createdByWallet.toLowerCase(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      })
    )
  );
});

router.get("/strategies/:strategyId", async (req, res) => {
  const strategyId = String(req.params.strategyId ?? "");
  if (!strategyId) return res.status(400).json({ error: "strategyId is required" });
  const rows = await prisma.$queryRaw<
    Array<{
      strategyId: string;
      strategyName: string;
      description: string;
      targetChain: number;
      dexProtocol: string;
      tokenA: string;
      tokenB: string;
      poolFeeTier: number;
      rangeMode: "STATIC" | "DYNAMIC" | "VOLATILITY_BASED";
      rebalanceRule: unknown;
      compoundRule: unknown;
      riskLevel: "LOW" | "MEDIUM" | "HIGH";
      targetAPRNote: string | null;
      enabled: boolean;
      recommendedMinCapital: number | null;
      gasCostWarning: string | null;
      operatorFeeRate: number;
      ownerProfitShareRate: number;
      createdByWallet: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT
      "strategyId","strategyName","description","targetChain","dexProtocol","tokenA","tokenB","poolFeeTier",
      "rangeMode","rebalanceRule","compoundRule","riskLevel","targetAPRNote","enabled","recommendedMinCapital",
      "gasCostWarning","operatorFeeRate","ownerProfitShareRate","createdByWallet","createdAt","updatedAt"
    FROM "StrategyTemplate"
    WHERE "strategyId" = ${strategyId}
    LIMIT 1;
  `;
  if (rows.length === 0) return res.status(404).json({ error: "Strategy not found" });
  const row = rows[0];
  return res.json(
    strategyTemplateSchema.parse({
      ...row,
      createdByWallet: row.createdByWallet.toLowerCase(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    })
  );
});

router.post("/admin/strategies", requireWalletSignature, async (req, res) => {
  const parsed = createStrategyTemplateRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) return res.status(401).json({ error: "Missing authenticated wallet" });
  const data = parsed.data;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      strategyId: string;
      strategyName: string;
      description: string;
      targetChain: number;
      dexProtocol: string;
      tokenA: string;
      tokenB: string;
      poolFeeTier: number;
      rangeMode: "STATIC" | "DYNAMIC" | "VOLATILITY_BASED";
      rebalanceRule: unknown;
      compoundRule: unknown;
      riskLevel: "LOW" | "MEDIUM" | "HIGH";
      targetAPRNote: string | null;
      enabled: boolean;
      recommendedMinCapital: number | null;
      gasCostWarning: string | null;
      operatorFeeRate: number;
      ownerProfitShareRate: number;
      createdByWallet: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    INSERT INTO "StrategyTemplate" (
      "id","strategyId","strategyName","description","targetChain","dexProtocol","tokenA","tokenB","poolFeeTier",
      "rangeMode","rebalanceRule","compoundRule","riskLevel","targetAPRNote","enabled","recommendedMinCapital",
      "gasCostWarning","operatorFeeRate","ownerProfitShareRate","createdByWallet","createdAt","updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${data.strategyId},
      ${data.strategyName},
      ${data.description},
      ${data.targetChain},
      ${data.dexProtocol},
      ${data.tokenA},
      ${data.tokenB},
      ${data.poolFeeTier},
      ${data.rangeMode}::"StrategyRangeMode",
      ${JSON.stringify(data.rebalanceRule)}::jsonb,
      ${JSON.stringify(data.compoundRule)}::jsonb,
      ${data.riskLevel}::"StrategyRiskLevel",
      ${data.targetAPRNote ?? null},
      ${data.enabled},
      ${data.recommendedMinCapital ?? null},
      ${data.gasCostWarning ?? null},
      ${data.operatorFeeRate},
      ${data.ownerProfitShareRate},
      ${authWallet.toLowerCase()},
      NOW(),
      NOW()
    )
    ON CONFLICT ("strategyId")
    DO UPDATE SET
      "strategyName" = EXCLUDED."strategyName",
      "description" = EXCLUDED."description",
      "targetChain" = EXCLUDED."targetChain",
      "dexProtocol" = EXCLUDED."dexProtocol",
      "tokenA" = EXCLUDED."tokenA",
      "tokenB" = EXCLUDED."tokenB",
      "poolFeeTier" = EXCLUDED."poolFeeTier",
      "rangeMode" = EXCLUDED."rangeMode",
      "rebalanceRule" = EXCLUDED."rebalanceRule",
      "compoundRule" = EXCLUDED."compoundRule",
      "riskLevel" = EXCLUDED."riskLevel",
      "targetAPRNote" = EXCLUDED."targetAPRNote",
      "enabled" = EXCLUDED."enabled",
      "recommendedMinCapital" = EXCLUDED."recommendedMinCapital",
      "gasCostWarning" = EXCLUDED."gasCostWarning",
      "operatorFeeRate" = EXCLUDED."operatorFeeRate",
      "ownerProfitShareRate" = EXCLUDED."ownerProfitShareRate",
      "updatedAt" = NOW()
    RETURNING *;
  `;
  const row = rows[0];
  if (parsed.data.createVersion) {
    const versionRows = await prisma.$queryRaw<Array<{ maxVersion: number | null }>>`
      SELECT MAX("version") as "maxVersion"
      FROM "StrategyTemplateVersion"
      WHERE "templateId" = ${row.id};
    `;
    const version = (versionRows[0]?.maxVersion ?? 0) + 1;
    await prisma.$executeRaw`
      INSERT INTO "StrategyTemplateVersion" ("id","templateId","version","payload","changeSummary","createdByWallet","createdAt")
      VALUES (
        ${randomUUID()},
        ${row.id},
        ${version},
        ${JSON.stringify(parsed.data)}::jsonb,
        ${parsed.data.changeSummary ?? null},
        ${authWallet.toLowerCase()},
        NOW()
      );
    `;
  }
  await writeAuditLogV2({
    actorWallet: authWallet,
    actorRole: "OWNER",
    action: "strategy_template_upsert",
    resourceType: "StrategyTemplate",
    resourceId: row.strategyId,
    payloadJson: {
      strategyId: row.strategyId,
      enabled: row.enabled
    }
  });
  return res.status(201).json(
    strategyTemplateSchema.parse({
      ...row,
      createdByWallet: row.createdByWallet.toLowerCase(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    })
  );
});

router.post("/admin/strategies/:strategyId/versions", requireWalletSignature, async (req, res) => {
  const strategyId = String(req.params.strategyId ?? "");
  const parsed = createStrategyVersionRequestSchema.safeParse(req.body);
  if (!strategyId) return res.status(400).json({ error: "strategyId is required" });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) return res.status(401).json({ error: "Missing authenticated wallet" });
  const templates = await prisma.$queryRaw<Array<{ id: string; strategyId: string }>>`
    SELECT "id","strategyId"
    FROM "StrategyTemplate"
    WHERE "strategyId" = ${strategyId}
    LIMIT 1;
  `;
  if (templates.length === 0) return res.status(404).json({ error: "Strategy not found" });
  const template = templates[0];
  const versionRows = await prisma.$queryRaw<Array<{ maxVersion: number | null }>>`
    SELECT MAX("version") as "maxVersion"
    FROM "StrategyTemplateVersion"
    WHERE "templateId" = ${template.id};
  `;
  const nextVersion = (versionRows[0]?.maxVersion ?? 0) + 1;
  await prisma.$executeRaw`
    INSERT INTO "StrategyTemplateVersion" ("id","templateId","version","payload","changeSummary","createdByWallet","createdAt")
    VALUES (
      ${randomUUID()},
      ${template.id},
      ${nextVersion},
      ${JSON.stringify(parsed.data.payload)}::jsonb,
      ${parsed.data.changeSummary ?? null},
      ${authWallet.toLowerCase()},
      NOW()
    );
  `;
  await writeAuditLogV2({
    actorWallet: authWallet,
    actorRole: "OWNER",
    action: "strategy_template_version_created",
    resourceType: "StrategyTemplate",
    resourceId: template.strategyId,
    payloadJson: {
      version: nextVersion
    }
  });
  return res.status(201).json({ ok: true, strategyId: template.strategyId, version: nextVersion });
});

export default router;

