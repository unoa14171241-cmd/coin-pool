import { Router } from "express";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { requireWalletSignature } from "../auth/middleware";
import { allowedChainIds, env } from "../config/env";
import {
  automationJobItemSchema,
  automationJobListQuerySchema,
  automationPolicyListQuerySchema,
  automationPolicySchema,
  automationExecuteRequestSchema,
  automationExecuteResponseSchema,
  automationEvaluateRequestSchema,
  automationEvaluateResponseSchema,
  automationSmokeRequestSchema,
  automationSmokeResponseSchema,
  automationExecutionItemSchema,
  automationExecutionListQuerySchema,
  automationMetricsQuerySchema,
  automationOperatorPermissionSchema,
  automationWorkerTickRequestSchema,
  automationWorkerTickResponseSchema,
  upsertAutomationPolicyRequestSchema,
  upsertAutomationOperatorRequestSchema
} from "../schemas/automation";
import { automationStrategyWorker as worker } from "../services/automation-autopilot";
import {
  listOperatorPermissions,
  upsertOperatorPermission
} from "../services/automation/operator-permissions";
import { getOperatorPermissionCacheCounters } from "../services/observability/operator-permission-observability";
import { authorizeOwnerOrOperatorAction, normalizeWalletAddress } from "../services/auth/wallet-authorization";
import {
  getAuthorizationCounters,
  recordAutomationAuthorizationDenied
} from "../services/observability/authorization-observability";
import { getRouteLatencySummary, recordRouteLatency } from "../services/observability/route-latency-observability";
import {
  enqueueAutomationJob,
  listAutomationJobs,
  retryFailedAutomationJobsForWallet
} from "../services/automation-queue";
import { executeAutomationJobById, executeQueuedJobsForWallet, listAutomationExecutions } from "../services/automation-executor";
import { checkEmergencyPaused } from "../services/automation-emergency-check";
import { prisma } from "../db/prisma";
import { getAutomationCounters, recordAutomationQueueTick } from "../services/observability/automation-metrics-observability";
import {
  cleanupAutomationDaemonTicks,
  getAutomationDaemonRecentTicks,
  getAutomationDaemonRecentTicksDurable,
  getAutomationDaemonState,
  triggerAutomationDaemonTickNow
} from "../services/automation-daemon";
import { getAutomationRelayerState } from "../services/automation-tx-relayer";
import {
  getDailyDistributionSchedulerState,
  runDailyDistributionTick
} from "../services/daily-distribution-scheduler";

const router = Router();

router.get("/automation/preflight", (_req, res) => {
  const checks: Array<{
    id: string;
    label: string;
    status: "OK" | "WARN" | "ERROR";
    message: string;
    blocking: boolean;
  }> = [];

  const relayerReady = env.AUTOMATION_RELAYER_ENABLED && Boolean(env.AUTOMATION_RELAYER_URL);
  checks.push({
    id: "daemon-enabled",
    label: "Daemon enabled",
    status: env.AUTOMATION_DAEMON_ENABLED ? "OK" : "ERROR",
    message: env.AUTOMATION_DAEMON_ENABLED ? "Daemon is running mode." : "AUTOMATION_DAEMON_ENABLED=false",
    blocking: true
  });
  checks.push({
    id: "auto-evaluate-enabled",
    label: "Auto evaluate enabled",
    status: env.AUTOMATION_DAEMON_EVALUATE_ENABLED ? "OK" : "WARN",
    message: env.AUTOMATION_DAEMON_EVALUATE_ENABLED
      ? "Daemon wallet evaluation is enabled."
      : "AUTOMATION_DAEMON_EVALUATE_ENABLED=false",
    blocking: false
  });
  checks.push({
    id: "execution-enabled",
    label: "Execution enabled",
    status: env.AUTOMATION_EXECUTION_ENABLED ? "OK" : "WARN",
    message: env.AUTOMATION_EXECUTION_ENABLED
      ? "Guarded execution is enabled."
      : "AUTOMATION_EXECUTION_ENABLED=false (dry-run execution).",
    blocking: false
  });
  checks.push({
    id: "auto-compound-enabled",
    label: "Auto-compound enabled",
    status: env.AUTOMATION_AUTO_COMPOUND_ENABLED ? "OK" : "WARN",
    message: env.AUTOMATION_AUTO_COMPOUND_ENABLED
      ? "Auto-compound execution path is enabled."
      : "AUTOMATION_AUTO_COMPOUND_ENABLED=false",
    blocking: false
  });
  checks.push({
    id: "relayer-ready",
    label: "Relayer ready",
    status: relayerReady ? "OK" : env.AUTOMATION_RELAYER_ENABLED ? "ERROR" : "WARN",
    message: relayerReady
      ? "Relayer enabled and URL configured."
      : env.AUTOMATION_RELAYER_ENABLED
        ? "AUTOMATION_RELAYER_ENABLED=true but AUTOMATION_RELAYER_URL is missing."
        : "AUTOMATION_RELAYER_ENABLED=false (live submission disabled).",
    blocking: env.AUTOMATION_RELAYER_ENABLED
  });

  const missingRpcChains = allowedChainIds.filter((chainId) => {
    if (chainId === 42161) return !env.ARBITRUM_RPC_URL;
    if (chainId === 1) return !env.MAINNET_RPC_URL;
    if (chainId === 8453) return !env.BASE_RPC_URL;
    if (chainId === 137) return !env.POLYGON_RPC_URL;
    return true;
  });
  checks.push({
    id: "rpc-configured",
    label: "RPC configured",
    status: missingRpcChains.length === 0 ? "OK" : "ERROR",
    message:
      missingRpcChains.length === 0
        ? "All allowed chain RPC URLs are configured."
        : `Missing RPC for chain IDs: ${missingRpcChains.join(", ")}`,
    blocking: true
  });

  const missingExecutorChains = allowedChainIds.filter((chainId) => {
    if (chainId === 42161) return !env.AUTOMATION_EXECUTOR_ADDRESS_ARBITRUM;
    if (chainId === 1) return !env.AUTOMATION_EXECUTOR_ADDRESS_MAINNET;
    if (chainId === 8453) return !env.AUTOMATION_EXECUTOR_ADDRESS_BASE;
    if (chainId === 137) return !env.AUTOMATION_EXECUTOR_ADDRESS_POLYGON;
    return true;
  });
  checks.push({
    id: "executor-addresses",
    label: "Executor addresses configured",
    status: missingExecutorChains.length === 0 ? "OK" : "WARN",
    message:
      missingExecutorChains.length === 0
        ? "Executor addresses exist for all allowed chains."
        : `Missing executor address for chain IDs: ${missingExecutorChains.join(", ")}`,
    blocking: false
  });

  const blockingErrors = checks.filter((item) => item.blocking && item.status === "ERROR");
  return res.json({
    ok: blockingErrors.length === 0,
    checks,
    summary: {
      total: checks.length,
      ok: checks.filter((item) => item.status === "OK").length,
      warn: checks.filter((item) => item.status === "WARN").length,
      error: checks.filter((item) => item.status === "ERROR").length
    }
  });
});

