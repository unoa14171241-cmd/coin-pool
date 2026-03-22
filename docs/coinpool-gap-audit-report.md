# CoinPool要件とのギャップ監査レポート

**監査日**: 2026年3月  
**対象リポジトリ**: lp-manager (apps/api, apps/web, apps/shared)  
**監査方針**: コード上の根拠ベースで判定。推測による「あることにする」は禁止。

---

# 1. 全体評価

| 項目 | 評価 |
|------|------|
| **再現度** | 約 **65〜70%** |
| **結論** | **デモ可能 / 一部実運用注意** |
| **デモ可能レベル** | ✅ 可能（LP作成・監視・リバランス・複利・配当計算・オーナー/オペレーター権限のデモは可能） |
| **実運用可能レベル** | ⚠️ 注意（毎日USDC自動配当の自動トリガー、Ethereum Mainnet手動制御、最低利用条件$500の強制、監査ログの網羅性にギャップあり） |

---

# 2. 実装対応表

## A. 基本構造

| 要件 | 判定 | 根拠ファイル | 問題点 | 優先度 |
|------|------|--------------|--------|--------|
| Uniswap V3系LP運用 | 実装済み | `apps/api/src/services/onchain/uniswap-position-reader.ts`, `apps/web/lib/adapters/uniswap-v3-adapter.ts` | - | - |
| 特定チェーン対応 (Arbitrum, Base, Mainnet, Polygon) | 実装済み | `apps/api/src/config/env.ts` L85, `apps/api/src/web3/chains.ts` | ALLOWED_CHAIN_IDS で制御 | - |
| ウォレット接続前提 | 実装済み | `apps/api/src/auth/middleware.ts`, wagmi (web) | requireWalletSignature, useAccount | - |
| 顧客資金を預からずユーザーウォレットで完結 | 実装済み | トランザクションはユーザー署名 or リレイヤー経由でユーザーウォレットから実行 | リレイヤー使用時は鍵委譲の設計 | - |
| オーナー/サブウォレット権限制御 | 実装済み | `apps/api/src/services/auth/wallet-authorization.ts`, `prisma/schema.prisma` WalletOperatorPermission | canEvaluate, canExecute, canPause, canChangeStrategy | - |
| 資金引き出し等がオーナー権限のみ | 一部実装 | `apps/api/src/routes/profit.ts` L220-228 | 配当実行は requireCanExecute。オーナーは常に可。オペレーターは canExecute が必要。**直接の資金引き出し（withdraw）APIは未確認** | Mid |

## B. LP管理機能

| 要件 | 判定 | 根拠ファイル | 問題点 | 優先度 |
|------|------|--------------|--------|--------|
| LPポジション作成 | 実装済み | `apps/web/app/create-position/page.tsx`, `apps/api/src/routes/positions.ts` L194-250 (POST /positions) | フロントでトランザクション実行後、saveCreatedPosition でDB登録 | - |
| 通貨ペア選定設定 | 実装済み | `apps/api/src/services/strategy/pair-selector.ts`, `pair-classifier.ts`, `apps/web/lib/constants.ts` TARGET_PAIR | VOLATILE/STABLE 分類、戦略モード別選定 | - |
| レンジ幅設定 | 実装済み | `apps/web/app/create-position/page.tsx` RANGE_PRESETS, `apps/api/src/services/strategy/range-proposal-engine.ts` | - | - |
| fee tier設定 | 実装済み | `apps/web/app/create-position/page.tsx` L26 feeTier state | - | - |
| 現在価格/レンジ内外判定 | 実装済み | `apps/api/src/services/positions-live.ts`, `computedStatus` (currentTick vs tickLower/tickUpper) | - | - |
| ポジション監視 | 実装済み | `apps/api/src/services/indexer/wallet-position-sync.ts`, sync routes | - | - |
| fee収集 (collect) | 実装済み | `apps/api/src/services/fee-collector.ts`, AutomationJobType.COLLECT | - | - |
| 再投入 (compound) | 実装済み | `apps/api/src/services/liquidity-compounder.ts`, AutomationJobType.COMPOUND | - | - |
| リバランス実行 | 実装済み | `apps/api/src/services/strategy/worker.ts`, `tx-request-builders.ts` buildRebalanceTxRequest | - | - |
| 50:50再調整ロジック | 一部実装 | リバランスは新しいレンジ幅でポジション再作成。50:50は executor コントラクト側の責務の可能性 | 明示的な「50:50」ロジックのコード上の根拠なし | Low |
| レンジ外自動リポジション | 実装済み | RebalanceDecisionEngine, autoRebalanceEnabled | - | - |
| ポジション履歴/実行履歴/監査ログ | 実装済み | PositionSnapshot, AutomationExecution, AuditLogV2 | 監査ログは automation/strategies 等に限定。全API操作の網羅は未確認 | Mid |

