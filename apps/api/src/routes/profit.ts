import { randomUUID } from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { requireWalletSignature } from "../auth/middleware";
import { authorizeOwnerOrOperatorAction, normalizeWalletAddress } from "../services/auth/wallet-authorization";
import {
  dailyDistributionTriggerRequestSchema,
  distributionWalletSchema,
  profitClaimRequestSchema,
  profitClaimResponseSchema,
  profitDistributionListQuerySchema,
  profitDistributionRunRequestSchema,
  profitDistributionRunResponseSchema,
  profitDistributionSchema,
  positionRevenuePolicySchema,
  upsertDistributionWalletSchema,
  upsertPositionRevenuePolicySchema
} from "../schemas/profit";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";
import { createDailyProfitDistribution } from "../services/daily-profit-engine";
import { runDailyDistributionForDate } from "../services/daily-distribution-scheduler";
import { confirmAutomationTxOnchain, submitAutomationTxViaRelayer } from "../services/automation-tx-relayer";
import { writeAuditLogV2 } from "../services/audit-v2";
import { env } from "../config/env";

const router = Router();

type DistributionRow = {
  id: string;
  distributionAt: Date;
  status: "DRAFT" | "CALCULATED" | "EXECUTING" | "COMPLETED" | "FAILED";
  source: string;
  chainId: number | null;
  totalProfitUsd: number;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: Date;
  executedAt: Date | null;
};

type DistributionItemRow = {
  id: string;
  distributionId: string;
  wallet: string;
  amountUsd: number;
  tokenAddress: string | null;
  amountToken: string | null;
  status: "CLAIMABLE" | "EXECUTING" | "PAID" | "FAILED";
  paidTxHash: string | null;
  claimedAt: Date | null;
  autoPayout: boolean;
};

router.get("/profit/distribution-wallets/:wallet", requireWalletSignature, async (req, res) => {
  const targetWallet = normalizeWalletAddress(String(req.params.wallet ?? ""));
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!targetWallet || !authWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  if (targetWallet.toLowerCase() !== authWallet.toLowerCase()) {
    return res.status(403).json({ error: "Only wallet owner can read distribution wallet settings" });
  }
  const rows = await prisma.$queryRaw<Array<{ wallet: string; enabled: boolean; payoutMode: "AUTO" | "CLAIM"; minPayoutUsd: number; destination: string | null }>>`
    SELECT "wallet","enabled","payoutMode","minPayoutUsd","destination"
    FROM "DistributionWallet"
    WHERE "wallet" = ${targetWallet}
    LIMIT 1;
  `;
  if (rows.length === 0) {
    return res.json(
      distributionWalletSchema.parse({
        wallet: targetWallet,
        enabled: true,
        payoutMode: "CLAIM",
        minPayoutUsd: 10,
        destination: null
      })
    );
  }
  return res.json(distributionWalletSchema.parse(rows[0]));
});

router.post("/profit/distribution-wallets", requireWalletSignature, async (req, res) => {
  const parsed = upsertDistributionWalletSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  const wallet = normalizeWalletAddress(parsed.data.wallet);
  if (!authWallet || !wallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  if (authWallet.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: "Only wallet owner can update distribution wallet settings" });
  }
  await prisma.$executeRaw`
    INSERT INTO "DistributionWallet" (
      "id","wallet","enabled","payoutMode","minPayoutUsd","destination","createdAt","updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${wallet},
      ${parsed.data.enabled},
      ${parsed.data.payoutMode}::"PayoutMode",
      ${parsed.data.minPayoutUsd},
      ${parsed.data.destination ?? null},
      NOW(),
      NOW()
    )
    ON CONFLICT ("wallet")
    DO UPDATE SET
      "enabled" = EXCLUDED."enabled",
      "payoutMode" = EXCLUDED."payoutMode",
      "minPayoutUsd" = EXCLUDED."minPayoutUsd",
      "destination" = EXCLUDED."destination",
      "updatedAt" = NOW();
  `;
  return res.status(201).json({ ok: true });
});

