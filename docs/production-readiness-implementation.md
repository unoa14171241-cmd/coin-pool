# CoinPool 実運用対応 実装サマリー

## 1. 修正概要

監査レポート（`docs/coinpool-gap-audit-report.md`）に基づき、以下を実装しました。

| 優先度 | 項目 | 状態 |
|--------|------|------|
| P0-1 | 毎日USDC自動配当スケジューラ | ✅ 実装済み |
| P0-2 | PLATFORM_WALLET 環境変数化 | ✅ 実装済み |
| P0-3 | Ethereum Mainnet 手動制御 | ✅ 実装済み（既存） |
| P1-4 | 最低利用条件 $500 強制チェック | ✅ 実装済み（既存） |
| P1-5 | トランザクションに deadline 追加 | ✅ フロント済み / バックエンドは定数追加 |
| P2-6 | 50:50 再調整ロジック明示化 | ✅ 実装済み（既存 rebalance-ratio-utils） |

---

## 2. 変更ファイル一覧

| パス | 変更内容 |
|------|----------|
| `apps/api/src/services/daily-distribution-scheduler.ts` | **新規** 日次配当スケジューラ |
| `apps/api/src/config/env.ts` | DAILY_DISTRIBUTION_SCHEDULER_HOUR_UTC, DAILY_DISTRIBUTION_SCHEDULER_MINUTE_UTC 追加 |
| `apps/api/src/services/daily-profit-engine.ts` | env.PLATFORM_WALLET 使用（既存） |
| `apps/api/src/index.ts` | スケジューラ起動・停止・health に状態追加 |
| `apps/api/src/routes/automation.ts` | daily-distribution/tick-now エンドポイント、config に scheduler 状態追加 |
| `apps/api/src/services/strategy/tx-request-builders.ts` | RECOMMENDED_DEADLINE_SECONDS 定数追加 |
| `.env.example` | PLATFORM_WALLET, DAILY_DISTRIBUTION_SCHEDULER_*, MIN_POSITION_VALUE_USD 追加 |

---

## 3. 実装コード（重要部分）

### 3-1. 日次配当スケジューラ

- **起動**: `startDailyDistributionScheduler()` が API 起動時に呼ばれる
- **実行**: 設定時刻（UTC）に `runDailyDistributionTick()` を実行
- **二重実行防止**: 同一 wallet+date で既に ProfitDistributionItem があればスキップ
- **リトライ**: 最大 3 回
- **監査ログ**: `daily_distribution_created`, `daily_distribution_failed`, `daily_distribution_tick_failed`

### 3-2. 手動トリガー

```http
POST /automation/daily-distribution/tick-now
Authorization: x-wallet-signature 等
```

### 3-3. 環境変数

```env
# 必須（未設定時は起動エラー）
PLATFORM_WALLET=0x000000000000000000000000000000000000dEaD

# 日次配当スケジューラ
DAILY_DISTRIBUTION_SCHEDULER_ENABLED=false
DAILY_DISTRIBUTION_SCHEDULER_HOUR_UTC=0
DAILY_DISTRIBUTION_SCHEDULER_MINUTE_UTC=0

# 最低ポジション価値（USD）
MIN_POSITION_VALUE_USD=500

# Mainnet 自動実行無効（デフォルト true）
MAINNET_AUTO_EXECUTION_DISABLED=true
```

---

## 4. テスト方法

### ローカル検証

1. **環境変数**
   ```bash
   cp .env.example .env
   # PLATFORM_WALLET を設定（必須）
   # DAILY_DISTRIBUTION_SCHEDULER_ENABLED=true で有効化
   ```

2. **手動トリガー**
   ```bash
   # ウォレット署名付きで POST
   curl -X POST http://localhost:4000/automation/daily-distribution/tick-now \
     -H "x-wallet-address: 0x..." \
     -H "x-wallet-signature: ..." \
     -H "x-wallet-message-b64: ..."
   ```

3. **状態確認**
   ```bash
   curl http://localhost:4000/health
   # dailyDistributionScheduler の状態を確認
   ```

### 想定ケース

- ポジション・スナップショットがあるウォレットのみ配当対象
- 既に配当済みの wallet+date はスキップ
- 失敗時は監査ログに記録され、最大 3 回リトライ

---

## 5. リスクと注意点

1. **PLATFORM_WALLET**: 未設定時は起動エラー。本番では必ず正しいアドレスを設定すること。
2. **日次スケジューラ**: `DAILY_DISTRIBUTION_SCHEDULER_ENABLED=true` 時のみ動作。デフォルトは `false`。
3. **Mainnet**: `MAINNET_AUTO_EXECUTION_DISABLED=true` 時、REBALANCE/COLLECT/COMPOUND は自動実行されず、手動トリガーのみ。
4. **最低ポジション**: `MIN_POSITION_VALUE_USD=500` 未満のポジション作成は API で拒否。フロントは `estimatedValueUsd` を送信すること。
5. **deadline**: フロントの Uniswap 呼び出しには deadline あり。バックエンドの executor コントラクトは `RECOMMENDED_DEADLINE_SECONDS` を参照して実装すること。
