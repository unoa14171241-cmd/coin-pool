-- AlterEnum
ALTER TYPE "AuditActorRole" ADD VALUE 'ADMIN';

-- CreateTable
CREATE TABLE "DailyDistributionTrigger" (
    "id" TEXT NOT NULL,
    "callerWallet" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyDistributionTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyDistributionTrigger_callerWallet_idempotencyKey_key" ON "DailyDistributionTrigger"("callerWallet", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DailyDistributionTrigger_callerWallet_createdAt_idx" ON "DailyDistributionTrigger"("callerWallet", "createdAt");