router.get("/profit/revenue-policies/:wallet", requireWalletSignature, async (req, res) => {
  const targetWallet = normalizeWalletAddress(String(req.params.wallet ?? ""));
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!targetWallet || !authWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: targetWallet,
    authWalletRaw: authWallet,
    requireCanEvaluate: true,
    requireCanExecute: false
  });
  if (!auth.ok) {
    return res.status(403).json({ error: "Wallet is not authorized for this revenue policy view" });
  }
  const rows = await prisma.$queryRaw<
    Array<{
      positionId: string;
      ownerShareBps: number;
      operatorShareBps: number;
      platformShareBps: number;
      active: boolean;
      effectiveFrom: Date;
    }>
  >`
    SELECT rp."positionId", rp."ownerShareBps", rp."operatorShareBps", rp."platformShareBps", rp."active", rp."effectiveFrom"
    FROM "PositionRevenuePolicy" rp
    INNER JOIN "Position" p ON p."positionId" = rp."positionId"
    WHERE p."wallet" = ${targetWallet}
    ORDER BY rp."updatedAt" DESC;
  `;
  return res.json(
    rows.map((row) =>
      positionRevenuePolicySchema.parse({
        ...row,
        effectiveFrom: row.effectiveFrom.toISOString()
      })
    )
  );
});

router.post("/profit/revenue-policies", requireWalletSignature, async (req, res) => {
  const parsed = upsertPositionRevenuePolicySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const wallet = normalizeWalletAddress(parsed.data.wallet);
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!wallet || !authWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  if (wallet.toLowerCase() !== authWallet.toLowerCase()) {
    return res.status(403).json({ error: "Only wallet owner can upsert revenue policy" });
  }
  const ownedRows = await prisma.$queryRaw<Array<{ positionId: string }>>`
    SELECT "positionId"
    FROM "Position"
    WHERE "wallet" = ${wallet}
      AND "positionId" = ${parsed.data.positionId}
    LIMIT 1;
  `;
  if (ownedRows.length === 0) {
    return res.status(404).json({ error: "Position not found for wallet" });
  }
  await prisma.$executeRaw`
    INSERT INTO "PositionRevenuePolicy" (
      "id","positionId","ownerShareBps","operatorShareBps","platformShareBps","effectiveFrom","active","createdAt","updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${parsed.data.positionId},
      ${parsed.data.ownerShareBps},
      ${parsed.data.operatorShareBps},
      ${parsed.data.platformShareBps},
      NOW(),
      ${parsed.data.active},
      NOW(),
      NOW()
    )
    ON CONFLICT ("positionId")
    DO UPDATE SET
      "ownerShareBps" = EXCLUDED."ownerShareBps",
      "operatorShareBps" = EXCLUDED."operatorShareBps",
      "platformShareBps" = EXCLUDED."platformShareBps",
      "active" = EXCLUDED."active",
      "effectiveFrom" = NOW(),
      "updatedAt" = NOW();
  `;
  return res.status(201).json({ ok: true });
});

