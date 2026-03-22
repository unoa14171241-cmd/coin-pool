-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('NEVER', 'SUCCESS', 'PARTIAL', 'ERROR');

-- AlterTable
ALTER TABLE "Position"
ADD COLUMN "syncStatus" "SyncStatus",
ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastSyncSuccessAt" TIMESTAMP(3),
ADD COLUMN "lastSyncError" TEXT;

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

-- CreateIndex
CREATE UNIQUE INDEX "OnchainPositionState_positionId_key" ON "OnchainPositionState"("positionId");

-- CreateIndex
CREATE INDEX "OnchainPositionState_chainId_updatedAt_idx" ON "OnchainPositionState"("chainId", "updatedAt");
