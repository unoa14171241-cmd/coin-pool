/**
 * Daily USDC distribution scheduler.
 * Runs once per day at configurable UTC time, creates profit distributions for all wallets with active LP positions.
 *
 * - Idempotency: daily-distribution-{wallet}-{date}
 * - Retry: max 3 attempts per wallet on failure
 * - スナップショット: 全ポジション取得成功時のみ配当。一部失敗時はリトライ(3回)、それでも失敗なら snapshot_incomplete でスキップ
 * - Audit log: success and failure
 */
import { prisma } from "../db/prisma";
import { createDailyProfitDistribution } from "./daily-profit-engine";
import { writeAuditLogV2 } from "./audit-v2";
import { env } from "../config/env";
import { InProcessSnapshotRefresher } from "./analytics-interfaces";

const SYSTEM_ACTOR_WALLET = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const MAX_RETRIES = 3;
const SNAPSHOT_RETRIES = 3;

export type DailyDistributionSchedulerState = {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null;
  nextScheduledAt: string | null;
};

let state: DailyDistributionSchedulerState = {
  enabled: false,
  running: false,
  lastRunAt: null,
  lastRunOk: null,
  lastError: null,
  nextScheduledAt: null
};

let timer: NodeJS.Timeout | null = null;

async function listWalletsWithActivePositions(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ wallet: string }>>`
    SELECT DISTINCT p."wallet"
    FROM "Position" p
    WHERE p."status" != 'CLOSED'
    ORDER BY p."wallet" ASC
  `;
  return rows.map((r) => r.wallet.toLowerCase());
}

/** 指定日付でウォレットのスナップショットが全ポジション分揃っているか */
async function isWalletSnapshotCompleteForDate(
  wallet: string,
  dayStart: Date,
  dayEnd: Date
): Promise<boolean> {
  const walletLower = wallet.toLowerCase();
  const counts = await prisma.$queryRaw<Array<{ totalPositions: bigint; positionsWithSnapshot: bigint }>>`
    WITH total AS (
      SELECT COUNT(*)::bigint as cnt
      FROM "Position"
      WHERE "wallet" = ${walletLower}
        AND "status" != 'CLOSED'
    ),
    with_snap AS (
      SELECT COUNT(DISTINCT p."positionId")::bigint as cnt
      FROM "Position" p
      INNER JOIN "PositionSnapshot" ps ON ps."positionId" = p."positionId"
      WHERE p."wallet" = ${walletLower}
        AND p."status" != 'CLOSED'
        AND ps."snapshotAt" >= ${dayStart}
        AND ps."snapshotAt" < ${dayEnd}
    )
    SELECT (SELECT cnt FROM total) as "totalPositions",
           (SELECT cnt FROM with_snap) as "positionsWithSnapshot"
  `;
  const row = counts[0];
  if (!row) return false;
  return row.totalPositions === row.positionsWithSnapshot && Number(row.totalPositions) > 0;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Run daily distribution for a specific date (e.g. manual trigger, backfill).
 * Used by POST /profit/daily-distribution/trigger.
 * createDailyProfitDistribution uses DB unique(ownerWallet, distributionAt) to prevent duplicates.
 */
export async function runDailyDistributionForDate(targetDate: Date): Promise<{
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  totalProfitUsd: number;
  targetDate: string;
  skippedDueToSnapshotIncomplete?: string[];
  errors?: Array<{ wallet: string; error: string }>;
}> {
  const dateStr = toDateString(targetDate);
  const dayStart = new Date(targetDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const wallets = await listWalletsWithActivePositions();
  let processed = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let totalProfitUsd = 0;
  const errors: Array<{ wallet: string; error: string }> = [];
  const skippedDueToSnapshotIncomplete: string[] = [];
  const snapshotRefresher = new InProcessSnapshotRefresher();

  for (const wallet of wallets) {
    let snapshotComplete = await isWalletSnapshotCompleteForDate(wallet, dayStart, dayEnd);
    if (!snapshotComplete) {
      for (let i = 0; i < SNAPSHOT_RETRIES && !snapshotComplete; i++) {
        await snapshotRefresher.refreshPositionSnapshots({ wallet });
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        snapshotComplete = await isWalletSnapshotCompleteForDate(wallet, dayStart, dayEnd);
      }
    }
    if (!snapshotComplete) {
      skippedDueToSnapshotIncomplete.push(wallet);
      await writeAuditLogV2({
        actorWallet: SYSTEM_ACTOR_WALLET,
        actorRole: "SYSTEM",
        action: "daily_distribution_skipped",
        resourceType: "ProfitDistribution",
        resourceId: `daily-distribution-${wallet}-${dateStr}`,
        reasonCode: "snapshot_incomplete",
        reasonText: "All position snapshots could not be fetched after retries",
        payloadJson: { wallet, dateStr, snapshotRetries: SNAPSHOT_RETRIES }
      });
      continue;
    }

    const idempotencyKey = `daily-distribution-${wallet}-${dateStr}`;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await createDailyProfitDistribution({
          wallet,
          distributionAt: dayStart,
          chainId: undefined
        });
        processed += 1;
        totalProfitUsd += result.totalProfitUsd;
        if (result.skipped) {
          skipped += 1;
        } else {
          created += 1;
          await writeAuditLogV2({
            actorWallet: SYSTEM_ACTOR_WALLET,
            actorRole: "SYSTEM",
            action: "daily_distribution_created",
            resourceType: "ProfitDistribution",
            resourceId: idempotencyKey,
            payloadJson: { wallet, dateStr, attempt }
          });
        }
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "unknown_error";
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        } else {
          failed += 1;
          errors.push({ wallet, error: lastError });
          await writeAuditLogV2({
            actorWallet: SYSTEM_ACTOR_WALLET,
            actorRole: "SYSTEM",
            action: "daily_distribution_failed",
            resourceType: "ProfitDistribution",
            resourceId: idempotencyKey,
            reasonCode: "create_failed",
            reasonText: lastError,
            payloadJson: { wallet, dateStr, attempt: MAX_RETRIES, error: lastError }
          });
        }
      }
    }
  }

  return {
    processed,
    created,
    skipped,
    failed,
    totalProfitUsd,
    targetDate: dateStr,
    ...(skippedDueToSnapshotIncomplete.length > 0 && { skippedDueToSnapshotIncomplete }),
    ...(errors.length > 0 && { errors })
  };
}