## C. CoinPool特有の運用要件

| 要件 | 判定 | 根拠ファイル | 問題点 | 優先度 |
|------|------|--------------|--------|--------|
| 自動リバランス（価格がレンジ外れた際に指定%で再設定） | 実装済み | `apps/api/src/services/strategy/rebalance-decision-engine.ts`, `worker.ts`, AutomationPolicy.autoRebalanceEnabled | widthPercent でレンジ幅指定可能 | - |
| 自動複利 | 実装済み | `apps/api/src/services/strategy/worker.ts` GuardedAutoCompoundExecutionPolicy, AutomationPolicy.autoCompoundEnabled | - | - |
| 毎日USDC自動配当 | **一部実装** | `apps/api/src/services/daily-profit-engine.ts`, `apps/api/src/routes/profit.ts` | **配分計算・AUTO送金ロジックはあるが、毎日の自動トリガー（cron/daemon）が未実装**。POST /profit/distributions/run の手動呼び出しが必要 | **High** |
| 利益配分 (オーナー67%/サポート33%) | 実装済み | `apps/api/prisma/schema.prisma` PositionRevenuePolicy (ownerShareBps, operatorShareBps, platformShareBps), `daily-profit-engine.ts` L70-91 | 67/33 は設定可能。デフォルトは 10000/0/0 | - |
| 最低利用条件 ($500以上等) | **未実装** | `apps/api/prisma/schema.prisma` StrategyTemplate.recommendedMinCapital | recommendedMinCapital はあるが、**ポジション作成時や自動化実行時の強制チェックなし** | Mid |
| Ethereum Mainnetでは手動対応 | **未実装** | - | chainId 別に executor address を設定可能だが、**Mainnet(chainId=1)のみ自動実行を禁止する明示ロジックなし** | Mid |

## D. 安全性・運用性

| 要件 | 判定 | 根拠ファイル | 問題点 | 優先度 |
|------|------|--------------|--------|--------|
| 想定外エラー時の監査ログ | 一部実装 | `apps/api/src/services/audit-v2.ts`, `automation-executor.ts` L414, L478 | automation 実行失敗時は記録。**全API/全エラーパスの網羅は未確認** | Mid |
| Job/Cron失敗時の再試行・通知 | 実装済み | `apps/api/src/services/automation-queue.ts` maxAttempts, idempotencyKey, `automation-daemon.ts` retryFailedLimit | cron は setInterval ベース。通知は NotificationSetting あり | - |
| 鍵管理・署名の安全性 | 実装済み | リレイヤー経由時は外部サービスが署名。フロントに秘密鍵なし | リレイヤー依存の設計 | - |
| 秘密情報のフロント漏れ | 実装済み | .env で管理。フロントは公開情報のみ | - | - |
| slippage/deadline/gas/approval | 一部実装 | `apps/web/lib/security.ts` validateSlippagePercent, validateApproveTarget, `tx-request-builders.ts` | **deadline が tx に含まれていない**。gasLimit は 600000/450000 でハードコード | Mid |
| 二重実行防止 | 実装済み | `apps/api/src/services/automation-queue.ts` L81 ON CONFLICT (idempotencyKey), ProfitClaimIdempotency | - | - |
| 価格取得ソースの妥当性 | 実装済み | ChainlinkPriceProvider, ethUsdFeedAddressByChain | - | - |
| チェーンごとの設定ミス防止 | 実装済み | allowedChainIds, isChainInputConsistent | - | - |
| 本番で危険なハードコード | 危険 | `apps/api/src/services/daily-profit-engine.ts` L11 | **PLATFORM_WALLET = "0x000000000000000000000000000000000000dEaD"** がハードコード。本番では環境変数化すべき | High |

