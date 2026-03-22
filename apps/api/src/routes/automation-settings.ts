import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { Router } from "express";
import { requireWalletSignature } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  automationSettingListQuerySchema,
  automationSettingResponseSchema,
  upsertAutomationSettingRequestSchema
} from "../schemas/automation-settings";
import { authorizeOwnerOrOperatorAction, normalizeWalletAddress } from "../services/auth/wallet-authorization";
import { writeAuditLogV2 } from "../services/audit-v2";

const router = Router();

router.get("/automation/settings", requireWalletSignature, async (req, res) => {
  const parsed = automationSettingListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ownerWallet = normalizeWalletAddress(parsed.data.wallet);
  if (!ownerWallet) return res.status(400).json({ error: "Invalid wallet address format" });
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: ownerWallet,
    authWalletRaw: res.locals.authWallet,
    requireCanEvaluate: true
  });
  if (!auth.ok) return res.status(403).json({ error: "Operator is not authorized for this wallet" });
  const where: Prisma.Sql[] = [Prisma.sql`"wallet" = ${ownerWallet.toLowerCase()}`];
  if (parsed.data.chainId != null) where.push(Prisma.sql`"chainId" = ${parsed.data.chainId}`);
  if (parsed.data.positionId) where.push(Prisma.sql`"positionId" = ${parsed.data.positionId}`);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      wallet: string;
      positionId: string | null;
      chainId: number;
      strategyTemplateId: string | null;
      executionMode: "MANUAL_APPROVAL" | "AUTO_EXECUTE";
      autoRebalanceEnabled: boolean;
      autoCompoundEnabled: boolean;
      compoundSchedule: "DAILY" | "WEEKLY" | "THRESHOLD";
      minCompoundUsd: number | null;
      maxGasUsd: number | null;
      emergencyPaused: boolean;
      updatedByWallet: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT
      "id","wallet","positionId","chainId","strategyTemplateId","executionMode","autoRebalanceEnabled",
      "autoCompoundEnabled","compoundSchedule","minCompoundUsd","maxGasUsd","emergencyPaused",
      "updatedByWallet","createdAt","updatedAt"
    FROM "AutomationSetting"
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY "updatedAt" DESC
    LIMIT 200;
  `;
  if (rows.length > 0 || !parsed.data.fallback) {
    return res.json(
      rows.map((row) =>
        automationSettingResponseSchema.parse({
          ...row,
          source: "automation_setting",
          wallet: row.wallet.toLowerCase(),
          updatedByWallet: row.updatedByWallet.toLowerCase(),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString()
        })
      )
    );
  }
  const policyRows = await prisma.$queryRaw<
    Array<{
      id: string;
      wallet: string;
      positionId: string | null;
      enabled: boolean;
      mode: string;
      maxGasUsd: number;
      autoCompoundEnabled: boolean;
      autoRebalanceEnabled: boolean;
      updatedAt: Date;
      createdAt: Date;
    }>
  >`
    SELECT "id","wallet","positionId","enabled","mode","maxGasUsd","autoCompoundEnabled","autoRebalanceEnabled","updatedAt","createdAt"
    FROM "AutomationPolicy"
    WHERE "wallet" = ${ownerWallet.toLowerCase()}
      ${parsed.data.positionId ? Prisma.sql`AND "positionId" = ${parsed.data.positionId}` : Prisma.empty}
    ORDER BY "updatedAt" DESC
    LIMIT 200;
  `;
  const chainId = parsed.data.chainId ?? 42161;
  return res.json(
    policyRows.map((row) =>
      automationSettingResponseSchema.parse({
        id: row.id,
        wallet: row.wallet.toLowerCase(),
        positionId: row.positionId,
        chainId,
        strategyTemplateId: null,
        executionMode: row.enabled ? "AUTO_EXECUTE" : "MANUAL_APPROVAL",
        autoRebalanceEnabled: row.autoRebalanceEnabled,
        autoCompoundEnabled: row.autoCompoundEnabled,
        compoundSchedule: "THRESHOLD",
        minCompoundUsd: null,
        maxGasUsd: row.maxGasUsd ?? null,
        emergencyPaused: !row.enabled,
        source: "policy_fallback",
        updatedByWallet: ownerWallet.toLowerCase(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      })
    )
  );
});

router.post("/automation/settings", requireWalletSignature, async (req, res) => {
  const parsed = upsertAutomationSettingRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ownerWallet = normalizeWalletAddress(parsed.data.wallet);
  if (!ownerWallet) return res.status(400).json({ error: "Invalid wallet address format" });
  const authBase = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: ownerWallet,
    authWalletRaw: res.locals.authWallet,
    requireCanEvaluate: false,
    requireCanExecute: false,
    requireCanChangeStrategy: true
  });
  if (!authBase.ok) {
    if (authBase.reason === "invalid_auth_wallet") return res.status(401).json({ error: "Missing authenticated wallet" });
    if (authBase.reason === "operator_missing_can_change_strategy") {
      return res.status(403).json({ error: "Operator is not allowed to change strategy/settings" });
    }
    return res.status(403).json({ error: "Operator is not authorized for this wallet" });
  }
  const authWallet = authBase.authWallet;
  const data = parsed.data;
  const currentRows = await prisma.$queryRaw<Array<{ emergencyPaused: boolean }>>`
    SELECT "emergencyPaused"
    FROM "AutomationSetting"
    WHERE "wallet" = ${ownerWallet.toLowerCase()}
      AND "positionId" IS NOT DISTINCT FROM ${data.positionId ?? null}
      AND "chainId" = ${data.chainId}
    LIMIT 1;
  `;
  let currentPaused = currentRows[0]?.emergencyPaused;
  if (currentPaused == null) {
    const policyRows = await prisma.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT "enabled"
      FROM "AutomationPolicy"
      WHERE "wallet" = ${ownerWallet.toLowerCase()}
        AND "positionId" IS NOT DISTINCT FROM ${data.positionId ?? null}
      ORDER BY "updatedAt" DESC
      LIMIT 1;
    `;
    currentPaused = policyRows[0] ? !policyRows[0].enabled : false;
  }
  if (authBase.actorRole === "operator" && currentPaused !== data.emergencyPaused) {
    const authPause = await authorizeOwnerOrOperatorAction({
      targetOwnerWallet: ownerWallet,
      authWalletRaw: authWallet,
      requireCanEvaluate: false,
      requireCanExecute: false,
      requireCanPause: true
    });
    if (!authPause.ok) {
      if (authPause.reason === "operator_missing_can_pause") {
        return res.status(403).json({ error: "Operator is not allowed to pause/unpause automation" });
      }
      return res.status(403).json({ error: "Operator is not authorized for pause control" });
    }
  }
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      wallet: string;
      positionId: string | null;
      chainId: number;
      strategyTemplateId: string | null;
      executionMode: "MANUAL_APPROVAL" | "AUTO_EXECUTE";
      autoRebalanceEnabled: boolean;
      autoCompoundEnabled: boolean;
      compoundSchedule: "DAILY" | "WEEKLY" | "THRESHOLD";
      minCompoundUsd: number | null;
      maxGasUsd: number | null;
      emergencyPaused: boolean;
      updatedByWallet: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    INSERT INTO "AutomationSetting" (
      "id","wallet","positionId","chainId","strategyTemplateId","executionMode","autoRebalanceEnabled",
      "autoCompoundEnabled","compoundSchedule","minCompoundUsd","maxGasUsd","emergencyPaused","updatedByWallet","createdAt","updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${ownerWallet.toLowerCase()},
      ${data.positionId ?? null},
      ${data.chainId},
      ${data.strategyTemplateId ?? null},
      ${data.executionMode}::"AutomationExecutionMode",
      ${data.autoRebalanceEnabled},
      ${data.autoCompoundEnabled},
      ${data.compoundSchedule}::"CompoundScheduleMode",
      ${data.minCompoundUsd ?? null},
      ${data.maxGasUsd ?? null},
      ${data.emergencyPaused},
      ${authWallet.toLowerCase()},
      NOW(),
      NOW()
    )
    ON CONFLICT ("wallet","positionId","chainId")
    DO UPDATE SET
      "strategyTemplateId" = EXCLUDED."strategyTemplateId",
      "executionMode" = EXCLUDED."executionMode",
      "autoRebalanceEnabled" = EXCLUDED."autoRebalanceEnabled",
      "autoCompoundEnabled" = EXCLUDED."autoCompoundEnabled",
      "compoundSchedule" = EXCLUDED."compoundSchedule",
      "minCompoundUsd" = EXCLUDED."minCompoundUsd",
      "maxGasUsd" = EXCLUDED."maxGasUsd",
      "emergencyPaused" = EXCLUDED."emergencyPaused",
      "updatedByWallet" = EXCLUDED."updatedByWallet",
      "updatedAt" = NOW()
    RETURNING *;
  `;
  const row = rows[0];
  // Sync to AutomationPolicy: enabled = !emergencyPaused. AutomationSetting is source of truth;
  // listAutoManagedWallets and readPolicy use AutomationPolicy.enabled. checkEmergencyPaused uses
  // AutomationSetting first, so execution is blocked even if policy sync lags.
  await prisma.$executeRaw`
    INSERT INTO "AutomationPolicy" (
      "id","wallet","positionId","enabled","mode","minNetBenefitUsd","maxGasUsd","maxSlippageBps",
      "cooldownMinutes","staleSnapshotReject","autoCollectEnabled","autoCompoundEnabled","autoRebalanceEnabled",
      "createdAt","updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${ownerWallet.toLowerCase()},
      ${data.positionId ?? null},
      ${!data.emergencyPaused},
      ${"BALANCED"},
      0,
      ${data.maxGasUsd ?? 20},
      100,
      60,
      true,
      true,
      ${data.autoCompoundEnabled},
      ${data.autoRebalanceEnabled},
      NOW(),
      NOW()
    )
    ON CONFLICT ("wallet","positionId")
    DO UPDATE SET
      "enabled" = ${!data.emergencyPaused},
      "maxGasUsd" = ${data.maxGasUsd ?? 20},
      "autoCompoundEnabled" = ${data.autoCompoundEnabled},
      "autoRebalanceEnabled" = ${data.autoRebalanceEnabled},
      "updatedAt" = NOW();
  `;
  await writeAuditLogV2({
    actorWallet: authWallet,
    actorRole: authBase.actorRole === "owner" ? "OWNER" : "OPERATOR",
    action: "automation_setting_upsert",
    resourceType: "AutomationSetting",
    resourceId: row.id,
    payloadJson: {
      chainId: row.chainId,
      positionId: row.positionId,
      executionMode: row.executionMode,
      autoRebalanceEnabled: row.autoRebalanceEnabled,
      autoCompoundEnabled: row.autoCompoundEnabled,
      emergencyPaused: row.emergencyPaused
    }
  });
  return res.status(201).json(
    automationSettingResponseSchema.parse({
      ...row,
      source: "automation_setting",
      wallet: row.wallet.toLowerCase(),
      updatedByWallet: row.updatedByWallet.toLowerCase(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    })
  );
});

export default router;

