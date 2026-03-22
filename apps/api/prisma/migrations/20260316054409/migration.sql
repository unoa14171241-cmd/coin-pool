/*
  Warnings:

  - Made the column `compoundCount` on table `Position` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "AutomationExecution" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AutomationJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AutomationPolicy" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AutomationWorker" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DistributionWallet" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Position" ALTER COLUMN "compoundCount" SET NOT NULL;

-- AlterTable
ALTER TABLE "PositionRevenuePolicy" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProfitClaimIdempotency" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProfitDistribution" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProfitDistributionItem" ALTER COLUMN "updatedAt" DROP DEFAULT;
