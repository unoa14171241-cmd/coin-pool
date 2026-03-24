# Automation Prisma / API Draft

本ドキュメントは、現行 `Coin Pool` をフル自動運用へ拡張するための**実装用草案**です。  
既存モデル（`Position`/`OnchainPositionState`/`ActivityLog` など）を前提に、追加モデルと API 契約を定義します。

---

## 1. Prisma スキーマ草案

```prisma
enum AutomationJobType {
  EVALUATE
  REBALANCE
  COLLECT
  COMPOUND
  DISTRIBUTE
}

enum AutomationJobStatus {
  QUEUED
  LEASED
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
  DEAD_LETTER
}

enum AutomationExecutionStatus {
  STARTED
  PRECHECK_FAILED
  TX_SUBMITTED
  TX_CONFIRMED
  VERIFY_FAILED
  SNAPSHOT_UPDATED
  COMPLETED
  FAILED
}

enum DistributionStatus {
  DRAFT
  CALCULATED
  EXECUTING
  COMPLETED
  FAILED
}

enum DistributionItemStatus {
  CLAIMABLE
  PAID
  FAILED
}

enum PayoutMode {
  AUTO
  CLAIM
}

model AutomationPolicy {
  id                   String   @id @default(cuid())
  wallet               String
  positionId           String?
  enabled              Boolean  @default(true)
  mode                 String   @default("BALANCED")
  minNetBenefitUsd     Float    @default(0)
  maxGasUsd            Float    @default(20)
  maxSlippageBps       Int      @default(100)
  cooldownMinutes      Int      @default(60)
  staleSnapshotReject  Boolean  @default(true)
  autoCollectEnabled   Boolean  @default(true)
  autoCompoundEnabled  Boolean  @default(false)
  autoRebalanceEnabled Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([wallet, positionId])
  @@unique([wallet, positionId])
}

model AutomationJob {
  id             String              @id @default(cuid())
  wallet         String
  positionId     String?
  chainId        Int?
  type           AutomationJobType
  status         AutomationJobStatus @default(QUEUED)
  priority       Int                 @default(100)
  scheduledAt    DateTime            @default(now())
  leaseUntil     DateTime?
  attempt        Int                 @default(0)
  maxAttempts    Int                 @default(5)
  idempotencyKey String              @unique
  payload        Json?
  lastError      String?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  executions AutomationExecution[]

  @@index([status, scheduledAt, priority])
  @@index([wallet, createdAt])
}

model AutomationExecution {
  id                String                    @id @default(cuid())
  jobId             String
  wallet            String
  positionId        String?
  chainId           Int?
  type              AutomationJobType
  status            AutomationExecutionStatus
  startedAt         DateTime                  @default(now())
  finishedAt        DateTime?
  txHash            String?
  txStatus          String?
  gasUsed           String?
  effectiveGasPrice String?
  costUsd           Float?
  profitUsd         Float?
  netProfitUsd      Float?
  errorCode         String?
  errorMessage      String?
  context           Json?
  createdAt         DateTime                  @default(now())
  updatedAt         DateTime                  @updatedAt

  job AutomationJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId, startedAt])
  @@index([wallet, startedAt])
  @@index([type, status, startedAt])
}

model AutomationWorker {
  id              String   @id @default(cuid())
  workerId        String   @unique
  version         String?
  status          String
  currentJobId    String?
  lastHeartbeatAt DateTime
  meta            Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ProfitDistribution {
  id             String             @id @default(cuid())
  distributionAt DateTime
  status         DistributionStatus @default(DRAFT)
  source         String             @default("LP")
  chainId        Int?
  totalProfitUsd Float              @default(0)
  txHash         String?
  errorMessage   String?
  createdAt      DateTime           @default(now())
  executedAt     DateTime?
  updatedAt      DateTime           @updatedAt

  items ProfitDistributionItem[]

  @@index([distributionAt, status])
}

model ProfitDistributionItem {
  id               String                 @id @default(cuid())
  distributionId   String
  wallet           String
  amountUsd        Float
  tokenAddress     String?
  amountToken      String?
  status           DistributionItemStatus @default(CLAIMABLE)
  paidTxHash       String?
  errorMessage     String?
  claimedAt        DateTime?
  autoPayout       Boolean                @default(false)
  createdAt        DateTime               @default(now())
  updatedAt        DateTime               @updatedAt

  distribution ProfitDistribution @relation(fields: [distributionId], references: [id], onDelete: Cascade)

  @@index([distributionId, wallet])
  @@index([wallet, status, createdAt])
}

model DistributionWallet {
  id           String   @id @default(cuid())
  wallet       String   @unique
  enabled      Boolean  @default(true)
  payoutMode   PayoutMode @default(CLAIM)
  minPayoutUsd Float    @default(10)
  destination  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model PositionRevenuePolicy {
  id               String   @id @default(cuid())
  positionId       String   @unique
  ownerShareBps    Int
  operatorShareBps Int
  platformShareBps Int
  effectiveFrom    DateTime @default(now())
  active           Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([active, effectiveFrom])
}
```

