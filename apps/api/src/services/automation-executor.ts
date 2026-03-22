import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";

const ETHEREUM_MAINNET_CHAIN_ID = 1;
import { prisma } from "../db/prisma";
import {
  claimNextAutomationJob,
  markAutomationJobFailed,
  markAutomationJobRunning,
  markAutomationJobSucceeded,
  type AutomationJobRecord
} from "./automation-queue";
import { evaluateAutomationGasPolicy } from "./automation-gas-policy";
import { evaluateAutomationRisk } from "./risk-engine";
import { confirmAutomationTxOnchain, parseAutomationTxRequestFromPayload, submitAutomationTxViaRelayer } from "./automation-tx-relayer";
import { checkEmergencyPaused } from "./automation-emergency-check";
import { writeAuditLogV2 } from "./audit-v2";

export type AutomationExecutionRow = {
  id: string;
  jobId: string;
  wallet: string;
  positionId: string | null;
  chainId: number | null;
  type: "EVALUATE" | "REBALANCE" | "COLLECT" | "COMPOUND" | "DISTRIBUTE";
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  txHash: string | null;
  txStatus: string | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  costUsd: number | null;
  profitUsd: number | null;
  netProfitUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  context: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

type ExecuteOptions = {
  workerId: string;
  actorWallet?: `0x${string}`;
  actorRole?: "OWNER" | "OPERATOR" | "SYSTEM";
};

type PolicyContext = {
  maxGasUsd: number;
  minNetBenefitUsd: number;
  volatilityScore?: number | null;
  oracleDeviationBps?: number | null;
  poolLiquidityUsd?: number | null;
};

function parsePayload(payload: Prisma.JsonValue | null): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function isNonFatalRelayerUnavailableReason(reason: string): boolean {
  return reason === "relayer_disabled" || reason === "relayer_url_missing";
}

const SYSTEM_ACTOR_WALLET = "0x0000000000000000000000000000000000000000" as `0x${string}`;

async function writeExecutionAuditLog(
  action: string,
  job: AutomationJobRecord,
  executionId: string,
  options: ExecuteOptions,
  details: { status: string; errorCode?: string | null; txHash?: string | null }
) {
  const actorWallet = options.actorWallet ?? SYSTEM_ACTOR_WALLET;
  const actorRole = options.actorRole ?? "SYSTEM";
  await writeAuditLogV2({
    actorWallet,
    actorRole,
    action,
    resourceType: "AutomationExecution",
    resourceId: executionId,
    reasonCode: details.errorCode ?? null,
    txHash: details.txHash ?? null,
    chainId: job.chainId,
    payloadJson: {
      jobId: job.id,
      wallet: job.wallet,
      positionId: job.positionId,
      type: job.type,
      status: details.status,
      errorCode: details.errorCode ?? null
    }
  });
}

/**
 * Reads AutomationPolicy for gas/min-benefit. Only called AFTER checkEmergencyPaused passes.
 * AutomationPolicy.enabled is synced from AutomationSetting.emergencyPaused by automation-settings route.
 */
async function readPolicy(job: AutomationJobRecord): Promise<PolicyContext> {
  const policyRows = await prisma.$queryRaw<Array<{ maxGasUsd: number; minNetBenefitUsd: number }>>`
    SELECT "maxGasUsd", "minNetBenefitUsd"
    FROM "AutomationPolicy"
    WHERE "wallet" = ${job.wallet}
      AND ("positionId" IS NULL OR "positionId" = ${job.positionId ?? null})
      AND "enabled" = true
    ORDER BY CASE WHEN "positionId" IS NULL THEN 1 ELSE 0 END ASC, "updatedAt" DESC
    LIMIT 1;
  `;
  return {
    maxGasUsd: policyRows[0]?.maxGasUsd ?? 20,
    minNetBenefitUsd: policyRows[0]?.minNetBenefitUsd ?? 0
  };
}

async function createExecution(job: AutomationJobRecord): Promise<AutomationExecutionRow> {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<AutomationExecutionRow[]>`
    INSERT INTO "AutomationExecution" (
      "id","jobId","wallet","positionId","chainId","type","status","startedAt","createdAt","updatedAt"
    )
    VALUES (
      ${id}, ${job.id}, ${job.wallet}, ${job.positionId}, ${job.chainId}, ${job.type}::"AutomationJobType",
      'STARTED'::"AutomationExecutionStatus", NOW(), NOW(), NOW()
    )
    RETURNING *;
  `;
  return rows[0];
}

async function finishExecution(
  executionId: string,
  input: {
    status: string;
    txStatus?: string;
    txHash?: string | null;
    costUsd?: number | null;
    profitUsd?: number | null;
    netProfitUsd?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    context?: Record<string, unknown>;
  }
) {
  await prisma.$executeRaw`
    UPDATE "AutomationExecution"
    SET
      "status" = ${input.status}::"AutomationExecutionStatus",
      "finishedAt" = NOW(),
      "txStatus" = ${input.txStatus ?? null},
      "txHash" = ${input.txHash ?? null},
      "costUsd" = ${input.costUsd ?? null},
      "profitUsd" = ${input.profitUsd ?? null},
      "netProfitUsd" = ${input.netProfitUsd ?? null},
      "errorCode" = ${input.errorCode ?? null},
      "errorMessage" = ${input.errorMessage ?? null},
      "context" = ${input.context ? JSON.stringify(input.context) : null}::jsonb,
      "updatedAt" = NOW()
    WHERE "id" = ${executionId};
  `;
}

async function executeSingleJob(
  job: AutomationJobRecord,
  options: ExecuteOptions
): Promise<{ executionId: string; outcome: "completed" | "precheck_failed" | "failed"; error?: string }> {
  const emergency = await checkEmergencyPaused({
    wallet: job.wallet,
    positionId: job.positionId,
    chainId: job.chainId
  });
  if (emergency.paused) {
    const execution = await createExecution(job);
    await finishExecution(execution.id, {
      status: "PRECHECK_FAILED",
      txStatus: "SKIPPED",
      errorCode: "emergency_paused",
      errorMessage: `Automation execution blocked: emergency pause is active (source: ${emergency.source})`,
      context: { emergencySource: emergency.source }
    });
    await markAutomationJobFailed(job.id, "emergency_paused");
    await writeExecutionAuditLog(
      "automation_execution_precheck_failed",
      job,
      execution.id,
      options,
      { status: "PRECHECK_FAILED", errorCode: "emergency_paused" }
    );
    return { executionId: execution.id, outcome: "precheck_failed" };
  }

  if (
    env.MAINNET_AUTO_EXECUTION_DISABLED &&
    job.chainId === ETHEREUM_MAINNET_CHAIN_ID &&
    ["REBALANCE", "COLLECT", "COMPOUND"].includes(job.type)
  ) {
    const execution = await createExecution(job);
    await finishExecution(execution.id, {
      status: "PRECHECK_FAILED",
      txStatus: "SKIPPED",
      errorCode: "mainnet_auto_disabled",
      errorMessage: "Auto execution is disabled on Ethereum Mainnet. Use manual trigger only.",
      context: { chainId: job.chainId }
    });
    await markAutomationJobFailed(job.id, "mainnet_auto_disabled");
    await writeExecutionAuditLog(
      "automation_execution_precheck_failed",
      job,
      execution.id,
      options,
      { status: "PRECHECK_FAILED", errorCode: "mainnet_auto_disabled" }
    );
    return { executionId: execution.id, outcome: "precheck_failed" };
  }

  const execution = await createExecution(job);
  await markAutomationJobRunning(job.id);
  const payload = parsePayload(job.payload);
  const estimatedGasUsd = Number(payload.estimatedGasUsd ?? 0);
  const expectedProfitUsd = Number(payload.expectedProfitUsd ?? 0);

  const policy = await readPolicy(job);
  const gasDecision = evaluateAutomationGasPolicy({
    estimatedGasUsd: Math.max(0, estimatedGasUsd),
    maxGasUsd: policy.maxGasUsd
  });
  const riskDecision = evaluateAutomationRisk({
    volatilityScore: Number(payload.volatilityScore ?? 0),
    oracleDeviationBps: Number(payload.oracleDeviationBps ?? 0),
    poolLiquidityUsd: Number(payload.poolLiquidityUsd ?? 0),
    estimatedGasUsd
  });
  const netProfitUsd = expectedProfitUsd - Math.max(0, estimatedGasUsd);
  if (!gasDecision.ok || !riskDecision.allow || netProfitUsd < policy.minNetBenefitUsd) {
    const reason = !gasDecision.ok
      ? gasDecision.reason
      : !riskDecision.allow
        ? `risk_blocked:${riskDecision.triggeredRules.join(",")}`
        : "min_net_benefit_not_met";
    await finishExecution(execution.id, {
      status: "PRECHECK_FAILED",
      txStatus: "SKIPPED",
      costUsd: estimatedGasUsd,
      profitUsd: expectedProfitUsd,
      netProfitUsd,
      errorCode: reason,
      errorMessage: reason,
      context: {
        policy,
        triggeredRules: riskDecision.triggeredRules
      }
    });
    await markAutomationJobFailed(job.id, reason ?? "precheck_failed");
    await writeExecutionAuditLog(
      "automation_execution_precheck_failed",
      job,
      execution.id,
      options,
      { status: "PRECHECK_FAILED", errorCode: reason }
    );
    return { executionId: execution.id, outcome: "precheck_failed" };
  }

  const txRequest = parseAutomationTxRequestFromPayload(payload);
  if (txRequest) {
    const relayerResult = await submitAutomationTxViaRelayer({
      jobId: job.id,
      executionId: execution.id,
      wallet: job.wallet,
      chainId: job.chainId ?? null,
      type: job.type,
      txRequest
    });
    if (relayerResult.submitted) {
      let finalStatus: "TX_SUBMITTED" | "TX_CONFIRMED" = relayerResult.txStatus;
      let txStatusText: string = relayerResult.txStatus;
      let context: Record<string, unknown> = {
        workerExecution: "relayer_submitted",
        ...relayerResult.context
      };
      if (env.AUTOMATION_RELAYER_WAIT_CONFIRMATION && finalStatus !== "TX_CONFIRMED") {
        const confirmation = await confirmAutomationTxOnchain({
          chainId: job.chainId ?? null,
          txHash: relayerResult.txHash
        });
        if (confirmation.confirmed) {
          finalStatus = "TX_CONFIRMED";
          txStatusText = "TX_CONFIRMED";
          context = {
            ...context,
            onchainConfirmation: "confirmed"
          };
        } else {
          await finishExecution(execution.id, {
            status: "FAILED",
            txStatus: "FAILED",
            txHash: relayerResult.txHash,
            costUsd: estimatedGasUsd,
            profitUsd: expectedProfitUsd,
            netProfitUsd,
            errorCode: confirmation.reason,
            errorMessage: confirmation.reason,
            context: {
              ...context,
              onchainConfirmation: "failed",
              confirmationReason: confirmation.reason
            }
          });
          await markAutomationJobFailed(job.id, confirmation.reason);
          await writeExecutionAuditLog(
            "automation_execution_failed",
            job,
            execution.id,
            options,
            { status: "FAILED", errorCode: confirmation.reason, txHash: relayerResult.txHash }
          );
          return { executionId: execution.id, outcome: "failed", error: confirmation.reason };
        }
      }
      await finishExecution(execution.id, {
        status: finalStatus,
        txStatus: txStatusText,
        txHash: relayerResult.txHash,
        costUsd: estimatedGasUsd,
        profitUsd: expectedProfitUsd,
        netProfitUsd,
        context
      });
      await markAutomationJobSucceeded(job.id);
      await writeExecutionAuditLog(
        "automation_execution_completed",
        job,
        execution.id,
        options,
        { status: finalStatus, txHash: relayerResult.txHash }
      );
      return { executionId: execution.id, outcome: "completed" };
    }

    if (isNonFatalRelayerUnavailableReason(relayerResult.reason)) {
      await finishExecution(execution.id, {
        status: "COMPLETED",
        txStatus: "NOT_SUBMITTED",
        txHash: null,
        costUsd: estimatedGasUsd,
        profitUsd: expectedProfitUsd,
        netProfitUsd,
        context: {
          workerExecution: "recorded",
          nextStep: "configure_relayer_and_retry_live_submission",
          relayerReason: relayerResult.reason,
          ...relayerResult.context
        }
      });
      await markAutomationJobSucceeded(job.id);
      await writeExecutionAuditLog(
        "automation_execution_completed",
        job,
        execution.id,
        options,
        { status: "COMPLETED" }
      );
      return { executionId: execution.id, outcome: "completed" };
    }

    await finishExecution(execution.id, {
      status: "FAILED",
      txStatus: "FAILED",
      txHash: null,
      costUsd: estimatedGasUsd,
      profitUsd: expectedProfitUsd,
      netProfitUsd,
      errorCode: relayerResult.reason,
      errorMessage: relayerResult.reason,
      context: {
        workerExecution: "relayer_failed",
        ...relayerResult.context
      }
    });
    await markAutomationJobFailed(job.id, relayerResult.reason);
    await writeExecutionAuditLog(
      "automation_execution_failed",
      job,
      execution.id,
      options,
      { status: "FAILED", errorCode: relayerResult.reason }
    );
    return { executionId: execution.id, outcome: "failed", error: relayerResult.reason };
  }

  // Server-side executor records execution state; tx submission requires payload.txRequest + relayer.
  await finishExecution(execution.id, {
    status: "COMPLETED",
    txStatus: "NOT_SUBMITTED",
    txHash: null,
    costUsd: estimatedGasUsd,
    profitUsd: expectedProfitUsd,
    netProfitUsd,
    context: {
      workerExecution: "recorded",
      nextStep: "submit_tx_via_signer_or_relayer"
    }
  });
  await markAutomationJobSucceeded(job.id);
  await writeExecutionAuditLog(
    "automation_execution_completed",
    job,
    execution.id,
    options,
    { status: "COMPLETED" }
  );
  return { executionId: execution.id, outcome: "completed" };
}

export async function executeAutomationQueueOnce(options: ExecuteOptions) {
  const leased = await claimNextAutomationJob(options.workerId, 30_000);
  if (!leased) return { processed: false };
  try {
    const out = await executeSingleJob(leased, options);
    if (out.outcome === "failed") {
      return { processed: true, jobId: leased.id, executionId: out.executionId, failed: true, error: out.error };
    }
    return { processed: true, jobId: leased.id, executionId: out.executionId, outcome: out.outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_execution_error";
    await markAutomationJobFailed(leased.id, message);
    try {
      const execRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AutomationExecution"
        WHERE "jobId" = ${leased.id}
        ORDER BY "startedAt" DESC
        LIMIT 1;
      `;
      const executionId = execRows[0]?.id ?? leased.id;
      const resourceType = execRows[0] ? "AutomationExecution" : "AutomationJob";
      await writeAuditLogV2({
        actorWallet: options.actorWallet ?? SYSTEM_ACTOR_WALLET,
        actorRole: options.actorRole ?? "SYSTEM",
        action: "automation_execution_failed",
        resourceType,
        resourceId: executionId,
        reasonCode: "unexpected_exception",
        chainId: leased.chainId,
        payloadJson: {
          jobId: leased.id,
          wallet: leased.wallet,
          positionId: leased.positionId,
          type: leased.type,
          status: "FAILED",
          errorCode: "unexpected_exception",
          errorMessage: message
        }
      });
    } catch (auditErr) {
      console.error(
        JSON.stringify({
          event: "automation_execution_audit_failed",
          jobId: leased.id,
          error: auditErr instanceof Error ? auditErr.message : "unknown"
        })
      );
    }
    return { processed: true, jobId: leased.id, failed: true, error: message };
  }
}

export async function executeAutomationJobById(jobId: string, options: ExecuteOptions) {
  const rows = await prisma.$queryRaw<AutomationJobRecord[]>`
    SELECT *
    FROM "AutomationJob"
    WHERE "id" = ${jobId}
    LIMIT 1;
  `;
  const job = rows[0];
  if (!job) return { ok: false as const, error: "job_not_found" };
  if (job.status === "SUCCEEDED" || job.status === "DEAD_LETTER" || job.status === "CANCELLED") {
    return { ok: true as const, skipped: true as const };
  }
  if (job.status === "RUNNING" || job.status === "LEASED") {
    return { ok: true as const, skipped: true as const };
  }
  try {
    const out = await executeSingleJob(job, options);
    if (out.outcome === "failed") {
      return { ok: false as const, error: out.error ?? "execution_failed", executionId: out.executionId };
    }
    return { ok: true as const, executionId: out.executionId, outcome: out.outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_execution_error";
    await markAutomationJobFailed(job.id, message);
    try {
      const execRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AutomationExecution"
        WHERE "jobId" = ${job.id}
        ORDER BY "startedAt" DESC
        LIMIT 1;
      `;
      const executionId = execRows[0]?.id ?? job.id;
      const resourceType = execRows[0] ? "AutomationExecution" : "AutomationJob";
      await writeAuditLogV2({
        actorWallet: options.actorWallet ?? SYSTEM_ACTOR_WALLET,
        actorRole: options.actorRole ?? "SYSTEM",
        action: "automation_execution_failed",
        resourceType,
        resourceId: executionId,
        reasonCode: "unexpected_exception",
        chainId: job.chainId,
        payloadJson: {
          jobId: job.id,
          wallet: job.wallet,
          positionId: job.positionId,
          type: job.type,
          status: "FAILED",
          errorCode: "unexpected_exception",
          errorMessage: message
        }
      });
    } catch (auditErr) {
      console.error(
        JSON.stringify({
          event: "automation_execution_audit_failed",
          jobId: job.id,
          error: auditErr instanceof Error ? auditErr.message : "unknown"
        })
      );
    }
    return { ok: false as const, error: message };
  }
}

export async function listAutomationExecutions(input: {
  wallet?: string;
  limit?: number;
  jobId?: string;
  ids?: string[];
  status?: "all" | "success" | "failed" | "precheck_failed";
}): Promise<AutomationExecutionRow[]> {
  const where: Prisma.Sql[] = [];
  if (input.wallet) where.push(Prisma.sql`"wallet" = ${input.wallet.toLowerCase()}`);
  if (input.jobId) where.push(Prisma.sql`"jobId" = ${input.jobId}`);
  if (input.ids && input.ids.length > 0) where.push(Prisma.sql`"id" IN (${Prisma.join(input.ids)})`);
  if (input.status && input.status !== "all") {
    if (input.status === "success") {
      where.push(Prisma.sql`"status" IN ('COMPLETED'::"AutomationExecutionStatus", 'TX_CONFIRMED'::"AutomationExecutionStatus", 'TX_SUBMITTED'::"AutomationExecutionStatus", 'SNAPSHOT_UPDATED'::"AutomationExecutionStatus")`);
    } else if (input.status === "failed") {
      where.push(Prisma.sql`"status" = 'FAILED'::"AutomationExecutionStatus"`);
    } else if (input.status === "precheck_failed") {
      where.push(Prisma.sql`"status" = 'PRECHECK_FAILED'::"AutomationExecutionStatus"`);
    }
  }
  const whereSql = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return prisma.$queryRaw<AutomationExecutionRow[]>`
    SELECT *
    FROM "AutomationExecution"
    ${whereSql}
    ORDER BY "startedAt" DESC
    LIMIT ${limit};
  `;
}

export async function executeQueuedJobsForWallet(input: {
  wallet: string;
  maxJobs: number;
  workerId: string;
}) {
  const walletLower = input.wallet.toLowerCase();
  const maxJobs = Math.min(Math.max(input.maxJobs, 1), 50);
  const jobs = await prisma.$queryRaw<AutomationJobRecord[]>`
    SELECT *
    FROM "AutomationJob"
    WHERE "wallet" = ${walletLower}
      AND "status" IN ('QUEUED'::"AutomationJobStatus", 'FAILED'::"AutomationJobStatus")
      AND "scheduledAt" <= NOW()
    ORDER BY "priority" ASC, "scheduledAt" ASC
    LIMIT ${maxJobs};
  `;
  let processed = 0;
  let failed = 0;
  const processedJobIds: string[] = [];
  const processedExecutionIds: string[] = [];
  const failedJobIds: string[] = [];
  for (const job of jobs) {
    const result = await executeAutomationJobById(job.id, { workerId: input.workerId });
    if ("skipped" in result && result.skipped) continue;
    processed += 1;
    processedJobIds.push(job.id);
    if (result.ok && result.executionId) {
      processedExecutionIds.push(result.executionId);
    }
    if (!result.ok) {
      failed += 1;
      failedJobIds.push(job.id);
    }
  }
  return { processed, failed, processedJobIds, processedExecutionIds, failedJobIds };
}