## E. UI / 運用画面

| 要件 | 判定 | 根拠ファイル | 問題点 | 優先度 |
|------|------|--------------|--------|--------|
| ダッシュボードで現在ポジション表示 | 実装済み | `apps/web/app/my-positions/page.tsx`, `apps/web/app/portfolio/page.tsx` | - | - |
| 累積手数料/日次収益/資産評価額 | 実装済み | portfolio, positions API, daily-profit | - | - |
| レンジ内外ステータス | 実装済み | computedStatus, StatusBadge, IN_RANGE/OUT_OF_RANGE | - | - |
| 自動化設定 (ON/OFF, 閾値, 対象ペア) | 実装済み | `apps/web/app/automation/page.tsx`, AutomationSetting, AutomationPolicy | - | - |
| 実行履歴/配当履歴/リバランス履歴 | 実装済み | useAutomationExecutions, profit distributions, AutomationExecution | - | - |
| Uniswapライクな線グラフ/スナップショット推移 | 実装済み | `apps/web/components/charts/daily-profit-chart.tsx`, DailyProfitChart | - | - |

---

# 3. 重大ギャップ詳細

## 3-1. 毎日USDC自動配当

**現状**  
- `createDailyProfitDistribution` で配分計算・ProfitDistribution/ProfitDistributionItem 作成は実装済み  
- `DistributionWallet.payoutMode = AUTO` かつ `minPayoutUsd` 以上なら `autoPayout: true` で自動送金対象  
- **しかし** 配当の「毎日自動実行」をトリガーする cron/daemon が存在しない  

**根拠**  
- `apps/api/src/services/automation-daemon.ts`: EVALUATE, REBALANCE, COLLECT, COMPOUND を処理。DISTRIBUTE は job として存在するが、daemon が「毎日0時」に distribution を自動作成するロジックは見当たらない  
- `POST /profit/distributions/run` が手動呼び出し前提  

**不足**  
- 日次スケジュールで `createDailyProfitDistribution` を実行する worker/cron  
- 例: node-cron や Cloud Scheduler 等で毎日 0:00 UTC に API を叩く  

**最小実装**  
- `apps/api/src/services/daily-distribution-scheduler.ts` を新規作成  
- automation-daemon の tick 内、または別の setInterval で「日付が変わったら未実行の distribution を作成」するロジックを追加  

---

## 3-2. 自動複利

**現状**  
- 実装済み。`GuardedAutoCompoundExecutionPolicy`, `autoCompoundEnabled`, `minimumCompoundFeesUsd` で制御  
- `buildAutoCompoundTxRequest` でトランザクション生成  

**問題点**  
- 特になし。CoinPool 要件を満たしている  

---

## 3-3. 自動リバランス

**現状**  
- 実装済み。`RebalanceDecisionEngine`, `autoRebalanceEnabled`, `minNetBenefitUsd` で制御  
- レンジ外検知 → 評価 → リバランスジョブ enqueue → 実行  

**問題点**  
- 特になし  

---

## 3-4. 権限制御

**現状**  
- `WalletOperatorPermission`: canEvaluate, canExecute, canPause, canChangeStrategy  
- `authorizeOwnerOrOperatorAction` でオーナー/オペレーター判定  
- 配当実行 (`POST /profit/distributions/run`) は `requireCanExecute: true`  

