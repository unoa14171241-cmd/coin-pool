CREATE TABLE IF NOT EXISTS "ProfitClaimIdempotency" (
  "id" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "distributionItemId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "paidTxHash" TEXT,
  "claimedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfitClaimIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfitClaimIdempotency_wallet_idempotencyKey_key"
  ON "ProfitClaimIdempotency" ("wallet","idempotencyKey");
CREATE INDEX IF NOT EXISTS "ProfitClaimIdempotency_distributionItemId_updatedAt_idx"
  ON "ProfitClaimIdempotency" ("distributionItemId","updatedAt");
