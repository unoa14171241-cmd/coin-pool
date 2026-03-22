-- Add ownerWallet to ProfitDistribution for (ownerWallet, distributionAt) uniqueness
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProfitDistribution' AND column_name = 'ownerWallet') THEN
    ALTER TABLE "ProfitDistribution" ADD COLUMN "ownerWallet" TEXT;
  END IF; END $$;

-- Partial unique: one distribution per (ownerWallet, distributionAt) when ownerWallet is set
CREATE UNIQUE INDEX IF NOT EXISTS "ProfitDistribution_ownerWallet_distributionAt_key"
  ON "ProfitDistribution" ("ownerWallet", "distributionAt")
  WHERE "ownerWallet" IS NOT NULL;

-- Add targetDateStr to DailyDistributionTrigger for date-level mutual exclusion
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'DailyDistributionTrigger' AND column_name = 'targetDateStr') THEN
    ALTER TABLE "DailyDistributionTrigger" ADD COLUMN "targetDateStr" TEXT;
  END IF; END $$;

-- Backfill targetDateStr from targetDate for existing rows
UPDATE "DailyDistributionTrigger"
SET "targetDateStr" = TO_CHAR("targetDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE "targetDateStr" IS NULL;

-- Ensure no nulls before NOT NULL (empty table or backfilled)
UPDATE "DailyDistributionTrigger"
SET "targetDateStr" = COALESCE("targetDateStr", TO_CHAR("targetDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
WHERE "targetDateStr" IS NULL;

ALTER TABLE "DailyDistributionTrigger" ALTER COLUMN "targetDateStr" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "DailyDistributionTrigger_targetDateStr_key"
  ON "DailyDistributionTrigger" ("targetDateStr");
