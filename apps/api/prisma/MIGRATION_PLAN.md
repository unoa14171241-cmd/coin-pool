# Position Table Migration Plan

> **注**: 現行 schema は既に `chainId` / `chainName` / `poolAddress` / `token0Address` / `token1Address` / `token0Symbol` / `token1Symbol` を採用済みです。以下は参考用に残しています。

Current schema has ambiguous fields (`chain`, `pool`, `token0`, `token1`) that mix display and canonical values.
This plan migrates to explicit chain/token/address columns.

## Target columns

- `chainId` (Int)
- `chainName` (String, display only)
- `poolAddress` (String)
- `token0Address` (String)
- `token1Address` (String)
- `token0Symbol` (String)
- `token1Symbol` (String)

## Recommended migration steps

1. Add new nullable columns first.
2. Backfill rows:
   - map `chain` -> `chainId` + `chainName`
   - map `token0/token1` to symbol + address by chain mapping
   - map `pool` to `poolAddress` (fallback to zero address if unavailable)
3. Validate all rows are populated.
4. Make new columns non-null.
5. Switch application code to read/write new columns.
6. Drop legacy columns: `chain`, `pool`, `token0`, `token1`.

## Example SQL sketch (PostgreSQL)

```sql
ALTER TABLE "Position"
  ADD COLUMN "chainId" INT,
  ADD COLUMN "chainName" TEXT,
  ADD COLUMN "poolAddress" TEXT,
  ADD COLUMN "token0Address" TEXT,
  ADD COLUMN "token1Address" TEXT,
  ADD COLUMN "token0Symbol" TEXT,
  ADD COLUMN "token1Symbol" TEXT;

-- Backfill logic should be implemented with CASE statements per chain/symbol mapping.

-- After validation:
ALTER TABLE "Position"
  ALTER COLUMN "chainId" SET NOT NULL,
  ALTER COLUMN "chainName" SET NOT NULL,
  ALTER COLUMN "poolAddress" SET NOT NULL,
  ALTER COLUMN "token0Address" SET NOT NULL,
  ALTER COLUMN "token1Address" SET NOT NULL,
  ALTER COLUMN "token0Symbol" SET NOT NULL,
  ALTER COLUMN "token1Symbol" SET NOT NULL;

CREATE INDEX "Position_wallet_chainId_idx" ON "Position" ("wallet", "chainId");
```

Note: final destructive drop of legacy columns should be done only after a full backup and rollback plan.
