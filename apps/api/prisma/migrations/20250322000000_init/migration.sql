-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('IN_RANGE', 'OUT_OF_RANGE', 'CLOSED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('NEVER', 'SUCCESS', 'PARTIAL', 'ERROR');

-- CreateEnum
CREATE TYPE "AutomationJobType" AS ENUM ('EVALUATE', 'REBALANCE', 'COLLECT', 'COMPOUND', 'DISTRIBUTE');

-- CreateEnum
CREATE TYPE "AutomationJobStatus" AS ENUM ('QUEUED', 'LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('STARTED', 'PRECHECK_FAILED', 'TX_SUBMITTED', 'TX_CONFIRMED', 'VERIFY_FAILED', 'SNAPSHOT_UPDATED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DistributionStatus" AS ENUM ('DRAFT', 'CALCULATED', 'EXECUTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DistributionItemStatus" AS ENUM ('CLAIMABLE', 'EXECUTING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutMode" AS ENUM ('AUTO', 'CLAIM');

-- CreateEnum
CREATE TYPE "StrategyRangeMode" AS ENUM ('STATIC', 'DYNAMIC', 'VOLATILITY_BASED');

-- CreateEnum
CREATE TYPE "StrategyRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AutomationExecutionMode" AS ENUM ('MANUAL_APPROVAL', 'AUTO_EXECUTE');

-- CreateEnum
CREATE TYPE "CompoundScheduleMode" AS ENUM ('DAILY', 'WEEKLY', 'THRESHOLD');

-- CreateEnum
CREATE TYPE "AuditActorRole" AS ENUM ('OWNER', 'OPERATOR', 'SYSTEM', 'ADMIN');

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "chainName" TEXT NOT NULL,
    "poolAddress" TEXT NOT NULL,
    "token0Address" TEXT NOT NULL,
    "token1Address" TEXT NOT NULL,
    "token0Symbol" TEXT NOT NULL,
    "token1Symbol" TEXT NOT NULL,
    "feeTier" INTEGER NOT NULL,
    "tickLower" INTEGER NOT NULL,
    "tickUpper" INTEGER NOT NULL,
    "createdTx" TEXT NOT NULL,
    "collectTx" TEXT,
    "rebalanceTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PositionStatus" NOT NULL DEFAULT 'IN_RANGE',
    "syncStatus" "SyncStatus",
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncSuccessAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastCheck" TIMESTAMP(3),
    "logs" JSONB,
    "error" TEXT,
    "lastCompoundAt" TIMESTAMP(3),
    "totalCompoundedFees" DOUBLE PRECISION DEFAULT 0,
    "compoundCount" INTEGER DEFAULT 0,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "positionId" TEXT,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user-action',
    "tx" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentTick" INTEGER NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "token0Amount" DOUBLE PRECISION,
    "token1Amount" DOUBLE PRECISION,
    "estimatedValueUsd" DOUBLE PRECISION,
    "estimatedFeesUsd" DOUBLE PRECISION,
    "estimatedPnlUsd" DOUBLE PRECISION,
    "estimatedIlUsd" DOUBLE PRECISION,
    "estimatedApr" DOUBLE PRECISION,
    "staleFlag" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PositionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolMarketSnapshot" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolAddress" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentTick" INTEGER NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "liquidity" TEXT,
    "volumeProxy" DOUBLE PRECISION,
    "volatilityScore" DOUBLE PRECISION,

    CONSTRAINT "PoolMarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "telegram" TEXT,
    "discord" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnchainPositionState" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "owner" TEXT,
    "operator" TEXT,
    "token0" TEXT,
    "token1" TEXT,
    "fee" INTEGER,
    "tickLower" INTEGER,
    "tickUpper" INTEGER,
    "liquidity" TEXT,
    "tokensOwed0" TEXT,
    "tokensOwed1" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnchainPositionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletOperatorPermission" (
    "id" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "operatorWallet" TEXT NOT NULL,
    "canEvaluate" BOOLEAN NOT NULL DEFAULT true,
    "canExecute" BOOLEAN NOT NULL DEFAULT false,
    "canPause" BOOLEAN NOT NULL DEFAULT false,
    "canChangeStrategy" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletOperatorPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingSnapshotWrite" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolAddress" TEXT NOT NULL,
    "currentTick" INTEGER NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "liquidity" TEXT,
    "volatilityScore" DOUBLE PRECISION,
    "volumeProxy" DOUBLE PRECISION,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PendingSnapshotWrite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationPolicy" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationJob" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationWorker" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "version" TEXT,
    "status" TEXT NOT NULL,
    "currentJobId" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationDaemonTick" (
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

-- CreateTable
CREATE TABLE "ProfitDistribution" (
    "id" TEXT NOT NULL,
    "ownerWallet" TEXT,
    "distributionAt" TIMESTAMP(3) NOT NULL,
    "status" "DistributionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'LP',
    "chainId" INTEGER,
    "totalProfitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitDistributionItem" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitDistributionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitClaimIdempotency" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "distributionItemId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paidTxHash" TEXT,
    "claimedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitClaimIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDistributionTrigger" (
    "id" TEXT NOT NULL,
    "callerWallet" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "targetDateStr" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyDistributionTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionWallet" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payoutMode" "PayoutMode" NOT NULL DEFAULT 'CLAIM',
    "minPayoutUsd" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "destination" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistributionWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionRevenuePolicy" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "ownerShareBps" INTEGER NOT NULL,
    "operatorShareBps" INTEGER NOT NULL,
    "platformShareBps" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionRevenuePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyTemplate" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetChain" INTEGER NOT NULL,
    "dexProtocol" TEXT NOT NULL,
    "tokenA" TEXT NOT NULL,
    "tokenB" TEXT NOT NULL,
    "poolFeeTier" INTEGER NOT NULL,
    "rangeMode" "StrategyRangeMode" NOT NULL,
    "rebalanceRule" JSONB NOT NULL,
    "compoundRule" JSONB NOT NULL,
    "riskLevel" "StrategyRiskLevel" NOT NULL,
    "targetAPRNote" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recommendedMinCapital" DOUBLE PRECISION,
    "gasCostWarning" TEXT,
    "operatorFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ownerProfitShareRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdByWallet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "changeSummary" TEXT,
    "createdByWallet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationSetting" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "positionId" TEXT,
    "chainId" INTEGER NOT NULL,
    "strategyTemplateId" TEXT,
    "executionMode" "AutomationExecutionMode" NOT NULL DEFAULT 'MANUAL_APPROVAL',
    "autoRebalanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoCompoundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "compoundSchedule" "CompoundScheduleMode" NOT NULL DEFAULT 'THRESHOLD',
    "minCompoundUsd" DOUBLE PRECISION,
    "maxGasUsd" DOUBLE PRECISION,
    "emergencyPaused" BOOLEAN NOT NULL DEFAULT false,
    "updatedByWallet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogV2" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "actorWallet" TEXT NOT NULL,
    "actorRole" "AuditActorRole" NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "reasonCode" TEXT,
    "reasonText" TEXT,
    "txHash" TEXT,
    "chainId" INTEGER,
    "payloadJson" JSONB,
    "payloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogV2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_positionId_key" ON "Position"("positionId");

-- CreateIndex
CREATE INDEX "Position_wallet_chainId_idx" ON "Position"("wallet", "chainId");

-- CreateIndex
CREATE INDEX "Position_wallet_createdAt_idx" ON "Position"("wallet", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_wallet_createdAt_idx" ON "ActivityLog"("wallet", "createdAt");

-- CreateIndex
CREATE INDEX "PositionSnapshot_positionId_snapshotAt_idx" ON "PositionSnapshot"("positionId", "snapshotAt");

-- CreateIndex
CREATE INDEX "PositionSnapshot_chainId_snapshotAt_idx" ON "PositionSnapshot"("chainId", "snapshotAt");

-- CreateIndex
CREATE INDEX "PoolMarketSnapshot_chainId_poolAddress_snapshotAt_idx" ON "PoolMarketSnapshot"("chainId", "poolAddress", "snapshotAt");

-- CreateIndex
CREATE INDEX "PoolMarketSnapshot_chainId_snapshotAt_idx" ON "PoolMarketSnapshot"("chainId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_wallet_key" ON "NotificationSetting"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "OnchainPositionState_positionId_key" ON "OnchainPositionState"("positionId");

-- CreateIndex
CREATE INDEX "OnchainPositionState_chainId_updatedAt_idx" ON "OnchainPositionState"("chainId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletOperatorPermission_ownerWallet_operatorWallet_key" ON "WalletOperatorPermission"("ownerWallet", "operatorWallet");

-- CreateIndex
CREATE INDEX "WalletOperatorPermission_ownerWallet_active_idx" ON "WalletOperatorPermission"("ownerWallet", "active");

-- CreateIndex
CREATE INDEX "WalletOperatorPermission_operatorWallet_active_idx" ON "WalletOperatorPermission"("operatorWallet", "active");

-- CreateIndex
CREATE INDEX "PendingSnapshotWrite_createdAt_idx" ON "PendingSnapshotWrite"("createdAt");

-- CreateIndex
CREATE INDEX "PendingSnapshotWrite_chainId_poolAddress_createdAt_idx" ON "PendingSnapshotWrite"("chainId", "poolAddress", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationPolicy_wallet_positionId_idx" ON "AutomationPolicy"("wallet", "positionId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationPolicy_wallet_positionId_key" ON "AutomationPolicy"("wallet", "positionId");

-- CreateIndex
CREATE INDEX "AutomationJob_status_scheduledAt_priority_idx" ON "AutomationJob"("status", "scheduledAt", "priority");

-- CreateIndex
CREATE INDEX "AutomationJob_wallet_createdAt_idx" ON "AutomationJob"("wallet", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationJob_idempotencyKey_key" ON "AutomationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationExecution_jobId_startedAt_idx" ON "AutomationExecution"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_wallet_startedAt_idx" ON "AutomationExecution"("wallet", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_type_status_startedAt_idx" ON "AutomationExecution"("type", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationWorker_workerId_key" ON "AutomationWorker"("workerId");

-- CreateIndex
CREATE INDEX "AutomationDaemonTick_at_idx" ON "AutomationDaemonTick"("at");

-- CreateIndex
CREATE INDEX "AutomationDaemonTick_workerId_at_idx" ON "AutomationDaemonTick"("workerId", "at");

-- CreateIndex
CREATE INDEX "ProfitDistribution_distributionAt_status_idx" ON "ProfitDistribution"("distributionAt", "status");

-- CreateIndex
CREATE INDEX "ProfitDistribution_ownerWallet_distributionAt_idx" ON "ProfitDistribution"("ownerWallet", "distributionAt");

-- CreateIndex
CREATE INDEX "ProfitDistributionItem_distributionId_wallet_idx" ON "ProfitDistributionItem"("distributionId", "wallet");

-- CreateIndex
CREATE INDEX "ProfitDistributionItem_wallet_status_createdAt_idx" ON "ProfitDistributionItem"("wallet", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitClaimIdempotency_wallet_idempotencyKey_key" ON "ProfitClaimIdempotency"("wallet", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProfitClaimIdempotency_distributionItemId_updatedAt_idx" ON "ProfitClaimIdempotency"("distributionItemId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDistributionTrigger_callerWallet_idempotencyKey_key" ON "DailyDistributionTrigger"("callerWallet", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDistributionTrigger_targetDateStr_key" ON "DailyDistributionTrigger"("targetDateStr");

-- CreateIndex
CREATE INDEX "DailyDistributionTrigger_callerWallet_createdAt_idx" ON "DailyDistributionTrigger"("callerWallet", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DistributionWallet_wallet_key" ON "DistributionWallet"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "PositionRevenuePolicy_positionId_key" ON "PositionRevenuePolicy"("positionId");

-- CreateIndex
CREATE INDEX "PositionRevenuePolicy_active_effectiveFrom_idx" ON "PositionRevenuePolicy"("active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyTemplate_strategyId_key" ON "StrategyTemplate"("strategyId");

-- CreateIndex
CREATE INDEX "StrategyTemplate_enabled_targetChain_dexProtocol_idx" ON "StrategyTemplate"("enabled", "targetChain", "dexProtocol");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyTemplateVersion_templateId_version_key" ON "StrategyTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "StrategyTemplateVersion_createdAt_idx" ON "StrategyTemplateVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationSetting_wallet_positionId_chainId_key" ON "AutomationSetting"("wallet", "positionId", "chainId");

-- CreateIndex
CREATE INDEX "AutomationSetting_wallet_chainId_idx" ON "AutomationSetting"("wallet", "chainId");

-- CreateIndex
CREATE INDEX "AuditLogV2_actorWallet_createdAt_idx" ON "AuditLogV2"("actorWallet", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLogV2_action_createdAt_idx" ON "AuditLogV2"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLogV2_resourceType_resourceId_createdAt_idx" ON "AuditLogV2"("resourceType", "resourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AutomationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitDistributionItem" ADD CONSTRAINT "ProfitDistributionItem_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "ProfitDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyTemplateVersion" ADD CONSTRAINT "StrategyTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "StrategyTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationSetting" ADD CONSTRAINT "AutomationSetting_strategyTemplateId_fkey" FOREIGN KEY ("strategyTemplateId") REFERENCES "StrategyTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