router.get("/automation/config", (_req, res) => {
  res.json({
    executionEnabled: env.AUTOMATION_EXECUTION_ENABLED,
    minimumNetBenefitUsd: env.AUTOMATION_MIN_NET_BENEFIT_USD,
    autoCompoundEnabled: env.AUTOMATION_AUTO_COMPOUND_ENABLED,
    minimumCompoundFeesUsd: env.AUTOMATION_MIN_COMPOUND_FEES_USD,
    relayer: getAutomationRelayerState(),
    daemon: getAutomationDaemonState(),
    dailyDistributionScheduler: getDailyDistributionSchedulerState()
  });
});

router.get("/automation/policies", requireWalletSignature, async (req, res) => {
  const parsed = automationPolicyListQuerySchema.safeParse(req.query);
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
    requireCanExecute: false
  });
  if (!auth.ok) {
    recordAutomationAuthorizationDenied();
    return res.status(403).json({ error: "Operator is not authorized for this wallet" });
  }

  const rows = parsed.data.positionId
    ? await prisma.$queryRaw<
        Array<{
          id: string;
          wallet: string;
          positionId: string | null;
          enabled: boolean;
          mode: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
          minNetBenefitUsd: number;
          maxGasUsd: number;
          maxSlippageBps: number;
          cooldownMinutes: number;
          staleSnapshotReject: boolean;
          autoCollectEnabled: boolean;
          autoCompoundEnabled: boolean;
          autoRebalanceEnabled: boolean;
          updatedAt: Date;
        }>
      >`
        SELECT
          "id","wallet","positionId","enabled","mode",
          "minNetBenefitUsd","maxGasUsd","maxSlippageBps","cooldownMinutes","staleSnapshotReject",
          "autoCollectEnabled","autoCompoundEnabled","autoRebalanceEnabled","updatedAt"
        FROM "AutomationPolicy"
        WHERE "wallet" = ${targetWallet}
          AND "positionId" = ${parsed.data.positionId}
        ORDER BY "updatedAt" DESC;
      `
    : await prisma.$queryRaw<
    Array<{
      id: string;
      wallet: string;
      positionId: string | null;
      enabled: boolean;
      mode: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
      minNetBenefitUsd: number;
      maxGasUsd: number;
      maxSlippageBps: number;
      cooldownMinutes: number;
      staleSnapshotReject: boolean;
      autoCollectEnabled: boolean;
      autoCompoundEnabled: boolean;
      autoRebalanceEnabled: boolean;
      updatedAt: Date;
    }>
    >`
      SELECT
        "id","wallet","positionId","enabled","mode",
        "minNetBenefitUsd","maxGasUsd","maxSlippageBps","cooldownMinutes","staleSnapshotReject",
        "autoCollectEnabled","autoCompoundEnabled","autoRebalanceEnabled","updatedAt"
      FROM "AutomationPolicy"
      WHERE "wallet" = ${targetWallet}
      ORDER BY CASE WHEN "positionId" IS NULL THEN 1 ELSE 0 END ASC, "updatedAt" DESC;
    `;

  return res.json(
    rows.map((row) =>
      automationPolicySchema.parse({
        ...row,
        updatedAt: row.updatedAt.toISOString()
      })
    )
  );
});

