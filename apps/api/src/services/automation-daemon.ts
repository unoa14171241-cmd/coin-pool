import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { executeQueuedJobsForWallet } from "./automation-executor";
import { listWalletsWithPendingAutomationJobs, retryFailedAutomationJobs } from "./automation-queue";
import { getAutomationCounters, recordAutomationQueueTick } from "./observability/automation-metrics-observability";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { evaluateAutoManagedWallets } from "./automation-autopilot";

type AutomationDaemonOptions = {
  enabled: boolean;
  intervalMs: number;
  maxWalletsPerTick: number;
  maxJobsPerWallet: number;
  retryFailedLimit: number;
  workerId?: string;
};

type AutomationDaemonState = {
  enabled: boolean;
  running: boolean;
  workerId: string;
  intervalMs: number;
  maxWalletsPerTick: number;
  maxJobsPerWallet: number;
  retryFailedLimit: number;
  tickCount: number;
  lastTickAt: string | null;
  lastTickElapsedMs: number | null;
  lastError: string | null;
  inTick: boolean;
  lastCleanupAt: string | null;
};

export type AutomationDaemonTickLog = {
  at: string;
  workerId: string;
  walletCount: number;
  processed: number;
  failed: number;
  requeued: number;
  processedJobIds: string[];
  failedJobIds: string[];
  processedExecutionIds: string[];
  elapsedMs: number;
  ok: boolean;
  error: string | null;
};

let timer: NodeJS.Timeout | null = null;
let inTick = false;
const state: AutomationDaemonState = {
  enabled: false,
  running: false,
  workerId: "daemon-worker",
  intervalMs: 15_000,
  maxWalletsPerTick: 20,
  maxJobsPerWallet: 5,
  retryFailedLimit: 0,
  tickCount: 0,
  lastTickAt: null,
  lastTickElapsedMs: null,
  lastError: null,
  inTick: false,
  lastCleanupAt: null
};
const tickLogs: AutomationDaemonTickLog[] = [];
const MAX_TICK_LOGS = 200;

function pushTickLog(entry: AutomationDaemonTickLog) {
  tickLogs.push(entry);
  if (tickLogs.length > MAX_TICK_LOGS) {
    tickLogs.splice(0, tickLogs.length - MAX_TICK_LOGS);
  }
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string");
}

