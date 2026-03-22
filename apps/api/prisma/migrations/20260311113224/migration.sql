-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('IN_RANGE', 'OUT_OF_RANGE', 'CLOSED');

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
    "lastCheck" TIMESTAMP(3),
    "logs" JSONB,
    "error" TEXT,

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