router.post("/automation/policies", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = upsertAutomationPolicyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const ownerWallet = normalizeWalletAddress(parsed.data.wallet);
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!ownerWallet || !authWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  if (authWallet.toLowerCase() !== ownerWallet.toLowerCase()) {
    return res.status(403).json({ error: "Only owner wallet can upsert automation policy" });
  }
  if (!parsed.data.positionId) {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AutomationPolicy"
      WHERE "wallet" = ${ownerWallet}
        AND "positionId" IS NULL
      ORDER BY "updatedAt" DESC
      LIMIT 1;
    `;
    if (existing.length > 0) {
      await prisma.$executeRaw`
        UPDATE "AutomationPolicy"
        SET
          "enabled" = ${parsed.data.enabled},
          "mode" = ${parsed.data.mode},
          "minNetBenefitUsd" = ${parsed.data.minNetBenefitUsd},
          "maxGasUsd" = ${parsed.data.maxGasUsd},
          "maxSlippageBps" = ${parsed.data.maxSlippageBps},
          "cooldownMinutes" = ${parsed.data.cooldownMinutes},
          "staleSnapshotReject" = ${parsed.data.staleSnapshotReject},
          "autoCollectEnabled" = ${parsed.data.autoCollectEnabled},
          "autoCompoundEnabled" = ${parsed.data.autoCompoundEnabled},
          "autoRebalanceEnabled" = ${parsed.data.autoRebalanceEnabled},
          "updatedAt" = NOW()
        WHERE "id" = ${existing[0].id};
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "AutomationPolicy" (
          "id","wallet","positionId","enabled","mode","minNetBenefitUsd","maxGasUsd","maxSlippageBps",
          "cooldownMinutes","staleSnapshotReject","autoCollectEnabled","autoCompoundEnabled","autoRebalanceEnabled",
          "createdAt","updatedAt"
        )
        VALUES (
          ${randomUUID()},
          ${ownerWallet},
          NULL,
          ${parsed.data.enabled},
          ${parsed.data.mode},
          ${parsed.data.minNetBenefitUsd},
          ${parsed.data.maxGasUsd},
          ${parsed.data.maxSlippageBps},
          ${parsed.data.cooldownMinutes},
          ${parsed.data.staleSnapshotReject},
          ${parsed.data.autoCollectEnabled},
          ${parsed.data.autoCompoundEnabled},
          ${parsed.data.autoRebalanceEnabled},
          NOW(),
          NOW()
        );
      `;
    }
  } else {
    await prisma.$executeRaw`
      INSERT INTO "AutomationPolicy" (
        "id","wallet","positionId","enabled","mode","minNetBenefitUsd","maxGasUsd","maxSlippageBps",
        "cooldownMinutes","staleSnapshotReject","autoCollectEnabled","autoCompoundEnabled","autoRebalanceEnabled",
        "createdAt","updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${ownerWallet},
        ${parsed.data.positionId},
        ${parsed.data.enabled},
        ${parsed.data.mode},
        ${parsed.data.minNetBenefitUsd},
        ${parsed.data.maxGasUsd},
        ${parsed.data.maxSlippageBps},
        ${parsed.data.cooldownMinutes},
        ${parsed.data.staleSnapshotReject},
        ${parsed.data.autoCollectEnabled},
        ${parsed.data.autoCompoundEnabled},
        ${parsed.data.autoRebalanceEnabled},
        NOW(),
        NOW()
      )
      ON CONFLICT ("wallet","positionId")
      DO UPDATE SET
        "enabled" = EXCLUDED."enabled",
        "mode" = EXCLUDED."mode",
        "minNetBenefitUsd" = EXCLUDED."minNetBenefitUsd",
        "maxGasUsd" = EXCLUDED."maxGasUsd",
        "maxSlippageBps" = EXCLUDED."maxSlippageBps",
        "cooldownMinutes" = EXCLUDED."cooldownMinutes",
        "staleSnapshotReject" = EXCLUDED."staleSnapshotReject",
        "autoCollectEnabled" = EXCLUDED."autoCollectEnabled",
        "autoCompoundEnabled" = EXCLUDED."autoCompoundEnabled",
        "autoRebalanceEnabled" = EXCLUDED."autoRebalanceEnabled",
        "updatedAt" = NOW();
    `;
  }
  console.info(
    JSON.stringify({
      event: "automation_policy_upserted",
      wallet: ownerWallet,
      positionId: parsed.data.positionId ?? null,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /automation/policies", Date.now() - startedAt)
    })
  );
  return res.status(201).json({ ok: true });
});

router.get("/automation/jobs", requireWalletSignature, async (req, res) => {
  const parsed = automationJobListQuerySchema.safeParse(req.query);
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
    recordAutomationAuthorizationDenied();
    return res.status(403).json({ error: "Operator is not authorized for this wallet" });
  }
  const rows = await listAutomationJobs({
    wallet: targetWallet,
    status: parsed.data.status,
    type: parsed.data.type,
    ids: parsed.data.ids,
    limit: parsed.data.limit
  });
  return res.json(
    rows.map((row) => {
      const item: Record<string, unknown> = {
        ...row,
        scheduledAt: row.scheduledAt.toISOString(),
        leaseUntil: row.leaseUntil ? row.leaseUntil.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
      if (parsed.data.includePayload) {
        item.payload = row.payload ?? null;
      }
      return automationJobItemSchema.parse(item);
    })
  );
});

router.post("/automation/worker/tick", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = automationWorkerTickRequestSchema.safeParse(req.body);
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
    recordAutomationAuthorizationDenied();
    return res.status(403).json({ error: "Operator is not authorized to run worker for this wallet" });
  }
  if (parsed.data.retryFailedLimit > 0) {
    await retryFailedAutomationJobsForWallet(targetWallet, parsed.data.retryFailedLimit);
  }
  const workerId = parsed.data.workerId ?? `api-worker-${authWallet.toLowerCase()}`;
  const result = await executeQueuedJobsForWallet({
    wallet: targetWallet,
    maxJobs: parsed.data.maxJobs,
    workerId
  });
  recordAutomationQueueTick({
    processed: result.processed,
    failed: result.failed,
    requeued: parsed.data.retryFailedLimit
  });
  console.info(
    JSON.stringify({
      event: "automation_worker_tick_completed",
      wallet: targetWallet,
      workerId,
      processed: result.processed,
      failed: result.failed,
      requeued: parsed.data.retryFailedLimit,
      counters: getAutomationCounters(),
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /automation/worker/tick", Date.now() - startedAt)
    })
  );
  return res.json(
    automationWorkerTickResponseSchema.parse({
      ok: true,
      wallet: targetWallet,
      processed: result.processed,
      failed: result.failed,
      requeued: parsed.data.retryFailedLimit,
      workerId
    })
  );
});

router.get("/automation/worker/health", requireWalletSignature, async (_req, res) => {
  const workers = await prisma.$queryRaw<
    Array<{
      workerId: string;
      status: string;
      currentJobId: string | null;
      lastHeartbeatAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT "workerId","status","currentJobId","lastHeartbeatAt","updatedAt"
    FROM "AutomationWorker"
    ORDER BY "lastHeartbeatAt" DESC
    LIMIT 20;
  `;
  const durableTicks = await getAutomationDaemonRecentTicksDurable(10);
  return res.json({
    counters: getAutomationCounters(),
    daemon: getAutomationDaemonState(),
    recentTicks: durableTicks.length > 0 ? durableTicks : getAutomationDaemonRecentTicks(10),
    workers: workers.map((worker) => ({
      ...worker,
      lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
      updatedAt: worker.updatedAt.toISOString()
    }))
  });
});

