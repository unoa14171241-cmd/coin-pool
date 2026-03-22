DO $$ BEGIN
  CREATE TYPE "AutomationJobType" AS ENUM ('EVALUATE','REBALANCE','COLLECT','COMPOUND','DISTRIBUTE');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "AutomationJobStatus" AS ENUM ('QUEUED','LEASED','RUNNING','SUCCEEDED','FAILED','CANCELLED','DEAD_LETTER');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "AutomationExecutionStatus" AS ENUM ('STARTED','PRECHECK_FAILED','TX_SUBMITTED','TX_CONFIRMED','VERIFY_FAILED','SNAPSHOT_UPDATED','COMPLETED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "DistributionStatus" AS ENUM ('DRAFT','CALCULATED','EXECUTING','COMPLETED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "DistributionItemStatus" AS ENUM ('CLAIMABLE','PAID','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "PayoutMode" AS ENUM ('AUTO','CLAIM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "Position"
  ADD COLUMN IF NOT EXISTS "lastCompoundAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "totalCompoundedFees" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "compoundCount" INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS "AutomationPolicy" (
  "id" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "positionId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mode" TEXT NOT NULL DEFAULT 'BALANCED',
  "minNetBenefitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxGasUsd" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "maxSlippageBps" INTEGER NOT NULL DEFAULT 100,
  "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
  "staleSnapshotReject" BOOLEAN NOT NULL DEFAULT true,
  "autoCollectEnabled" BOOLEAN NOT NULL DEFAULT true,
  "autoCompoundEnabled" BOOLEAN NOT NULL DEFAULT false,
  "autoRebalanceEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationPolicy_wallet_positionId_key" ON "AutomationPolicy" ("wallet","positionId");
CREATE INDEX IF NOT EXISTS "AutomationPolicy_wallet_positionId_idx" ON "AutomationPolicy" ("wallet","positionId");

CREATE TABLE IF NOT EXISTS "AutomationJob" (
  "id" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "positionId" TEXT,
  "chainId" INTEGER,
  "type" "AutomationJobType" NOT NULL,
  "status" "AutomationJobStatus" NOT NULL DEFAULT 'QUEUED',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationJob_idempotencyKey_key" ON "AutomationJob" ("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AutomationJob_status_scheduledAt_priority_idx" ON "AutomationJob" ("status","scheduledAt","priority");
CREATE INDEX IF NOT EXISTS "AutomationJob_wallet_createdAt_idx" ON "AutomationJob" ("wallet","createdAt");

CREATE TABLE IF NOT EXISTS "AutomationExecution" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "positionId" TEXT,
  "chainId" INTEGER,
  "type" "AutomationJobType" NOT NULL,
  "status" "AutomationExecutionStatus" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "txHash" TEXT,
  "txStatus" TEXT,
  "gasUsed" TEXT,
  "effectiveGasPrice" TEXT,
  "costUsd" DOUBLE PRECISION,
  "profitUsd" DOUBLE PRECISION,
  "netProfitUsd" DOUBLE PRECISION,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AutomationExecution_jobId_startedAt_idx" ON "AutomationExecution" ("jobId","startedAt");
CREATE INDEX IF NOT EXISTS "AutomationExecution_wallet_startedAt_idx" ON "AutomationExecution" ("wallet","startedAt");
CREATE INDEX IF NOT EXISTS "AutomationExecution_type_status_startedAt_idx" ON "AutomationExecution" ("type","status","startedAt");
DO $$ BEGIN
  ALTER TABLE "AutomationExecution"
  ADD CONSTRAINT "AutomationExecution_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AutomationJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "AutomationWorker" (
  "id" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "version" TEXT,
  "status" TEXT NOT NULL,
  "currentJobId" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationWorker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationWorker_workerId_key" ON "AutomationWorker" ("workerId");

CREATE TABLE IF NOT EXISTS "ProfitDistribution" (
  "id" TEXT NOT NULL,
  "distributionAt" TIMESTAMP(3) NOT NULL,
  "status" "DistributionStatus" NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'LP',
  "chainId" INTEGER,
  "totalProfitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "txHash" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfitDistribution_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProfitDistribution_distributionAt_status_idx" ON "ProfitDistribution" ("distributionAt","status");

CREATE TABLE IF NOT EXISTS "ProfitDistributionItem" (
  "id" TEXT NOT NULL,
  "distributionId" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "amountUsd" DOUBLE PRECISION NOT NULL,
  "tokenAddress" TEXT,
  "amountToken" TEXT,
  "status" "DistributionItemStatus" NOT NULL DEFAULT 'CLAIMABLE',
  "paidTxHash" TEXT,
  "errorMessage" TEXT,
  "claimedAt" TIMESTAMP(3),
  "autoPayout" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfitDistributionItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProfitDistributionItem_distributionId_wallet_idx" ON "ProfitDistributionItem" ("distributionId","wallet");
CREATE INDEX IF NOT EXISTS "ProfitDistributionItem_wallet_status_createdAt_idx" ON "ProfitDistributionItem" ("wallet","status","createdAt");
DO $$ BEGIN
  ALTER TABLE "ProfitDistributionItem"
  ADD CONSTRAINT "ProfitDistributionItem_distributionId_fkey"
  FOREIGN KEY ("distributionId") REFERENCES "ProfitDistribution"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "DistributionWallet" (
  "id" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "payoutMode" "PayoutMode" NOT NULL DEFAULT 'CLAIM',
  "minPayoutUsd" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "destination" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DistributionWallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DistributionWallet_wallet_key" ON "DistributionWallet" ("wallet");

CREATE TABLE IF NOT EXISTS "PositionRevenuePolicy" (
  "id" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "ownerShareBps" INTEGER NOT NULL,
  "operatorShareBps" INTEGER NOT NULL,
  "platformShareBps" INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PositionRevenuePolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PositionRevenuePolicy_positionId_key" ON "PositionRevenuePolicy" ("positionId");
CREATE INDEX IF NOT EXISTS "PositionRevenuePolicy_active_effectiveFrom_idx" ON "PositionRevenuePolicy" ("active","effectiveFrom");
