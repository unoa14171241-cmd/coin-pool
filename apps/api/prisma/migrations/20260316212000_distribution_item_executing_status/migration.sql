DO $$
BEGIN
  ALTER TYPE "DistributionItemStatus" ADD VALUE IF NOT EXISTS 'EXECUTING';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
