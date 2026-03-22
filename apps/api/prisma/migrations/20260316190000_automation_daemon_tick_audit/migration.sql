CREATE TABLE IF NOT EXISTS "AutomationDaemonTick" (
  "id" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workerId" TEXT NOT NULL,
  "walletCount" INTEGER NOT NULL,
  "processed" INTEGER NOT NULL,
  "failed" INTEGER NOT NULL,
  "requeued" INTEGER NOT NULL,
  "processedJobIds" JSONB NOT NULL,
  "failedJobIds" JSONB NOT NULL,
  "processedExecutionIds" JSONB NOT NULL,
  "elapsedMs" INTEGER NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationDaemonTick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutomationDaemonTick_at_idx" ON "AutomationDaemonTick" ("at");
CREATE INDEX IF NOT EXISTS "AutomationDaemonTick_workerId_at_idx" ON "AutomationDaemonTick" ("workerId","at");