export async function runDailyDistributionTick(options?: { forceRun?: boolean }): Promise<{
  accepted: boolean;
  reason?: string;
  processed?: number;
  failed?: number;
  errors?: Array<{ wallet: string; error: string }>;
}> {
  const forceRun = options?.forceRun === true;
  if (!forceRun && !state.enabled) {
    return { accepted: false, reason: "scheduler_disabled" };
  }
  if (state.running) {
    return { accepted: false, reason: "already_running" };
  }

  state.running = true;
  const startedAt = new Date();
  const dateStr = toDateString(startedAt);
  const dayStart = new Date(startedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  let processed = 0;
  let failed = 0;
  const errors: Array<{ wallet: string; error: string }> = [];
  const snapshotRefresher = new InProcessSnapshotRefresher();

  try {
    const wallets = await listWalletsWithActivePositions();
    if (wallets.length === 0) {
      state.lastRunAt = startedAt.toISOString();
      state.lastRunOk = true;
      state.lastError = null;
      console.info(
        JSON.stringify({
          event: "daily_distribution_tick_completed",
          walletCount: 0,
          processed: 0,
          failed: 0,
          elapsedMs: Date.now() - startedAt.getTime()
        })
      );
      return { accepted: true, processed: 0, failed: 0 };
    }

    for (const wallet of wallets) {
      let snapshotComplete = await isWalletSnapshotCompleteForDate(wallet, dayStart, dayEnd);
      if (!snapshotComplete) {
        for (let i = 0; i < SNAPSHOT_RETRIES && !snapshotComplete; i++) {
          await snapshotRefresher.refreshPositionSnapshots({ wallet });
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
          snapshotComplete = await isWalletSnapshotCompleteForDate(wallet, dayStart, dayEnd);
        }
      }
      if (!snapshotComplete) {
        await writeAuditLogV2({
          actorWallet: SYSTEM_ACTOR_WALLET,
          actorRole: "SYSTEM",
          action: "daily_distribution_skipped",
          resourceType: "ProfitDistribution",
          resourceId: `daily-distribution-${wallet}-${dateStr}`,
          reasonCode: "snapshot_incomplete",
          reasonText: "All position snapshots could not be fetched after retries",
          payloadJson: { wallet, dateStr, snapshotRetries: SNAPSHOT_RETRIES }
        });
        continue;
      }

      const idempotencyKey = `daily-distribution-${wallet}-${dateStr}`;
      let lastError: string | null = null;

      const existing = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count
        FROM "ProfitDistributionItem" i
        INNER JOIN "ProfitDistribution" d ON d."id" = i."distributionId"
        WHERE i."wallet" = ${wallet}
          AND d."distributionAt" >= ${dayStart}
          AND d."distributionAt" < ${dayEnd}
        LIMIT 1
      `;
      if (Number(existing[0]?.count ?? 0) > 0) {
        processed += 1;
        continue;
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await createDailyProfitDistribution({
            wallet,
            distributionAt: startedAt,
            chainId: undefined
          });
          processed += 1;
          await writeAuditLogV2({
            actorWallet: SYSTEM_ACTOR_WALLET,
            actorRole: "SYSTEM",
            action: "daily_distribution_created",
            resourceType: "ProfitDistribution",
            resourceId: idempotencyKey,
            payloadJson: { wallet, dateStr, attempt }
          });
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : "unknown_error";
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          } else {
            failed += 1;
            errors.push({ wallet, error: lastError });
            await writeAuditLogV2({
              actorWallet: SYSTEM_ACTOR_WALLET,
              actorRole: "SYSTEM",
              action: "daily_distribution_failed",
              resourceType: "ProfitDistribution",
              resourceId: idempotencyKey,
              reasonCode: "create_failed",
              reasonText: lastError,
              payloadJson: { wallet, dateStr, attempt: MAX_RETRIES, error: lastError }
            });
          }
        }
      }
    }

    state.lastRunAt = startedAt.toISOString();
    state.lastRunOk = failed === 0;
    state.lastError = failed > 0 ? errors.map((e) => `${e.wallet}: ${e.error}`).join("; ") : null;

    console.info(
      JSON.stringify({
        event: "daily_distribution_tick_completed",
        walletCount: wallets.length,
        processed,
        failed,
        errors: errors.length > 0 ? errors : undefined,
        elapsedMs: Date.now() - startedAt.getTime()
      })
    );

    return { accepted: true, processed, failed, errors: errors.length > 0 ? errors : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    state.lastRunAt = startedAt.toISOString();
    state.lastRunOk = false;
    state.lastError = message;

    await writeAuditLogV2({
      actorWallet: SYSTEM_ACTOR_WALLET,
      actorRole: "SYSTEM",
      action: "daily_distribution_tick_failed",
      resourceType: "DailyDistributionScheduler",
      reasonCode: "tick_error",
      reasonText: message,
      payloadJson: { dateStr, error: message }
    });

    console.error(
      JSON.stringify({
        event: "daily_distribution_tick_failed",
        error: message,
        elapsedMs: Date.now() - startedAt.getTime()
      })
    );

    return { accepted: true, processed, failed, errors: [{ wallet: "_tick", error: message }] };
  } finally {
    state.running = false;
    scheduleNextRun();
  }
}

function scheduleNextRun() {
  if (!state.enabled || !env.DAILY_DISTRIBUTION_SCHEDULER_ENABLED) return;

  const now = new Date();
  const hour = env.DAILY_DISTRIBUTION_SCHEDULER_HOUR_UTC;
  const minute = env.DAILY_DISTRIBUTION_SCHEDULER_MINUTE_UTC;

  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  state.nextScheduledAt = next.toISOString();
  const delayMs = next.getTime() - Date.now();

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void runDailyDistributionTick();
  }, Math.max(delayMs, 1000));
}

export function startDailyDistributionScheduler() {
  if (!env.DAILY_DISTRIBUTION_SCHEDULER_ENABLED) {
    state.enabled = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    return;
  }

  state.enabled = true;
  scheduleNextRun();

  console.info(
    JSON.stringify({
      event: "daily_distribution_scheduler_started",
      nextScheduledAt: state.nextScheduledAt,
      hourUtc: env.DAILY_DISTRIBUTION_SCHEDULER_HOUR_UTC,
      minuteUtc: env.DAILY_DISTRIBUTION_SCHEDULER_MINUTE_UTC
    })
  );
}

export function stopDailyDistributionScheduler() {
  state.enabled = false;
  state.running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  state.nextScheduledAt = null;
}

export function getDailyDistributionSchedulerState(): DailyDistributionSchedulerState {
  return { ...state };
}
