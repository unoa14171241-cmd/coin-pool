import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";

export type AutomationJobType = "EVALUATE" | "REBALANCE" | "COLLECT" | "COMPOUND" | "DISTRIBUTE";
export type AutomationJobStatus = "QUEUED" | "LEASED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "DEAD_LETTER";

export type EnqueueAutomationJobInput = {
  wallet: string;
  positionId?: string;
  chainId?: number;
  type: AutomationJobType;
  priority?: number;
  maxAttempts?: number;
  scheduledAt?: Date;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

export type AutomationJobRecord = {
  id: string;
  wallet: string;
  positionId: string | null;
  chainId: number | null;
  type: AutomationJobType;
  status: AutomationJobStatus;
  priority: number;
  scheduledAt: Date;
  leaseUntil: Date | null;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  payload: Prisma.JsonValue | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ListJobFilters = {
  wallet?: string;
  status?: AutomationJobStatus;
  type?: AutomationJobType;
  ids?: string[];
  limit?: number;
};

export async function enqueueAutomationJob(input: EnqueueAutomationJobInput): Promise<AutomationJobRecord> {
  const newId = randomUUID();
  const result = await prisma.$queryRaw<AutomationJobRecord[]>`
    INSERT INTO "AutomationJob" (
      "id",
      "wallet",
      "positionId",
      "chainId",
      "type",
      "status",
      "priority",
      "scheduledAt",
      "attempt",
      "maxAttempts",
      "idempotencyKey",
      "payload",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${newId},
      ${input.wallet.toLowerCase()},
      ${input.positionId ?? null},
      ${input.chainId ?? null},
      ${input.type}::"AutomationJobType",
      'QUEUED'::"AutomationJobStatus",
      ${input.priority ?? 100},
      ${input.scheduledAt ?? new Date()},
      0,
      ${input.maxAttempts ?? 5},
      ${input.idempotencyKey},
      ${input.payload ? JSON.stringify(input.payload) : null}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT ("idempotencyKey")
    DO UPDATE SET "updatedAt" = NOW()
    RETURNING *;
  `;
  return result[0];
}

export async function listAutomationJobs(filters: ListJobFilters = {}): Promise<AutomationJobRecord[]> {
  const where: Prisma.Sql[] = [];
  if (filters.wallet) where.push(Prisma.sql`"wallet" = ${filters.wallet.toLowerCase()}`);
  if (filters.status) where.push(Prisma.sql`"status" = ${filters.status}::"AutomationJobStatus"`);
  if (filters.type) where.push(Prisma.sql`"type" = ${filters.type}::"AutomationJobType"`);
  if (filters.ids && filters.ids.length > 0) {
    where.push(Prisma.sql`"id" IN (${Prisma.join(filters.ids)})`);
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const whereSql = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;

  return prisma.$queryRaw<AutomationJobRecord[]>`
    SELECT *
    FROM "AutomationJob"
    ${whereSql}
    ORDER BY "createdAt" DESC
    LIMIT ${limit};
  `;
}

export async function claimNextAutomationJob(workerId: string, leaseMs: number): Promise<AutomationJobRecord | null> {
  const workerRecordId = randomUUID();
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<AutomationJobRecord[]>`
      WITH next_job AS (
        SELECT "id"
        FROM "AutomationJob"
        WHERE "status" = 'QUEUED'::"AutomationJobStatus"
          AND "scheduledAt" <= NOW()
        ORDER BY "priority" ASC, "scheduledAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "AutomationJob" j
      SET
        "status" = 'LEASED'::"AutomationJobStatus",
        "leaseUntil" = NOW() + make_interval(secs => ${Math.max(1, Math.floor(leaseMs / 1000))}),
        "updatedAt" = NOW(),
        "attempt" = j."attempt" + 1
      FROM next_job
      WHERE j."id" = next_job."id"
      RETURNING j.*;
    `;
    if (rows.length === 0) return null;
    await tx.$executeRaw`
      INSERT INTO "AutomationWorker" ("id", "workerId", "status", "currentJobId", "lastHeartbeatAt", "createdAt", "updatedAt")
      VALUES (${workerRecordId}, ${workerId}, 'RUNNING', ${rows[0].id}, NOW(), NOW(), NOW())
      ON CONFLICT ("workerId")
      DO UPDATE
      SET "status" = 'RUNNING',
          "currentJobId" = ${rows[0].id},
          "lastHeartbeatAt" = NOW(),
          "updatedAt" = NOW();
    `;
    return rows[0];
  });
  return claimed;
}

export async function markAutomationJobRunning(jobId: string) {
  await prisma.$executeRaw`
    UPDATE "AutomationJob"
    SET "status" = 'RUNNING'::"AutomationJobStatus", "updatedAt" = NOW()
    WHERE "id" = ${jobId};
  `;
}

export async function markAutomationJobSucceeded(jobId: string) {
  await prisma.$executeRaw`
    UPDATE "AutomationJob"
    SET "status" = 'SUCCEEDED'::"AutomationJobStatus", "leaseUntil" = NULL, "lastError" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${jobId};
  `;
}

export async function markAutomationJobFailed(jobId: string, errorMessage: string) {
  await prisma.$executeRaw`
    UPDATE "AutomationJob"
    SET
      "status" = CASE WHEN "attempt" >= "maxAttempts" THEN 'DEAD_LETTER'::"AutomationJobStatus" ELSE 'FAILED'::"AutomationJobStatus" END,
      "leaseUntil" = NULL,
      "lastError" = ${errorMessage},
      "updatedAt" = NOW()
    WHERE "id" = ${jobId};
  `;
}

export async function retryFailedAutomationJobs(limit = 20) {
  await prisma.$executeRaw`
    UPDATE "AutomationJob"
    SET
      "status" = 'QUEUED'::"AutomationJobStatus",
      "scheduledAt" = NOW(),
      "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id"
      FROM "AutomationJob"
      WHERE "status" = 'FAILED'::"AutomationJobStatus"
      ORDER BY "updatedAt" ASC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    );
  `;
}

export async function retryFailedAutomationJobsForWallet(wallet: string, limit = 20) {
  await prisma.$executeRaw`
    UPDATE "AutomationJob"
    SET
      "status" = 'QUEUED'::"AutomationJobStatus",
      "scheduledAt" = NOW(),
      "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id"
      FROM "AutomationJob"
      WHERE "status" = 'FAILED'::"AutomationJobStatus"
        AND "wallet" = ${wallet.toLowerCase()}
      ORDER BY "updatedAt" ASC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    );
  `;
}

export async function listWalletsWithPendingAutomationJobs(limit = 20): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ wallet: string }>>`
    SELECT DISTINCT "wallet"
    FROM "AutomationJob"
    WHERE "status" IN ('QUEUED'::"AutomationJobStatus", 'FAILED'::"AutomationJobStatus")
      AND "scheduledAt" <= NOW()
    ORDER BY "wallet" ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)};
  `;
  return rows.map((row) => row.wallet);
}
