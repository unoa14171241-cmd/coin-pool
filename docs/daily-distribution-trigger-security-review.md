# Daily Distribution Trigger 認証まわり 追加安全確認レポート

**確認日**: 2026年3月  
**対象**: POST /profit/daily-distribution/trigger 実装

---

## 1. requireWalletSignature の強度

| 項目 | 判定 | 根拠 | 想定事故 | 修正案 |
|------|------|------|----------|--------|
| nonce を含むか | **問題なし** | `auth/middleware.ts` L22-23, `challenge-store.ts` L33-34: メッセージに `Nonce:${challenge.nonce}` を含む。24バイト乱数。 | - | - |
| timestamp / expiration を含むか | **問題なし** | `challenge-store.ts` L36-37: `issuedAt`, `expiresAt`。`isChallengeValid` で `Date.now() > record.expiresAt` をチェック。`CHALLENGE_TTL_MS` デフォルト5分。 | - | - |
| chainId を含むか | **問題なし** | `auth/middleware.ts` L27, L63-70: `ChainId:` をメッセージに含み、body/header と一致確認。 | - | - |
| endpoint固有の purpose を含むか | **問題なし** | `auth/middleware.ts` L53-56: `parsed.action === expectedAction`。`expectedAction = POST /profit/daily-distribution/trigger`。クライアントは `GET /auth/challenge/:wallet?action=POST%20/profit/daily-distribution/trigger` で challenge 取得。 | - | - |
| 署名リプレイ耐性 | **問題なし** | `challenge-store.ts` L56-69: `consumeChallenge` で nonce を削除。1回消費で無効化。同一メッセージの再利用不可。 | - | - |
| **body の署名** | **要注意** | メッセージに `date`, `idempotencyKey` 等の body は含まれない。 | MITM で body が改ざんされ、意図しない targetDate で配当が実行される可能性。 | body の重要フィールド（date, idempotencyKey）をメッセージに含めて署名する設計を検討。現状、実行者は保証され、日付改ざんは限定的な影響。 |

---

## 2. 二重実行防止の十分性

| 項目 | 判定 | 根拠 | 想定事故 | 修正案 |
|------|------|------|----------|--------|
| distribution date 単位の多重防止 | **危険** | `profit.ts` L240-253: rate limit は **callerWallet 単位**のみ。`(targetDate)` のグローバルロックなし。複数 admin が同一 date を別 idempotencyKey で叩ける。 | 同日に複数 admin からトリガーされ、並列で `runDailyDistributionForDate` が実行される。 | `(targetDate)` をキーにしたロックまたは DB ユニーク制約を導入。同一 targetDate の同時実行を禁止。 |
| 複数 admin 同日別 key での重複実行 | **危険** | 上記に同じ。Admin A が key1 で 2024-01-15、Admin B が key2 で 2024-01-15 → 両方通過。 | 下記の競合で二重配当レコード作成、二重 claim のリスク。 | 同上。 |
| runDailyDistributionForDate 内の競合 | **危険** | `daily-distribution-scheduler.ts` L79-91: `existing` チェック後に `createDailyProfitDistribution` を呼ぶ。SELECT→INSERT の間に別プロセスが割り込める。DB に `(wallet, distributionAt)` のユニーク制約なし。 | 同一 wallet+date で並列実行され、両方が「既存なし」と判断して両方 create。同一 beneficiary に複数 CLAIMABLE Item が作成され、二重 claim で二重送金。 | `ProfitDistribution` / `ProfitDistributionItem` に wallet+date のユニーク制約を追加するか、`SELECT ... FOR UPDATE` 等で直列化。または `createDailyProfitDistribution` を upsert（ON CONFLICT）で実装。 |
| PENDING→COMPLETED の race | **問題なし** | `profit.ts` L328-343: 単一プロセス内で try→UPDATE→return。別リクエストは `(callerWallet, idempotencyKey)` の INSERT でブロックされ、409 またはキャッシュ返却。 | - | - |

---

## 3. 実行結果の整合性