router.post("/profit/daily-distribution/trigger", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }

  const allowedCallers = new Set([
    env.PLATFORM_WALLET.toLowerCase(),
    ...env.ADMIN_WALLETS
  ]);
  if (!allowedCallers.has(authWallet.toLowerCase())) {
    return res.status(403).json({
      error: "Only platform owner (PLATFORM_WALLET) or admin (ADMIN_WALLETS) can trigger daily distribution"
    });
  }

  const parsed = dailyDistributionTriggerRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const targetDate = parsed.data.date
    ? new Date(String(parsed.data.date) + "T00:00:00.000Z")
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const targetDateStr = targetDate.toISOString().slice(0, 10);
  const idempotencyKey = parsed.data.idempotencyKey;
  const callerWallet = authWallet.toLowerCase();

  const existing = await prisma.$queryRaw<
    Array<{ id: string; status: string; resultJson: Prisma.JsonValue }>
  >`
    SELECT "id", "status", "resultJson"
    FROM "DailyDistributionTrigger"
    WHERE "callerWallet" = ${callerWallet}
      AND "idempotencyKey" = ${idempotencyKey}
    LIMIT 1
  `;
  if (existing.length > 0) {
    const row = existing[0];
    if (row.status === "PENDING") {
      return res.status(409).json({
        error: "idempotency_conflict",
        message: "A trigger with this idempotencyKey is already in progress"
      });
    }
    const completedStatuses = ["COMPLETED", "COMPLETED_SUCCESS", "COMPLETED_PARTIAL"];
    if (completedStatuses.includes(row.status) && row.resultJson) {
      const cached = row.resultJson as Record<string, unknown>;
      return res.json({
        ok: true,
        ...cached,
        cached: true,
        elapsedMs: Date.now() - startedAt
      });
    }
  }

  let inserted: Array<{ id: string; status: string }> = [];
  try {
    inserted = await prisma.$queryRaw<
      Array<{ id: string; status: string }>
    >`
      INSERT INTO "DailyDistributionTrigger" (
        "id", "callerWallet", "idempotencyKey", "targetDate", "targetDateStr", "status", "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${callerWallet},
        ${idempotencyKey},
        ${targetDate},
        ${targetDateStr},
        'PENDING',
        NOW(),
        NOW()
      )
      RETURNING "id", "status"
    `;
  } catch (insertErr: unknown) {
    const code = insertErr && typeof insertErr === "object" && "code" in insertErr ? (insertErr as { code: string }).code : "";
    const isUniqueViolation = code === "23505" || code === "P2002";
    if (!isUniqueViolation) throw insertErr;

    const byDate = await prisma.$queryRaw<
      Array<{ status: string; resultJson: Prisma.JsonValue }>
    >`
      SELECT "status", "resultJson"
      FROM "DailyDistributionTrigger"
      WHERE "targetDateStr" = ${targetDateStr}
      LIMIT 1
    `;
    if (byDate.length > 0) {
      const row = byDate[0];
      if (
        (row.status === "COMPLETED_SUCCESS" || row.status === "COMPLETED_PARTIAL") &&
        row.resultJson
      ) {
        const cached = row.resultJson as Record<string, unknown>;
        return res.json({
          ok: true,
          ...cached,
          cached: true,
          elapsedMs: Date.now() - startedAt
        });
      }
      return res.status(409).json({
        error: "target_date_already_triggered",
        message: `Daily distribution for ${targetDateStr} is already PENDING or FAILED. One trigger per target date globally.`
      });
    }

    const byKey = await prisma.$queryRaw<
      Array<{ status: string; resultJson: Prisma.JsonValue }>
    >`
      SELECT "status", "resultJson"
      FROM "DailyDistributionTrigger"
      WHERE "callerWallet" = ${callerWallet}
        AND "idempotencyKey" = ${idempotencyKey}
      LIMIT 1
    `;
    if (byKey.length > 0 && byKey[0].status !== "PENDING" && byKey[0].resultJson) {
      const cached = (byKey[0].resultJson as Record<string, unknown>);
      return res.json({
        ok: true,
        ...cached,
        cached: true,
        elapsedMs: Date.now() - startedAt
      });
    }
    return res.status(409).json({
      error: "idempotency_conflict",
      message: "A trigger with this idempotencyKey already exists"
    });
  }

  if (inserted.length === 0) {
    return res.status(500).json({ error: "Insert failed unexpectedly" });
  }

  const triggerId = inserted[0].id;
  const actorRole = authWallet.toLowerCase() === env.PLATFORM_WALLET.toLowerCase() ? "OWNER" : "ADMIN";

  try {
    const result = await runDailyDistributionForDate(targetDate);
    const resultStatus =
      result.failed > 0 && result.processed > 0
        ? "COMPLETED_PARTIAL"
        : result.failed > 0
          ? "FAILED"
          : "COMPLETED_SUCCESS";
    const resultPayload = {
      processed: result.processed,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
      totalProfitUsd: result.totalProfitUsd,
      targetDate: result.targetDate,
      hasPartialFailure: result.failed > 0,
      errors: result.errors,
      ...(result.skippedDueToSnapshotIncomplete &&
        result.skippedDueToSnapshotIncomplete.length > 0 && {
          skippedDueToSnapshotIncomplete: result.skippedDueToSnapshotIncomplete
        })
    };

    await prisma.$executeRaw`
      UPDATE "DailyDistributionTrigger"
      SET "status" = ${resultStatus}, "resultJson" = ${JSON.stringify(resultPayload)}::jsonb, "updatedAt" = NOW()
      WHERE "id" = ${triggerId}
    `;

    await writeAuditLogV2({
      actorWallet: authWallet as `0x${string}`,
      actorRole,
      action: "daily_distribution_trigger",
      resourceType: "DailyDistributionTrigger",
      resourceId: triggerId,
      payloadJson: {
        targetDate: result.targetDate,
        idempotencyKey,
        processed: result.processed,
        created: result.created,
        skipped: result.skipped,
        failed: result.failed,
        totalProfitUsd: result.totalProfitUsd,
        resultStatus
      }
    });

    return res.json({
      ok: true,
      ...result,
      elapsedMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.$executeRaw`
      UPDATE "DailyDistributionTrigger"
      SET "status" = 'FAILED', "resultJson" = ${JSON.stringify({ error: message })}::jsonb, "updatedAt" = NOW()
      WHERE "id" = ${triggerId}
    `;

    await writeAuditLogV2({
      actorWallet: authWallet as `0x${string}`,
      actorRole,
      action: "daily_distribution_trigger_failed",
      resourceType: "DailyDistributionTrigger",
      resourceId: triggerId,
      reasonCode: "execution_error",
      reasonText: message,
      payloadJson: {
        targetDate: targetDate.toISOString().slice(0, 10),
        idempotencyKey,
        error: message
      }
    });

    return res.status(500).json({
      ok: false,
      error: message,
      elapsedMs: Date.now() - startedAt
    });
  }
});