async function persistTickLog(entry: AutomationDaemonTickLog): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "AutomationDaemonTick" (
        "id","at","workerId","walletCount","processed","failed","requeued",
        "processedJobIds","failedJobIds","processedExecutionIds","elapsedMs","ok","error","createdAt"
      )
      VALUES (
        ${randomUUID()},
        ${new Date(entry.at)},
        ${entry.workerId},
        ${entry.walletCount},
        ${entry.processed},
        ${entry.failed},
        ${entry.requeued},
        ${JSON.stringify(entry.processedJobIds)}::jsonb,
        ${JSON.stringify(entry.failedJobIds)}::jsonb,
        ${JSON.stringify(entry.processedExecutionIds)}::jsonb,
        ${entry.elapsedMs},
        ${entry.ok},
        ${entry.error ?? null},
        NOW()
      );
    `;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "automation_daemon_tick_persist_failed",
        workerId: entry.workerId,
        at: entry.at,
        error: error instanceof Error ? error.message : "unknown_error"
      })
    );
  }
}

async function runTick() {
  if (inTick || !state.running) return { accepted: false as const, reason: inTick ? "in_progress" : "not_running" };
  inTick = true;
  state.inTick = true;
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;
  let walletCount = 0;
  const processedJobIds: string[] = [];
  const failedJobIds: string[] = [];
  const processedExecutionIds: string[] = [];
  try {
    await maybeCleanupOldTickLogs();
    let autoEvaluationSummary:
      | {
          attempted: number;
          completed: number;
          failed: number;
        }
      | undefined;
    if (env.AUTOMATION_DAEMON_EVALUATE_ENABLED) {
      const evaluation = await evaluateAutoManagedWallets(env.AUTOMATION_DAEMON_EVALUATE_MAX_WALLETS);
      autoEvaluationSummary = {
        attempted: evaluation.attempted,
        completed: evaluation.completed,
        failed: evaluation.failed
      };
    }
    if (state.retryFailedLimit > 0) {
      await retryFailedAutomationJobs(state.retryFailedLimit);
    }
    const wallets = await listWalletsWithPendingAutomationJobs(state.maxWalletsPerTick);
    walletCount = wallets.length;
    for (const wallet of wallets) {
      const out = await executeQueuedJobsForWallet({
        wallet,
        maxJobs: state.maxJobsPerWallet,
        workerId: state.workerId
      });
      processed += out.processed;
      failed += out.failed;
      processedJobIds.push(...out.processedJobIds);
      failedJobIds.push(...out.failedJobIds);
      processedExecutionIds.push(...out.processedExecutionIds);
    }
    recordAutomationQueueTick({
      processed,
      failed,
      requeued: state.retryFailedLimit
    });
    state.tickCount += 1;
    state.lastTickAt = new Date().toISOString();
    state.lastTickElapsedMs = Date.now() - startedAt;
    state.lastError = null;
    const tickEntry: AutomationDaemonTickLog = {
      at: state.lastTickAt,
      workerId: state.workerId,
      walletCount,
      processed,
      failed,
      requeued: state.retryFailedLimit,
      processedJobIds,
      failedJobIds,
      processedExecutionIds,
      elapsedMs: state.lastTickElapsedMs,
      ok: true,
      error: null
    };
    pushTickLog(tickEntry);
    await persistTickLog(tickEntry);
    console.info(
      JSON.stringify({
        event: "automation_daemon_tick_completed",
        workerId: state.workerId,
        processed,
        failed,
        processedJobIds,
        failedJobIds,
        processedExecutionIds,
        autoEvaluationSummary,
        elapsedMs: state.lastTickElapsedMs,
        counters: getAutomationCounters()
      })
    );
    return { accepted: true as const, processed, failed, walletCount };
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "unknown_daemon_error";
    const at = new Date().toISOString();
    const tickEntry: AutomationDaemonTickLog = {
      at,
      workerId: state.workerId,
      walletCount,
      processed,
      failed,
      requeued: state.retryFailedLimit,
      processedJobIds,
      failedJobIds,
      processedExecutionIds,
      elapsedMs: Date.now() - startedAt,
      ok: false,
      error: state.lastError
    };
    pushTickLog(tickEntry);
    await persistTickLog(tickEntry);
    console.error(
      JSON.stringify({
        event: "automation_daemon_tick_failed",
        workerId: state.workerId,
        error: state.lastError
      })
    );
    return { accepted: true as const, processed, failed, walletCount, error: state.lastError };
  } finally {
    inTick = false;
    state.inTick = false;
  }
}

async function maybeCleanupOldTickLogs() {
  const now = Date.now();
  const last = state.lastCleanupAt ? Date.parse(state.lastCleanupAt) : 0;
  if (last > 0 && now - last < env.AUTOMATION_AUDIT_CLEANUP_INTERVAL_MS) return;
  await cleanupAutomationDaemonTicks({
    retentionDays: env.AUTOMATION_AUDIT_RETENTION_DAYS,
    limit: env.AUTOMATION_AUDIT_CLEANUP_BATCH
  });
  state.lastCleanupAt = new Date().toISOString();
}

export function startAutomationDaemon(options: AutomationDaemonOptions) {
  state.enabled = options.enabled;
  state.workerId = options.workerId ?? "daemon-worker";
  state.intervalMs = options.intervalMs;
  state.maxWalletsPerTick = options.maxWalletsPerTick;
  state.maxJobsPerWallet = options.maxJobsPerWallet;
  state.retryFailedLimit = options.retryFailedLimit;
  if (!options.enabled) {
    state.running = false;
    if (timer) clearInterval(timer);
    timer = null;
    return;
  }
  if (timer) clearInterval(timer);
  state.running = true;
  timer = setInterval(() => {
    void runTick();
  }, state.intervalMs);
  void runTick();
}

export function stopAutomationDaemon() {
  state.running = false;
  state.inTick = false;
  if (timer) clearInterval(timer);
  timer = null;
}

export function getAutomationDaemonState() {
  return { ...state };
}

export function getAutomationDaemonRecentTicks(limit = 20) {
  const size = Math.min(Math.max(limit, 1), 200);
  return tickLogs.slice(-size).reverse();
}

export async function getAutomationDaemonRecentTicksDurable(limit = 20, offset = 0): Promise<AutomationDaemonTickLog[]> {
  const size = Math.min(Math.max(limit, 1), 200);
  const skip = Math.max(0, Math.floor(offset));
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        at: Date;
        workerId: string;
        walletCount: number;
        processed: number;
        failed: number;
        requeued: number;
        processedJobIds: unknown;
        failedJobIds: unknown;
        processedExecutionIds: unknown;
        elapsedMs: number;
        ok: boolean;
        error: string | null;
      }>
    >`
      SELECT
        "at","workerId","walletCount","processed","failed","requeued",
        "processedJobIds","failedJobIds","processedExecutionIds","elapsedMs","ok","error"
      FROM "AutomationDaemonTick"
      ORDER BY "at" DESC
      OFFSET ${skip}
      LIMIT ${size};
    `;
    return rows.map((row) => ({
      at: row.at.toISOString(),
      workerId: row.workerId,
      walletCount: row.walletCount,
      processed: row.processed,
      failed: row.failed,
      requeued: row.requeued,
      processedJobIds: toStringArray(row.processedJobIds),
      failedJobIds: toStringArray(row.failedJobIds),
      processedExecutionIds: toStringArray(row.processedExecutionIds),
      elapsedMs: row.elapsedMs,
      ok: row.ok,
      error: row.error
    }));
  } catch {
    return [];
  }
}

export async function triggerAutomationDaemonTickNow() {
  return runTick();
}

export async function cleanupAutomationDaemonTicks(input?: { retentionDays?: number; limit?: number }) {
  const retentionDays = Math.min(Math.max(input?.retentionDays ?? env.AUTOMATION_AUDIT_RETENTION_DAYS, 1), 3650);
  const limit = Math.min(Math.max(input?.limit ?? env.AUTOMATION_AUDIT_CLEANUP_BATCH, 1), 50_000);
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AutomationDaemonTick"
      WHERE "at" < NOW() - make_interval(days => ${retentionDays})
      ORDER BY "at" ASC
      LIMIT ${limit};
    `;
    if (rows.length === 0) return { deleted: 0, retentionDays };
    const ids = rows.map((row) => row.id);
    await prisma.$executeRaw`
      DELETE FROM "AutomationDaemonTick"
      WHERE "id" IN (${Prisma.join(ids)});
    `;
    return { deleted: ids.length, retentionDays };
  } catch {
    return { deleted: 0, retentionDays };
  }
}