### 既存 `Position` への追加

```prisma
lastCompoundAt      DateTime?
totalCompoundedFees Float?    @default(0)
compoundCount       Int       @default(0)
```

---

## 2. API 契約草案

## `POST /automation/execute`

目的: 手動トリガーで execution job を enqueue

Request:
```json
{
  "wallet": "0x...",
  "positionId": "12345",
  "type": "REBALANCE",
  "chainId": 42161,
  "force": false,
  "idempotencyKey": "optional-client-key"
}
```

Response `200`:
```json
{
  "ok": true,
  "jobId": "cuid",
  "idempotencyKey": "server-generated-or-client",
  "status": "QUEUED"
}
```

Errors:
- `400` invalid input
- `401/403` signature / owner-operator permission
- `409` duplicate idempotency

---

## `GET /automation/executions`

目的: 実行履歴のページング取得

Query:
- `wallet`
- `positionId?`
- `type?`
- `status?`
- `cursor?`
- `limit?` (default 50, max 200)

Response:
```json
{
  "items": [
    {
      "executionId": "cuid",
      "jobId": "cuid",
      "wallet": "0x...",
      "positionId": "12345",
      "type": "REBALANCE",
      "status": "COMPLETED",
      "txHash": "0x...",
      "costUsd": 4.12,
      "profitUsd": 19.85,
      "netProfitUsd": 15.73,
      "startedAt": "2026-03-15T00:00:00.000Z",
      "finishedAt": "2026-03-15T00:01:05.000Z"
    }
  ],
  "nextCursor": "optional"
}
```

---

## `GET /profit/distributions`

目的: 日次配賦ヘッダ + item サマリを確認

Query:
- `wallet?`
- `status?`
- `from?` `to?`
- `cursor?`
- `limit?`

Response:
```json
{
  "items": [
    {
      "distributionId": "cuid",
      "distributionAt": "2026-03-15T00:00:00.000Z",
      "status": "COMPLETED",
      "totalProfitUsd": 1234.56,
      "source": "LP",
      "txHash": "0x...",
      "walletItems": [
        {
          "wallet": "0x...",
          "amountUsd": 42.5,
          "status": "CLAIMABLE",
          "paidTxHash": null
        }
      ]
    }
  ],
  "nextCursor": null
}
```

---

## `POST /profit/claim`

目的: claimable distribution item を請求

Request:
```json
{
  "wallet": "0x...",
  "distributionItemId": "cuid"
}
```

Response:
```json
{
  "ok": true,
  "distributionItemId": "cuid",
  "status": "PAID",
  "txHash": "0x..."
}
```

---

## 3. Worker 実行ステップ（厳密）

1. `EVALUATE` job 取得  
2. `risk-engine` + `gas-policy` + `automation-policy` precheck  
3. 実行 job (`REBALANCE/COLLECT/COMPOUND`) enqueue  
4. 実行時は `idempotencyKey` 検証  
5. tx submit -> receipt verify  
6. `OnchainPositionState` / `PositionSnapshot` 更新  
7. `ActivityLog` + `AutomationExecution` 完了記録  
8. 失敗時 retry or dead-letter

---

## 4. 重要制約（実装時）

- on-chain state を最終 truth とする
- DB 更新は `job + execution + snapshot` の単位で transaction
- worker crash 復旧は `leaseUntil` 超過で再取得
- idempotency は `wallet + positionId + type + window` で一意
- 署名認証 + owner/operator (`canExecute`) を execute 系 endpoint で強制