router.post("/profit/distributions/run", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = profitDistributionRunRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const targetWallet = normalizeWalletAddress(parsed.data.wallet);
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!targetWallet || !authWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: targetWallet,
    authWalletRaw: authWallet,
    requireCanEvaluate: true,
    requireCanExecute: true
  });
  if (!auth.ok) {
    return res.status(403).json({ error: "Wallet is not authorized to run distribution" });
  }
  const distributionAt = parsed.data.distributionAt ? new Date(parsed.data.distributionAt) : new Date();
  const result = await createDailyProfitDistribution({
    wallet: targetWallet,
    chainId: parsed.data.chainId,
    distributionAt
  });
  console.info(
    JSON.stringify({
      event: "profit_distribution_run_completed",
      wallet: targetWallet,
      distributionId: result.distributionId,
      totalProfitUsd: result.totalProfitUsd,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /profit/distributions/run", Date.now() - startedAt)
    })
  );
  return res.json(
    profitDistributionRunResponseSchema.parse({
      ok: true,
      distributionId: result.distributionId,
      itemId: result.itemId,
      itemCount: result.itemCount ?? 1,
      totalProfitUsd: result.totalProfitUsd,
      autoPayout: result.autoPayout
    })
  );
});

router.get("/profit/distributions", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = profitDistributionListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) {
    return res.status(401).json({ error: "Missing authenticated wallet" });
  }
  const targetWallet = parsed.data.wallet ? normalizeWalletAddress(parsed.data.wallet) : authWallet;
  if (!targetWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: targetWallet,
    authWalletRaw: authWallet,
    requireCanEvaluate: true,
    requireCanExecute: false
  });
  if (!auth.ok) {
    return res.status(403).json({ error: "Wallet is not authorized for this distribution view" });
  }

  const distributionRows = await prisma.$queryRaw<DistributionRow[]>`
    SELECT DISTINCT d.*
    FROM "ProfitDistribution" d
    INNER JOIN "ProfitDistributionItem" i ON i."distributionId" = d."id"
    WHERE i."wallet" = ${targetWallet}
    ORDER BY d."distributionAt" DESC
    LIMIT ${parsed.data.limit};
  `;
  const distributionIds = distributionRows.map((row) => row.id);
  const itemRows =
    distributionIds.length > 0
      ? await prisma.$queryRaw<DistributionItemRow[]>`
          SELECT "id","distributionId","wallet","amountUsd","tokenAddress","amountToken","status","paidTxHash","claimedAt","autoPayout"
          FROM "ProfitDistributionItem"
          WHERE "distributionId" IN (${Prisma.join(distributionIds)})
            AND "wallet" = ${targetWallet}
          ORDER BY "createdAt" ASC;
        `
      : [];

  const itemsByDistribution = new Map<string, DistributionItemRow[]>();
  for (const item of itemRows) {
    const list = itemsByDistribution.get(item.distributionId) ?? [];
    list.push(item);
    itemsByDistribution.set(item.distributionId, list);
  }
  const payload = distributionRows.map((distribution) =>
    profitDistributionSchema.parse({
      ...distribution,
      distributionAt: distribution.distributionAt.toISOString(),
      createdAt: distribution.createdAt.toISOString(),
      executedAt: distribution.executedAt ? distribution.executedAt.toISOString() : null,
      items: (itemsByDistribution.get(distribution.id) ?? []).map((item) => ({
        ...item,
        paidTxHash: item.paidTxHash ?? null,
        claimedAt: item.claimedAt ? item.claimedAt.toISOString() : null
      }))
    })
  );
  console.info(
    JSON.stringify({
      event: "profit_distributions_listed",
      wallet: targetWallet,
      itemCount: payload.length,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /profit/distributions", Date.now() - startedAt)
    })
  );
  return res.json(payload);
});