| 項目 | 判定 | 根拠 | 想定事故 | 修正案 |
|------|------|------|----------|--------|
| COMPLETED の定義 | **要注意** | `profit.ts` L331-336: `runDailyDistributionForDate` が throw しなければ即 COMPLETED。`failed > 0` でも COMPLETED。 | 一部 wallet のみ失敗（failed > 0）でも COMPLETED 扱い。運用上は「実行完了」だが、全件成功と誤解しやすい。 | `resultPayload` に `hasFailures: failed > 0` を追加。レスポンス・監査ログで failed を明示。 |
| 部分成功を COMPLETED にしていないか | **要注意** | `runDailyDistributionForDate` は processed/failed を返す。exception 時のみ FAILED。部分成功（failed > 0）も COMPLETED。 | 上記と同様。厳密には「全件成功」のみ COMPLETED にする設計もあるが、現状は「実行が完了した」＝COMPLETED。 | 仕様として「実行完了＝COMPLETED」をドキュメント化。必要なら `FULL_SUCCESS` / `PARTIAL_SUCCESS` を分離。 |
| DB 更新失敗時の不整合 | **要注意** | `profit.ts` L337-343: `prisma.$executeRaw` (UPDATE) が throw すると catch に入り、`status = FAILED` に更新。ただし `runDailyDistributionForDate` は既に実行済み（ProfitDistribution/Item は作成済み）。 | UPDATE が失敗した場合、実際には配当は作成済みなのに trigger レコードは FAILED。再実行時に rate limit が別日なら再度実行され、既存スキップで processed のみ増える。キャッシュと実態の不整合。 | UPDATE をトランザクションで囲むか、`runDailyDistributionForDate` と UPDATE の順序・エラーハンドリングを整理。 |
| キャッシュ結果の十分性 | **要注意** | `profit.ts` L333-336, L272-278: `resultJson` に `processed`, `failed`, `errors` のみ。 | `targetDate`, `elapsedMs`, `cached` は返る。`totalDistributedUsd`, `skipped` は `runDailyDistributionForDate` が返していないため欠落。 | `runDailyDistributionForDate` の戻り値に `totalProfitUsd` 等を追加し、resultJson に含める。 |

---

## 4. 可観測性

| 項目 | 判定 | 根拠 | 想定事故 | 修正案 |
|------|------|------|----------|--------|
| actorWallet | **問題なし** | `writeAuditLogV2` に `actorWallet` を渡す。`AuditLogV2` に保存。 | - | - |
| target date | **問題なし** | `payloadJson.targetDate` に `targetDate.toISOString().slice(0,10)` を記録。 | - | - |
| success count | **問題なし** | `processed` がそれに相当。payloadJson に含む。 | - | - |
| failed count | **問題なし** | `failed` を payloadJson に含む。 | - | - |
| skipped count | **要注意** | `runDailyDistributionForDate` は「既存でスキップ」を `processed` に含める。skipped を分離していない。 | 実際に新規作成した件数とスキップ件数の区別がつかない。 | `processed` を `created` と `skipped` に分離する。 |
| total distributed amount | **要注意** | `createDailyProfitDistribution` は `totalProfitUsd` を返すが、`runDailyDistributionForDate` は集計して返していない。 | 監査・レポーティングで総配当額を追跡できない。 | `runDailyDistributionForDate` の戻り値に `totalProfitUsd` を追加し、監査・resultJson に含める。 |
| tx hash | **問題なし** | このエンドポイントは **DB のみ**。オンチェーン tx は claim フローで発生。trigger 時点では txHash なし。 | - | trigger 自体は DB レコード作成のみ。claim 時の txHash は別テーブル (ProfitDistributionItem.paidTxHash 等) で管理。 |

---

## 5. まとめ

### 即時対応推奨（危険）

1. **targetDate 単位の二重実行防止**  
   同一 targetDate に対する並列実行を禁止するロックまたは DB 制約を導入。

2. **createDailyProfitDistribution の競合対策**  
   `(wallet, distributionAt)` のユニーク制約、または `FOR UPDATE` / upsert による直列化。

### 改善推奨（要注意）

3. **body の署名** … date, idempotencyKey を署名メッセージに含める検討。  
4. **COMPLETED の意味の明示** … 部分成功時の扱いをドキュメント化。  
5. **resultJson / 監査の拡張** … totalProfitUsd, skipped を含める。  
6. **DB 更新失敗時の扱い** … トランザクション境界とエラーハンドリングの整理。

### 現状で問題なし

- requireWalletSignature の nonce, timestamp, chainId, action, リプレイ耐性  
- PENDING→COMPLETED の race（単一 idempotencyKey 内）  
- actorWallet, targetDate, processed, failed の監査記録