router.get("/automation/daemon/ticks", requireWalletSignature, async (req, res) => {
  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 20;
  const offsetRaw = Number(req.query.offset ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;
  const durableTicks = await getAutomationDaemonRecentTicksDurable(limit, offset);
  return res.json({
    daemon: getAutomationDaemonState(),
    paging: { limit, offset },
    ticks: durableTicks.length > 0 ? durableTicks : getAutomationDaemonRecentTicks(limit)
  });
});

router.post("/automation/daemon/tick-now", requireWalletSignature, async (_req, res) => {
  const out = await triggerAutomationDaemonTickNow();
  return res.json({
    ok: true,
    result: out,
    daemon: getAutomationDaemonState()
  });
});

router.post("/automation/daemon/cleanup-now", requireWalletSignature, async (_req, res) => {
  const out = await cleanupAutomationDaemonTicks();
  return res.json({
    ok: true,
    cleanup: out,
    daemon: getAutomationDaemonState()
  });
});

router.post("/automation/daily-distribution/tick-now", requireWalletSignature, async (_req, res) => {
  const out = await runDailyDistributionTick({ forceRun: true });
  if (!out.accepted) {
    return res.status(409).json({
      ok: false,
      error: out.reason ?? "tick_not_accepted",
      scheduler: getDailyDistributionSchedulerState()
    });
  }
  return res.json({
    ok: true,
    result: { processed: out.processed, failed: out.failed, errors: out.errors },
    scheduler: getDailyDistributionSchedulerState()
  });
});

router.get("/automation/metrics", requireWalletSignature, async (req, res) => {
  const parsed = automationMetricsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) {
    return res.status(401).json({ error: "Missing authenticated wallet" });
  }
  let targetWallet: string | null = null;
  if (parsed.data.wallet) {
    targetWallet = normalizeWalletAddress(parsed.data.wallet);
    if (!targetWallet) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }
    const auth = await authorizeOwnerOrOperatorAction({
      targetOwnerWallet: targetWallet as `0x${string}`,
      authWalletRaw: authWallet,
      requireCanEvaluate: true,
      requireCanExecute: false
    });
    if (!auth.ok) {
      recordAutomationAuthorizationDenied();
      return res.status(403).json({ error: "Operator is not authorized for this wallet" });
    }
  }
  const sinceAt = parsed.data.since ? new Date(parsed.data.since) : null;
  const chainId = parsed.data.chainId ?? null;
  const actionType = parsed.data.type ?? null;
  const bucketExpr =
    parsed.data.trendBucket === "15m"
      ? Prisma.sql`
          date_trunc('hour', COALESCE("finishedAt","startedAt"))
          + make_interval(
              mins => (floor(extract(minute from COALESCE("finishedAt","startedAt")) / 15)::int * 15)
            )
        `
      : Prisma.sql`date_trunc('hour', COALESCE("finishedAt","startedAt"))`;
  const rows = await prisma.$queryRaw<
    Array<{
      total: number;
      completed: number;
      failed: number;
      precheckFailed: number;
      successRate: number;
    }>
  >`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE "status" = 'COMPLETED'::"AutomationExecutionStatus")::int as completed,
      COUNT(*) FILTER (WHERE "status" = 'FAILED'::"AutomationExecutionStatus")::int as failed,
      COUNT(*) FILTER (WHERE "status" = 'PRECHECK_FAILED'::"AutomationExecutionStatus")::int as "precheckFailed",
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE (
          COUNT(*) FILTER (WHERE "status" = 'COMPLETED'::"AutomationExecutionStatus")::float / COUNT(*)::float
        )
      END as "successRate"
    FROM "AutomationExecution"
    WHERE (${targetWallet}::text IS NULL OR "wallet" = ${targetWallet})
      AND (${sinceAt}::timestamp IS NULL OR COALESCE("finishedAt", "startedAt") >= ${sinceAt})
      AND (${chainId}::int IS NULL OR "chainId" = ${chainId})
      AND (${actionType}::"AutomationJobType" IS NULL OR "type" = ${actionType}::"AutomationJobType");
  `;
  const failureRows = await prisma.$queryRaw<
    Array<{
      errorCode: string;
      count: number;
      lastSeenAt: Date;
    }>
  >`
    SELECT
      COALESCE(NULLIF("errorCode", ''), 'unknown') as "errorCode",
      COUNT(*)::int as count,
      MAX(COALESCE("finishedAt", "startedAt")) as "lastSeenAt"
    FROM "AutomationExecution"
    WHERE "status" IN ('FAILED'::"AutomationExecutionStatus", 'PRECHECK_FAILED'::"AutomationExecutionStatus")
      AND (${targetWallet}::text IS NULL OR "wallet" = ${targetWallet})
      AND (${sinceAt}::timestamp IS NULL OR COALESCE("finishedAt", "startedAt") >= ${sinceAt})
      AND (${chainId}::int IS NULL OR "chainId" = ${chainId})
      AND (${actionType}::"AutomationJobType" IS NULL OR "type" = ${actionType}::"AutomationJobType")
    GROUP BY COALESCE(NULLIF("errorCode", ''), 'unknown')
    ORDER BY count DESC, "lastSeenAt" DESC
    LIMIT ${parsed.data.errorCodeLimit};
  `;
  const byTypeRows = await prisma.$queryRaw<
    Array<{
      type: string;
      total: number;
      completed: number;
      failed: number;
      precheckFailed: number;
    }>
  >`
    SELECT
      "type"::text as type,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE "status" = 'COMPLETED'::"AutomationExecutionStatus")::int as completed,
      COUNT(*) FILTER (WHERE "status" = 'FAILED'::"AutomationExecutionStatus")::int as failed,
      COUNT(*) FILTER (WHERE "status" = 'PRECHECK_FAILED'::"AutomationExecutionStatus")::int as "precheckFailed"
    FROM "AutomationExecution"
    WHERE (${targetWallet}::text IS NULL OR "wallet" = ${targetWallet})
      AND (${sinceAt}::timestamp IS NULL OR COALESCE("finishedAt", "startedAt") >= ${sinceAt})
      AND (${chainId}::int IS NULL OR "chainId" = ${chainId})
      AND (${actionType}::"AutomationJobType" IS NULL OR "type" = ${actionType}::"AutomationJobType")
    GROUP BY "type"
    ORDER BY total DESC, type ASC;
  `;
  const txStatusRows = await prisma.$queryRaw<
    Array<{
      txStatus: string;
      count: number;
    }>
  >`
    SELECT
      COALESCE(NULLIF("txStatus", ''), 'unknown') as "txStatus",
      COUNT(*)::int as count
    FROM "AutomationExecution"
    WHERE (${targetWallet}::text IS NULL OR "wallet" = ${targetWallet})
      AND (${sinceAt}::timestamp IS NULL OR COALESCE("finishedAt", "startedAt") >= ${sinceAt})
      AND (${chainId}::int IS NULL OR "chainId" = ${chainId})
      AND (${actionType}::"AutomationJobType" IS NULL OR "type" = ${actionType}::"AutomationJobType")
    GROUP BY COALESCE(NULLIF("txStatus", ''), 'unknown')
    ORDER BY count DESC, "txStatus" ASC
    LIMIT 20;
  `;
  const trendRows = await prisma.$queryRaw<
    Array<{
      bucketStart: Date;
      total: number;
      completed: number;
      failed: number;
      precheckFailed: number;
      relayerFailed: number;
      successRate: number;
      relayerFailureRate: number;
      p95ElapsedMs: number | null;
    }>
  >`
    SELECT
      ${bucketExpr} as "bucketStart",
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE "status" = 'COMPLETED'::"AutomationExecutionStatus")::int as completed,
      COUNT(*) FILTER (WHERE "status" = 'FAILED'::"AutomationExecutionStatus")::int as failed,
      COUNT(*) FILTER (WHERE "status" = 'PRECHECK_FAILED'::"AutomationExecutionStatus")::int as "precheckFailed",
      COUNT(*) FILTER (
        WHERE "status" IN ('FAILED'::"AutomationExecutionStatus", 'PRECHECK_FAILED'::"AutomationExecutionStatus")
          AND COALESCE("errorCode",'') ILIKE 'relayer%'
      )::int as "relayerFailed",
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE (COUNT(*) FILTER (WHERE "status" = 'COMPLETED'::"AutomationExecutionStatus")::float / COUNT(*)::float)
      END as "successRate",
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE (
          COUNT(*) FILTER (
            WHERE "status" IN ('FAILED'::"AutomationExecutionStatus", 'PRECHECK_FAILED'::"AutomationExecutionStatus")
              AND COALESCE("errorCode",'') ILIKE 'relayer%'
          )::float / COUNT(*)::float
        )
      END as "relayerFailureRate",
      percentile_cont(0.95) WITHIN GROUP (
        ORDER BY (
          EXTRACT(EPOCH FROM (COALESCE("finishedAt","startedAt") - "startedAt")) * 1000.0
        )
      ) FILTER (WHERE COALESCE("finishedAt","startedAt") >= "startedAt") as "p95ElapsedMs"
    FROM "AutomationExecution"
    WHERE (${targetWallet}::text IS NULL OR "wallet" = ${targetWallet})
      AND (${sinceAt}::timestamp IS NULL OR COALESCE("finishedAt", "startedAt") >= ${sinceAt})
      AND (${chainId}::int IS NULL OR "chainId" = ${chainId})
      AND (${actionType}::"AutomationJobType" IS NULL OR "type" = ${actionType}::"AutomationJobType")
    GROUP BY ${bucketExpr}
    ORDER BY "bucketStart" DESC
    LIMIT ${parsed.data.trendLimit};
  `;
  const relayerFailureCount = failureRows
    .filter((row) => row.errorCode.toLowerCase().startsWith("relayer"))
    .reduce((acc, row) => acc + row.count, 0);
  const trend = trendRows
    .reverse()
    .map((row) => ({
      bucketStart: row.bucketStart.toISOString(),
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      precheckFailed: row.precheckFailed,
      relayerFailed: row.relayerFailed,
      successRate: row.successRate,
      relayerFailureRate: row.relayerFailureRate,
      p95ElapsedMs: row.p95ElapsedMs == null ? null : Math.round(row.p95ElapsedMs)
    }));
  const latestTrend = trend.length > 0 ? trend[trend.length - 1] : null;
  const alertThresholds = {
    minSuccessRate: 0.7,
    maxRelayerFailureRate: 0.2,
    maxP95ElapsedMs: 60_000
  };
  const alerts = latestTrend
    ? {
        latestBucketStart: latestTrend.bucketStart,
        degradedSuccessRate: latestTrend.successRate < alertThresholds.minSuccessRate,
        elevatedRelayerFailureRate: latestTrend.relayerFailureRate > alertThresholds.maxRelayerFailureRate,
        elevatedP95ElapsedMs:
          typeof latestTrend.p95ElapsedMs === "number" && latestTrend.p95ElapsedMs > alertThresholds.maxP95ElapsedMs
      }
    : {
        latestBucketStart: null,
        degradedSuccessRate: false,
        elevatedRelayerFailureRate: false,
        elevatedP95ElapsedMs: false
      };
  if (targetWallet && (alerts.degradedSuccessRate || alerts.elevatedRelayerFailureRate || alerts.elevatedP95ElapsedMs)) {
    const alertMessage = [
      `bucket=${alerts.latestBucketStart ?? "n/a"}`,
      `degradedSuccessRate=${alerts.degradedSuccessRate}`,
      `elevatedRelayerFailureRate=${alerts.elevatedRelayerFailureRate}`,
      `elevatedP95ElapsedMs=${alerts.elevatedP95ElapsedMs}`
    ].join(";");
    const recentSameAlert = await prisma.activityLog.findFirst({
      where: {
        wallet: targetWallet.toLowerCase(),
        type: "Automation Alert",
        source: "system-alert",
        message: alertMessage,
        createdAt: {
          gte: new Date(Date.now() - 30 * 60 * 1000)
        }
      },
      orderBy: { createdAt: "desc" }
    });
    if (!recentSameAlert) {
      await prisma.activityLog.create({
        data: {
          wallet: targetWallet.toLowerCase(),
          positionId: null,
          type: "Automation Alert",
          source: "system-alert",
          tx: null,
          message: alertMessage
        } as any
      });
    }
  }
  return res.json({
    ...rows[0],
    failureByErrorCode: failureRows.map((row) => ({
      errorCode: row.errorCode,
      count: row.count,
      lastSeenAt: row.lastSeenAt.toISOString()
    })),
    relayerFailureCount,
    byType: byTypeRows,
    byTxStatus: txStatusRows,
    trend,
    alerts,
    alertThresholds,
    filters: {
      wallet: targetWallet,
      chainId,
      type: actionType,
      since: sinceAt ? sinceAt.toISOString() : null,
      errorCodeLimit: parsed.data.errorCodeLimit,
      trendBucket: parsed.data.trendBucket,
      trendLimit: parsed.data.trendLimit
    },
    counters: getAutomationCounters()
  });
});