**不足**  
- 「資金引き出し」専用の API が不明。profit claim は配当の受取であり、LP ポジションからの直接 withdraw とは別の可能性あり  
- オーナー限定操作の明文化（例: オペレーター追加/削除、緊急停止など）の整理  

---

## 3-5. 監査ログ / 安全性

**現状**  
- `AuditLogV2`, `writeAuditLogV2` が automation-executor, strategies, automation-settings で使用  
- 失敗時も `automation_execution_failed` で記録  

**不足**  
- 全 API ルートでの audit 記録は未確認（positions, profit, sync 等）  
- 監査ログの保持期間・アーカイブ方針（AUTOMATION_AUDIT_RETENTION_DAYS は 30 日）  

**危険**  
- `daily-profit-engine.ts` の `PLATFORM_WALLET` ハードコード  
- `tx-request-builders.ts` に deadline が含まれていない（フロント側 create では slippage あり）  

---

# 4. 直すべき TOP5

1. **毎日USDC自動配当のトリガー**  
   - 日次で `createDailyProfitDistribution` を実行する scheduler を追加  

2. **PLATFORM_WALLET の環境変数化**  
   - `daily-profit-engine.ts` の `PLATFORM_WALLET` を `env.PLATFORM_WALLET` 等で設定  

3. **Ethereum Mainnet 手動制御**  
   - chainId=1 のときは `AUTOMATION_EXECUTOR_ADDRESS_MAINNET` が未設定なら自動実行をスキップする、または `automation-emergency-check` に Mainnet 専用ポリシーを追加  

4. **最低利用条件 $500 の強制**  
   - ポジション作成時または自動化有効化時に `estimatedPositionValueUsd >= 500` をチェック  

5. **トランザクションに deadline の追加**  
   - `buildRebalanceTxRequest`, `buildAutoCompoundTxRequest` に deadline パラメータを追加（executor コントラクトが対応している場合）  

---

# 5. 実装タスク案

## Backend

- [ ] `daily-distribution-scheduler.ts`: 日次配当の自動トリガー  
- [ ] `PLATFORM_WALLET` を環境変数化  
- [ ] chainId=1 の自動実行制御ロジック  
- [ ] 最低ポジション価値チェック（$500）  
- [ ] 監査ログの拡充（positions, profit, sync 等の重要操作）  

## Frontend

- [ ] 最低利用条件の表示（StrategyTemplate.recommendedMinCapital）  
- [ ] Mainnet 利用時の「手動のみ」注意表示  

## Worker / Cron

- [ ] 日次配当 scheduler の実装  
- [ ] 失敗時の通知（NotificationSetting の webhook/telegram/discord 連携確認）  

## Smart Contract / Web3

- [ ] executor コントラクトの deadline 対応確認  
- [ ] 50:50 再調整がコントラクト側で行われているか確認  

## DB / Audit

- [ ] AuditLogV2 の記録対象の拡大  
- [ ] 保持期間・アーカイブポリシーの文書化  

---

# 付録: 主要ファイル一覧

| 機能 | ファイル |
|------|----------|
| Uniswap V3 読み取り | `apps/api/src/services/onchain/uniswap-position-reader.ts` |
| ポジション同期 | `apps/api/src/services/indexer/wallet-position-sync.ts` |
| 戦略ワーカー | `apps/api/src/services/strategy/worker.ts` |
| リバランス判定 | `apps/api/src/services/strategy/rebalance-decision-engine.ts` |
| 複利 | `apps/api/src/services/liquidity-compounder.ts` |
| 日次配当計算 | `apps/api/src/services/daily-profit-engine.ts` |
| オーナー/オペレーター認可 | `apps/api/src/services/auth/wallet-authorization.ts` |
| 監査ログ | `apps/api/src/services/audit-v2.ts` |
| 自動化 daemon | `apps/api/src/services/automation-daemon.ts` |
| トランザクション生成 | `apps/api/src/services/strategy/tx-request-builders.ts` |
