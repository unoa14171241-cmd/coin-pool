# Daily Distribution Trigger P0/P1 実装サマリー

**実施日**: 2026年3月  
**目的**: 同一 targetDate の二重配当防止、実行結果の整合性を本番レベルにする

---

## 1. 修正概要

### P0-1: targetDate 単位の多重実行防止
- `DailyDistributionTrigger` に `targetDateStr` (YYYY-MM-DD) を追加
- `@@unique([targetDateStr])` により、同一 targetDate の trigger を 1 件のみ許可
- INSERT が unique violation となった場合、既存レコードを参照してキャッシュ返却または 409

### P0-2: createDailyProfitDistribution の競合防止
- `ProfitDistribution` に `ownerWallet` を追加
- 部分ユニークインデックス: `(ownerWallet, distributionAt) WHERE ownerWallet IS NOT NULL`
- `INSERT ... ON CONFLICT (ownerWallet, distributionAt) DO NOTHING` で idempotent に作成

### P1-4: trigger status の厳密化
- `COMPLETED_SUCCESS`: 全件成功
- `COMPLETED_PARTIAL`: 一部失敗あり
- `FAILED`: 全件失敗

### P1-5: 実行結果の可観測性
- `created`, `skipped`, `totalProfitUsd`, `targetDate`, `hasPartialFailure` を resultJson / 監査ログに記録
- キャッシュ返却時も上記を返却

### P1-3: 署名に body を含める
- **未実装**（auth フロー全体の変更が必要なため別タスクとする）

---

## 2. 変更ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| `prisma/schema.prisma` | ProfitDistribution に ownerWallet 追加、DailyDistributionTrigger に targetDateStr 追加、status に COMPLETED_SUCCESS/PARTIAL |
| `prisma/migrations/20260321000000_daily_distribution_p0_safety/migration.sql` | 新規マイグレーション |
| `services/daily-profit-engine.ts` | ownerWallet 追加、ON CONFLICT で upsert、skipped 戻り値 |
| `services/daily-distribution-scheduler.ts` | created/skipped 集計、totalProfitUsd、targetDate を戻り値に追加 |
| `routes/profit.ts` | targetDateStr を INSERT に追加、unique violation 時のキャッシュ/409、COMPLETED_SUCCESS/PARTIAL、resultPayload 拡張 |

---

## 3. Prisma schema / migration の変更点

### schema.prisma
```prisma
model ProfitDistribution {
  ownerWallet    String?   // 新規追加
  ...
  @@index([ownerWallet, distributionAt])
}

model DailyDistributionTrigger {
  targetDateStr  String   // 新規追加、@@unique([targetDateStr])
  status         String   // PENDING | COMPLETED_SUCCESS | COMPLETED_PARTIAL | FAILED
  ...
}
```

### migration
- `ProfitDistribution`: ownerWallet カラム追加、部分ユニークインデックス作成
- `DailyDistributionTrigger`: targetDateStr カラム追加、既存行の backfill、NOT NULL 制約、ユニークインデックス作成

---

## 4. 重要な実装コード

### createDailyProfitDistribution (競合防止)
```typescript
const inserted = await tx.$queryRaw`
  INSERT INTO "ProfitDistribution" (..., "ownerWallet", ...)
  VALUES (..., ${ownerWallet}, ...)
  ON CONFLICT ("ownerWallet", "distributionAt") DO NOTHING
  RETURNING "id"
`;
if (inserted.length === 0) {
  const existing = await tx.$queryRaw`SELECT ... WHERE ownerWallet = ? AND distributionAt = ?`;
  if (existing.length > 0) return { ...existing[0], skipped: true };
  throw new Error("race condition");
}
```

### profit route (targetDate ロック)
```typescript
try {
  inserted = await prisma.$queryRaw`
    INSERT INTO "DailyDistributionTrigger" (..., "targetDateStr", ...)
    VALUES (..., ${targetDateStr}, ...)
    RETURNING "id", "status"
  `;
} catch (insertErr) {
  if (uniqueViolation) {
    const byDate = await prisma.$queryRaw`SELECT ... WHERE targetDateStr = ?`;
    if (byDate[0].status in [COMPLETED_SUCCESS, COMPLETED_PARTIAL]) return cached;
    return 409;
  }
  throw insertErr;
}
```

---

## 5. race condition の防止方法

### 同一 targetDate を複数 admin が同時実行
- **DB 制約**: `@@unique([targetDateStr])` により、2 件目の INSERT は必ず失敗
- **処理**: キャッチした unique violation のあと、`targetDateStr` で既存レコードを検索し、COMPLETED ならキャッシュ返却、PENDING/FAILED なら 409

### 同一 wallet/date の配当生成を並列実行
- **DB 制約**: `(ownerWallet, distributionAt)` の部分ユニークインデックス
- **処理**: `INSERT ... ON CONFLICT DO NOTHING RETURNING` で、先に INSERT したトランザクションのみ成功。後から来たリクエストは 0 件 RETURNING → 既存レコードを SELECT して `skipped: true` で返却

### アプリの if チェックへの依存
- rate limit などの事前チェックは廃止（targetDate 単位の制約に一本化）
- INSERT による DB 制約で必ず守る設計に変更

---

## 6. テストケース

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| 同一 targetDate を別 admin が同時実行 | Admin A と Admin B が同じ targetDate で同時に INSERT | 片方のみ成功。もう片方は unique violation → targetDateStr で SELECT → COMPLETED ならキャッシュ、PENDING なら 409 |
| 同一 wallet/date の配当を並列実行 | 2 プロセスが同時に createDailyProfitDistribution(w, d) を呼ぶ | 片方の INSERT が成功し Items 作成。もう片方は ON CONFLICT で 0 件 RETURNING → existing を SELECT し skipped で返却 |
| 部分成功時の status | runDailyDistributionForDate で failed > 0 かつ processed > 0 | status = COMPLETED_PARTIAL、resultJson に hasPartialFailure: true |
| idempotent replay | 同一 (callerWallet, idempotencyKey) で 2 回 POST | 2 回目は INSERT で (callerWallet, idempotencyKey) unique violation → byKey で SELECT → キャッシュ返却 |

---

## 7. マイグレーション実行

```powershell
cd apps\api
npx prisma migrate deploy
```

本番投入前に必ず実行すること。