router.post("/profit/claim", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = profitClaimRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) {
    return res.status(401).json({ error: "Missing authenticated wallet" });
  }
  if (parsed.data.idempotencyKey) {
    const precheckRows = await prisma.$queryRaw<
      Array<{ id: string; wallet: string; status: string; paidTxHash: string | null; claimedAt: Date | null }>
    >`
      SELECT "id", "wallet", "status"::text as status, "paidTxHash", "claimedAt"
      FROM "ProfitDistributionItem"
      WHERE "id" = ${parsed.data.distributionItemId}
      LIMIT 1;
    `;
    const precheckItem = precheckRows[0];
    if (!precheckItem) {
      return res.status(404).json({ error: "Distribution item not found" });
    }
    if (precheckItem.wallet.toLowerCase() !== authWallet.toLowerCase()) {
      return res.status(403).json({ error: "Distribution item belongs to a different wallet" });
    }
    const keyRows = await prisma.$queryRaw<
      Array<{
        distributionItemId: string;
        status: string;
        paidTxHash: string | null;
        claimedAt: Date | null;
      }>
    >`
      SELECT "distributionItemId","status","paidTxHash","claimedAt"
      FROM "ProfitClaimIdempotency"
      WHERE "wallet" = ${authWallet}
        AND "idempotencyKey" = ${parsed.data.idempotencyKey}
      LIMIT 1;
    `;
    const keyRow = keyRows[0];
    if (keyRow) {
      if (keyRow.distributionItemId !== precheckItem.id) {
        return res.status(409).json({ error: "idempotency_key_conflict" });
      }
      if (keyRow.status === "SUCCEEDED" && keyRow.paidTxHash) {
        return res.json(
          profitClaimResponseSchema.parse({
            ok: true,
            distributionItemId: precheckItem.id,
            status: "PAID",
            claimedAt: keyRow.claimedAt ? keyRow.claimedAt.toISOString() : new Date().toISOString(),
            paidTxHash: keyRow.paidTxHash
          })
        );
      }
      if (keyRow.status === "STARTED") {
        return res.status(409).json({ error: "claim_already_in_progress" });
      }
    } else {
      await prisma.$executeRaw`
        INSERT INTO "ProfitClaimIdempotency" (
          "id","wallet","idempotencyKey","distributionItemId","status","createdAt","updatedAt"
        )
        VALUES (
          ${randomUUID()},
          ${authWallet},
          ${parsed.data.idempotencyKey},
          ${precheckItem.id},
          'STARTED',
          NOW(),
          NOW()
        );
      `;
    }
  }

  const claimStart = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<
      Array<{
        id: string;
        wallet: string;
        status: string;
        paidTxHash: string | null;
        claimedAt: Date | null;
      }>
    >`
      SELECT "id", "wallet", "status"::text as status, "paidTxHash", "claimedAt"
      FROM "ProfitDistributionItem"
      WHERE "id" = ${parsed.data.distributionItemId}
      FOR UPDATE;
    `;
    const row = lockRows[0];
    if (!row) return { kind: "not_found" as const };
    if (row.wallet.toLowerCase() !== authWallet.toLowerCase()) return { kind: "forbidden" as const };
    if (row.status === "PAID") {
      return { kind: "already_paid" as const, row };
    }
    if (row.status === "EXECUTING") return { kind: "in_progress" as const };
    if (row.status !== "CLAIMABLE") return { kind: "not_claimable" as const };
    await tx.$executeRaw`
      UPDATE "ProfitDistributionItem"
      SET "status" = 'EXECUTING'::"DistributionItemStatus", "updatedAt" = NOW()
      WHERE "id" = ${row.id};
    `;
    return { kind: "started" as const, row };
  });
  if (claimStart.kind === "not_found") {
    return res.status(404).json({ error: "Distribution item not found" });
  }
  if (claimStart.kind === "forbidden") {
    return res.status(403).json({ error: "Distribution item belongs to a different wallet" });
  }
  if (claimStart.kind === "already_paid") {
    return res.json(
      profitClaimResponseSchema.parse({
        ok: true,
        distributionItemId: claimStart.row.id,
        status: "PAID",
        claimedAt: claimStart.row.claimedAt ? claimStart.row.claimedAt.toISOString() : new Date().toISOString(),
        paidTxHash: claimStart.row.paidTxHash
      })
    );
  }
  if (claimStart.kind === "in_progress") {
    return res.status(409).json({ error: "claim_already_in_progress" });
  }
  if (claimStart.kind === "not_claimable") {
    return res.status(400).json({ error: "Distribution item is not claimable" });
  }
  const item = claimStart.row;

  let paidTxHash = parsed.data.paidTxHash;
  let claimFailureReason: string | null = null;
  if (!paidTxHash) {
    if (!parsed.data.txRequest) {
      return res.status(400).json({
        error: "Either paidTxHash or txRequest is required for claim execution"
      });
    }
    const relayerResult = await submitAutomationTxViaRelayer({
      jobId: `profit-claim-${item.id}`,
      executionId: randomUUID(),
      wallet: authWallet,
      chainId: null,
      type: "DISTRIBUTE",
      txRequest: parsed.data.txRequest
    });
    if (!relayerResult.submitted) {
      claimFailureReason = relayerResult.reason;
      await prisma.$executeRaw`
        UPDATE "ProfitDistributionItem"
        SET "status" = 'CLAIMABLE'::"DistributionItemStatus", "errorMessage" = ${claimFailureReason}, "updatedAt" = NOW()
        WHERE "id" = ${item.id};
      `;
      if (parsed.data.idempotencyKey) {
        await prisma.$executeRaw`
          UPDATE "ProfitClaimIdempotency"
          SET "status" = 'FAILED', "errorMessage" = ${claimFailureReason}, "updatedAt" = NOW()
          WHERE "wallet" = ${authWallet}
            AND "idempotencyKey" = ${parsed.data.idempotencyKey};
        `;
      }
      return res.status(502).json({
        error: "Relayer claim submission failed",
        code: relayerResult.reason,
        context: relayerResult.context
      });
    }
    paidTxHash = relayerResult.txHash;
    if (parsed.data.waitForConfirmation) {
      const confirmation = await confirmAutomationTxOnchain({
        chainId: parsed.data.chainId ?? null,
        txHash: paidTxHash,
        timeoutMs: env.AUTOMATION_TX_CONFIRM_TIMEOUT_MS
      });
      if (!confirmation.confirmed) {
        claimFailureReason = confirmation.reason;
        await prisma.$executeRaw`
          UPDATE "ProfitDistributionItem"
          SET "status" = 'CLAIMABLE'::"DistributionItemStatus", "errorMessage" = ${claimFailureReason}, "updatedAt" = NOW()
          WHERE "id" = ${item.id};
        `;
        if (parsed.data.idempotencyKey) {
          await prisma.$executeRaw`
            UPDATE "ProfitClaimIdempotency"
            SET "status" = 'FAILED', "errorMessage" = ${claimFailureReason}, "updatedAt" = NOW()
            WHERE "wallet" = ${authWallet}
              AND "idempotencyKey" = ${parsed.data.idempotencyKey};
          `;
        }
        return res.status(502).json({
          error: "Claim transaction confirmation failed",
          code: confirmation.reason,
          txHash: paidTxHash
        });
      }
    }
  }
  await prisma.$executeRaw`
    UPDATE "ProfitDistributionItem"
    SET
      "status" = 'PAID'::"DistributionItemStatus",
      "claimedAt" = NOW(),
      "paidTxHash" = ${paidTxHash},
      "errorMessage" = NULL,
      "updatedAt" = NOW()
    WHERE "id" = ${item.id};
  `;
  const claimedAt = new Date().toISOString();
  if (parsed.data.idempotencyKey) {
    await prisma.$executeRaw`
      UPDATE "ProfitClaimIdempotency"
      SET
        "status" = 'SUCCEEDED',
        "paidTxHash" = ${paidTxHash},
        "claimedAt" = NOW(),
        "errorMessage" = NULL,
        "updatedAt" = NOW()
      WHERE "wallet" = ${authWallet}
        AND "idempotencyKey" = ${parsed.data.idempotencyKey};
    `;
  }
  console.info(
    JSON.stringify({
      event: "profit_claim_completed",
      wallet: authWallet,
      distributionItemId: item.id,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /profit/claim", Date.now() - startedAt)
    })
  );
  return res.json(
    profitClaimResponseSchema.parse({
      ok: true,
      distributionItemId: item.id,
      status: "PAID",
      claimedAt,
      paidTxHash: paidTxHash ?? null
    })
  );
});

export default router;

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}