router.post("/automation/execute", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = automationExecuteRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const targetOwnerWallet = normalizeWalletAddress(parsed.data.wallet);
  if (!targetOwnerWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet,
    authWalletRaw: res.locals.authWallet,
    requireCanEvaluate: true,
    requireCanExecute: true
  });
  if (!auth.ok) {
    recordAutomationAuthorizationDenied();
    return res.status(403).json({ error: "Operator is not authorized to execute automation for this wallet" });
  }

  if (parsed.data.executeNow) {
    const emergency = await checkEmergencyPaused({
      wallet: targetOwnerWallet,
      positionId: parsed.data.positionId ?? null,
      chainId: parsed.data.chainId ?? 42161
    });
    if (emergency.paused) {
      return res.status(403).json({
        error: "automation_emergency_paused",
        message: "Automation execution is paused. Disable emergency pause to run automation."
      });
    }
  }

  const job = await enqueueAutomationJob({
    wallet: targetOwnerWallet,
    positionId: parsed.data.positionId,
    chainId: parsed.data.chainId,
    type: parsed.data.type,
    idempotencyKey: parsed.data.idempotencyKey,
    priority: parsed.data.priority,
    payload: parsed.data.payload
  });
  if (parsed.data.executeNow) {
    await executeAutomationJobById(job.id, {
      workerId: `api-${auth.authWallet.toLowerCase()}`,
      actorWallet: auth.authWallet,
      actorRole: auth.actorRole === "owner" ? "OWNER" : "OPERATOR"
    });
  }
  const statusRows = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT "status"::text as status
    FROM "AutomationJob"
    WHERE "id" = ${job.id}
    LIMIT 1;
  `;
  const status = (statusRows[0]?.status ?? "QUEUED") as
    | "QUEUED"
    | "SUCCEEDED"
    | "FAILED"
    | "DEAD_LETTER"
    | "RUNNING"
    | "LEASED"
    | "CANCELLED";
  console.info(
    JSON.stringify({
      event: "automation_execute_enqueued",
      wallet: targetOwnerWallet,
      positionId: parsed.data.positionId ?? null,
      type: parsed.data.type,
      jobId: job.id,
      status,
      executedNow: parsed.data.executeNow,
      actorRole: auth.actorRole,
      triggeredByWallet: auth.authWallet,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /automation/execute", Date.now() - startedAt),
      ...getAuthorizationCounters()
    })
  );
  return res.json(
    automationExecuteResponseSchema.parse({
      ok: true,
      jobId: job.id,
      status,
      executedNow: parsed.data.executeNow,
      actorRole: auth.actorRole,
      triggeredByWallet: auth.authWallet
    })
  );
});

router.get("/automation/executions", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = automationExecutionListQuerySchema.safeParse(req.query);
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
    recordAutomationAuthorizationDenied();
    return res.status(403).json({ error: "Operator is not authorized for this wallet" });
  }
  const rows = await listAutomationExecutions({
    wallet: targetWallet,
    jobId: parsed.data.jobId,
    ids: parsed.data.ids,
    limit: parsed.data.limit,
    status: parsed.data.status
  });
  const items = rows.map((row) => {
    const item: Record<string, unknown> = {
      ...row,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null
    };
    if (parsed.data.includePayload) {
      item.context = row.context ?? null;
    }
    return automationExecutionItemSchema.parse(item);
  });
  console.info(
    JSON.stringify({
      event: "automation_executions_listed",
      wallet: targetWallet,
      itemCount: items.length,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /automation/executions", Date.now() - startedAt),
      ...getAuthorizationCounters()
    })
  );
  return res.json(items);
});

router.get("/automation/operators/:ownerWallet", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const ownerWallet = normalizeWalletAddress(String(req.params.ownerWallet ?? ""));
  if (!ownerWallet) {
    return res.status(400).json({ error: "Invalid owner wallet address format" });
  }
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) {
    return res.status(401).json({ error: "Missing authenticated wallet" });
  }
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet: ownerWallet,
    authWalletRaw: authWallet,
    requireCanEvaluate: false,
    requireCanExecute: false
  });
  if (!auth.ok) {
    recordAutomationAuthorizationDenied();
    console.warn(
      JSON.stringify({
        event: "automation_authorization_denied",
        action: "list_operator_permissions",
        ownerWallet,
        reason: auth.reason,
        ...getAuthorizationCounters()
      })
    );
    return res.status(403).json({ error: "Operator is not authorized for this owner wallet" });
  }
  const items = await listOperatorPermissions({ ownerWallet });
  console.info(
    JSON.stringify({
      event: "automation_operator_permissions_listed",
      ownerWallet,
      requestedByWallet: authWallet,
      itemCount: items.length,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("GET /automation/operators/:ownerWallet", Date.now() - startedAt),
      ...getAuthorizationCounters(),
      ...getOperatorPermissionCacheCounters()
    })
  );
  return res.json(items.map((item) => automationOperatorPermissionSchema.parse(item)));
});

router.post("/automation/operators", requireWalletSignature, async (req, res) => {
  const startedAt = Date.now();
  const parsed = upsertAutomationOperatorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const authWallet = normalizeWalletAddress(String(res.locals.authWallet ?? ""));
  if (!authWallet) {
    return res.status(401).json({ error: "Missing authenticated wallet" });
  }
  const ownerWallet = normalizeWalletAddress(parsed.data.ownerWallet);
  const operatorWallet = normalizeWalletAddress(parsed.data.operatorWallet);
  if (!ownerWallet || !operatorWallet) {
    return res.status(400).json({ error: "Invalid owner/operator wallet address format" });
  }
  if (authWallet.toLowerCase() !== ownerWallet.toLowerCase()) {
    return res.status(403).json({ error: "Only owner wallet can update operator permissions" });
  }
  await upsertOperatorPermission({
    ownerWallet,
    operatorWallet,
    canEvaluate: parsed.data.canEvaluate,
    canExecute: parsed.data.canExecute,
    canPause: parsed.data.canPause,
    canChangeStrategy: parsed.data.canChangeStrategy,
    active: parsed.data.active
  });
  console.info(
    JSON.stringify({
      event: "automation_operator_permission_upserted",
      ownerWallet,
      operatorWallet,
      requestedByWallet: authWallet,
      canEvaluate: parsed.data.canEvaluate,
      canExecute: parsed.data.canExecute,
      canPause: parsed.data.canPause,
      canChangeStrategy: parsed.data.canChangeStrategy,
      active: parsed.data.active,
      elapsedMs: Date.now() - startedAt,
      ...recordAndGetRouteLatency("POST /automation/operators", Date.now() - startedAt),
      ...getAuthorizationCounters(),
      ...getOperatorPermissionCacheCounters()
    })
  );
  return res.status(201).json({ ok: true });
});

router.post("/automation/evaluate", requireWalletSignature, async (req, res) => {
  const parsed = automationEvaluateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const targetOwnerWallet = normalizeWalletAddress(parsed.data.wallet);
  if (!targetOwnerWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const executionPathEnabled = env.AUTOMATION_EXECUTION_ENABLED || env.AUTOMATION_AUTO_COMPOUND_ENABLED;
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet,
    authWalletRaw: res.locals.authWallet,
    requireCanEvaluate: true,
    requireCanExecute: executionPathEnabled
  });
  if (!auth.ok) {
    recordAutomationAuthorizationDenied();
    console.warn(
      JSON.stringify({
        event: "automation_authorization_denied",
        action: "evaluate",
        ownerWallet: targetOwnerWallet,
        reason: auth.reason,
        ...getAuthorizationCounters()
      })
    );
    if (auth.reason === "invalid_auth_wallet") {
      return res.status(401).json({ error: "Missing authenticated wallet" });
    }
    if (auth.reason === "operator_missing_can_execute") {
      return res.status(403).json({
        error: "Operator is allowed to evaluate but not to run execution-enabled paths. Disable execution flags or grant canExecute."
      });
    }
    return res.status(403).json({ error: "Operator is not allowed to evaluate this owner wallet" });
  }
  const actorRole = auth.actorRole;
  const authWallet = auth.authWallet;

  try {
    const mode = parsed.data.mode ?? "BALANCED";
    const startedAt = Date.now();
    await worker.evaluateWallet({ wallet: targetOwnerWallet, mode });
    console.info(
      JSON.stringify({
        event: "automation_evaluate_completed",
        wallet: targetOwnerWallet,
        triggeredByWallet: authWallet,
        actorRole,
        mode,
        executionEnabled: env.AUTOMATION_EXECUTION_ENABLED,
        minimumNetBenefitUsd: env.AUTOMATION_MIN_NET_BENEFIT_USD,
        elapsedMs: Date.now() - startedAt,
        ...recordAndGetRouteLatency("POST /automation/evaluate", Date.now() - startedAt),
        ...getAuthorizationCounters(),
        ...getOperatorPermissionCacheCounters()
      })
    );
    return res.json(
      automationEvaluateResponseSchema.parse({
        ok: true,
        wallet: targetOwnerWallet,
        actorRole,
        triggeredByWallet: authWallet,
        mode,
        executionEnabled: env.AUTOMATION_EXECUTION_ENABLED,
        minimumNetBenefitUsd: env.AUTOMATION_MIN_NET_BENEFIT_USD,
        autoCompoundEnabled: env.AUTOMATION_AUTO_COMPOUND_ENABLED,
        minimumCompoundFeesUsd: env.AUTOMATION_MIN_COMPOUND_FEES_USD,
        note: env.AUTOMATION_EXECUTION_ENABLED
          ? "Worker guarded execution is enabled. Ensure executor integration is configured."
          : "Worker runs in dry-run mode by default. Set AUTOMATION_EXECUTION_ENABLED=true to allow guarded execution. Auto-compounding can be toggled with AUTOMATION_AUTO_COMPOUND_ENABLED."
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "automation_evaluate_failed",
        wallet: targetOwnerWallet,
        triggeredByWallet: authWallet,
        error: error instanceof Error ? error.message : "unknown_error"
      })
    );
    return res.status(500).json({ error: "Failed to evaluate automation worker" });
  }
});

router.post("/automation/smoke", requireWalletSignature, async (req, res) => {
  const parsed = automationSmokeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const targetOwnerWallet = normalizeWalletAddress(parsed.data.wallet);
  if (!targetOwnerWallet) {
    return res.status(400).json({ error: "Invalid wallet address format" });
  }
  const isLiveMode = parsed.data.mode === "LIVE";
  const auth = await authorizeOwnerOrOperatorAction({
    targetOwnerWallet,
    authWalletRaw: res.locals.authWallet,
    requireCanEvaluate: true,
    requireCanExecute: isLiveMode
  });
  if (!auth.ok) {
    recordAutomationAuthorizationDenied();
    if (auth.reason === "invalid_auth_wallet") {
      return res.status(401).json({ error: "Missing authenticated wallet" });
    }
    return res.status(403).json({ error: "Operator is not allowed for this smoke test" });
  }
  const actorRole = auth.actorRole;
  const authWallet = auth.authWallet;

  if (isLiveMode) {
    if (!parsed.data.allowLiveSubmission) {
      return res.status(400).json({
        error: "LIVE mode requires allowLiveSubmission=true to avoid accidental spend"
      });
    }
    if (!env.AUTOMATION_RELAYER_ENABLED || !env.AUTOMATION_RELAYER_URL) {
      return res.status(400).json({
        error: "Relayer is not ready. Set AUTOMATION_RELAYER_ENABLED=true and AUTOMATION_RELAYER_URL."
      });
    }
    if (!parsed.data.txRequest) {
      return res.status(400).json({
        error: "LIVE mode requires txRequest payload."
      });
    }
  }

  const job = await enqueueAutomationJob({
    wallet: targetOwnerWallet,
    chainId: parsed.data.chainId ?? 42161,
    type: "REBALANCE",
    idempotencyKey: `smoke-${targetOwnerWallet.toLowerCase()}-${Date.now()}-${randomUUID()}`,
    priority: 1,
    payload: {
      smokeTest: true,
      expectedProfitUsd: 1000,
      estimatedGasUsd: 1,
      ...(parsed.data.txRequest ? { txRequest: parsed.data.txRequest } : {})
    }
  });

  const run = await executeAutomationJobById(job.id, {
    workerId: `smoke-${authWallet.toLowerCase()}`
  });
  const executions = await listAutomationExecutions({ jobId: job.id, limit: 1 });
  const latest = executions[0] ?? null;
  const note = latest
    ? `Smoke executed: status=${latest.status}, txStatus=${latest.txStatus ?? "n/a"}`
    : run.ok
      ? "Smoke executed without execution record."
      : `Smoke execution failed: ${run.error}`;

  return res.json(
    automationSmokeResponseSchema.parse({
      ok: true,
      wallet: targetOwnerWallet,
      mode: parsed.data.mode,
      actorRole,
      triggeredByWallet: authWallet,
      jobId: job.id,
      executionId: latest?.id ?? null,
      executionStatus: latest?.status ?? null,
      txStatus: latest?.txStatus ?? null,
      txHash: latest?.txHash ?? null,
      note
    })
  );
});

export default router;

function recordAndGetRouteLatency(routeKey: string, elapsedMs: number) {
  recordRouteLatency(routeKey, elapsedMs);
  return getRouteLatencySummary(routeKey);
}
