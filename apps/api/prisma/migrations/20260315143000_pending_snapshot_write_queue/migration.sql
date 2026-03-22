CREATE TABLE IF NOT EXISTS "PendingSnapshotWrite" (
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

CREATE INDEX IF NOT EXISTS "PendingSnapshotWrite_createdAt_idx" ON "PendingSnapshotWrite"("createdAt");
CREATE INDEX IF NOT EXISTS "PendingSnapshotWrite_chainId_poolAddress_createdAt_idx"
  ON "PendingSnapshotWrite"("chainId", "poolAddress", "createdAt");
