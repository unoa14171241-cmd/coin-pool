/**
 * Emergency pause check for automation execution.
 *
 * SOURCE OF TRUTH: AutomationSetting.emergencyPaused
 * - AutomationSetting is the canonical source for emergency pause state.
 * - AutomationPolicy.enabled is synced from automation-settings when user saves;
 *   when emergencyPaused=true, AutomationPolicy.enabled=false.
 *
 * PRIORITY: position-specific > global (positionId IS NULL) > AutomationPolicy fallback
 *
 * EVALUATION ORDER:
 * 1. If positionId given: check AutomationSetting for (wallet, positionId, chainId)
 * 2. Else: check AutomationSetting for (wallet, positionId=NULL, chainId)
 * 3. Fallback: if AutomationPolicy.enabled=false for wallet, treat as paused
 *
 * When paused, no automation execution (rebalance/compound/etc.) must proceed.
 * This check runs BEFORE readPolicy/executeSingleJob in automation-executor.
 */
import { prisma } from "../db/prisma";

export type EmergencyCheckInput = {
  wallet: string;
  positionId?: string | null;
  chainId?: number | null;
};

export type EmergencyCheckResult = {
  paused: boolean;
  source: "position" | "global" | "none";
};

export async function checkEmergencyPaused(input: EmergencyCheckInput): Promise<EmergencyCheckResult> {
  const wallet = input.wallet.toLowerCase();
  const chainId = input.chainId ?? 42161;

  // 1. Position-specific setting (highest priority)
  if (input.positionId) {
    const positionRows = await prisma.$queryRaw<
      Array<{ emergencyPaused: boolean }>
    >`
      SELECT "emergencyPaused"
      FROM "AutomationSetting"
      WHERE "wallet" = ${wallet}
        AND "positionId" = ${input.positionId}
        AND "chainId" = ${chainId}
      LIMIT 1;
    `;
    if (positionRows.length > 0) {
      return {
        paused: positionRows[0].emergencyPaused,
        source: "position"
      };
    }
  }

  // 2. Global setting (positionId IS NULL)
  const globalRows = await prisma.$queryRaw<
    Array<{ emergencyPaused: boolean }>
  >`
    SELECT "emergencyPaused"
    FROM "AutomationSetting"
    WHERE "wallet" = ${wallet}
      AND "positionId" IS NULL
      AND "chainId" = ${chainId}
    LIMIT 1;
  `;
  if (globalRows.length > 0) {
    return {
      paused: globalRows[0].emergencyPaused,
      source: "global"
    };
  }

  // 3. Fallback: AutomationPolicy.enabled (synced from automation-settings when emergencyPaused is set)
  const policyRows = await prisma.$queryRaw<
    Array<{ enabled: boolean }>
  >`
    SELECT "enabled"
    FROM "AutomationPolicy"
    WHERE "wallet" = ${wallet}
      AND ("positionId" IS NULL OR "positionId" = ${input.positionId ?? null})
    ORDER BY CASE WHEN "positionId" IS NULL THEN 1 ELSE 0 END ASC, "updatedAt" DESC
    LIMIT 1;
  `;
  if (policyRows.length > 0 && !policyRows[0].enabled) {
    return { paused: true, source: "none" };
  }

  return { paused: false, source: "none" };
}
