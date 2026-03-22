# CoinPool 本番前チェック監査レポート

**監査日**: 2026年3月  
**対象リポジトリ**: lp-manager (apps/api, apps/web)  
**監査方針**: コードベース根拠による判定。推測禁止。金融事故につながる項目は厳しめに評価。

---

# 1. 総合判定

| 判定 | **B: 条件付きで本番投入可能** |
|------|------------------------------|
| **理由** | コア導線は接続済み。ただし、**重大リスクが数件**あり、それらを潰さない限り本番資金投入は危険。 |
| **条件** | 本レポート「本番前に必須で直すべきTOP10」の P0〜P1 を修正すること。 |

---

# 2. 重大リスク一覧

| 項目 | リスク内容 | 影響 | 現状 | 推奨対応 | 優先度 |
|------|-----------|------|------|----------|--------|
| POST /profit/daily-distribution/trigger 認証なし | 誰でも全ウォレットの日次配当を任意日にトリガーできる | 不正配当作成・資金事故 | `requireWalletSignature` 未適用 | 署名検証またはIP制限を導入 | **P0** |
| RPC部分失敗時のスナップショット不整合 | Sync が部分失敗（一部ポジションのみ読めた）場合、読めなかったポジションのスナップショットは古いまま。その状態で配当計算すると誤差 | 収益計算の誤差・過少/過剰配当 | 部分失敗時も読めた分は DB 更新。読めなかった分は前回のまま | 全件成功しない場合は Snapshot を更新しない等のポリシー検討 | **P1** |
| tx-request-builders に deadline 未渡し | API ビルドする tx に deadline が含まれていない。Executor コントラクト依存 | deadline 切れ・フロントントランザクション | `RECOMMENDED_DEADLINE_SECONDS` は定義のみ、calldata に渡されていない | Executor コントラクト側で deadline 必須にするか、calldata に含める | **P1** |
| MAX_SLIPPAGE_BPS 未使用 | env に MAX_SLIPPAGE_BPS があるが automation tx 構築で未使用 | slippage 超過によるスワップ損失 | tx-request-builders は slippage を渡していない | Executor が slippage を受け取る設計なら API から渡す | **P1** |
| AUTOMATION_EXECUTOR_ADDRESS_* の .env.example 不足 | 各チェーンの executor address が .env.example にない | 本番で未設定のまま動作し、automation が黙って失敗 | env では optional。null なら tx 構築をスキップ | .env.example に各チェーン分を追加 | **P2** |
| 部分成功時の整合性 | tx 送信成功・DB 更新失敗、または逆のケースで一貫性が崩れる可能性 | 二重送金・状態不整合 | 監査ログ・トランザクション境界の設計が不十分な箇所あり | クリティカルパスで DB 更新と tx の整合性を設計 | **P1** |
| POST /profit/daily-distribution/trigger の operator 権限 | オペレーターがこのエンドポイントを呼べるかどうか未定義（現状認証なしのため論外） | 権限設計の曖昧さ | - | 認証追加後、owner 専用にするか要検討 | **P2** |
| policy 不正時の platformPart 計算 | policySum !== 10000 の場合 100% owner にフォールバック。platformPart 計算で `profit - ownerPart - operatorPart` を使用 | 丸め誤差で微量の残りが platform に回る可能性は低い | 現状は問題なし | 監視継続 | **P3** |
| PositionRevenuePolicy の wallet フィルタ未使用 | 全 active policy を取得して positionId でマッチ。他ウォレットの policy も読み込む | パフォーマンス・将来的なバグの温床 | 現状のロジックは正しく動作 | IN (positionIds) でフィルタして効率化 | **P3** |
| relayer 障害時のリトライ | relayer 障害で FAILED になったジョブは DEAD_LETTER になるまでリトライされる | 過剰リトライ・監視ノイズ | maxAttempts, retryFailedLimit で制御 | 監視・アラート設計を整備 | **P2** |

---

# 3. 観点別詳細レビュー

## A. E2E整合性

| 判定 | **要注意** |
|------|------------|
| **根拠ファイル** | `apps/api/src/routes/*`, `apps/web/hooks/*`, `apps/api/src/services/automation-daemon.ts`, `daily-distribution-scheduler.ts` |
| **根拠内容** | ウォレット接続→ポジション作成→監視→fee収集→複利→リバランス→配当→UI反映の導線は実装済み。`POST /sync/:wallet` → WalletPositionSyncService → RPC → OnchainPositionState。Automation Daemon → executeQueuedJobsForWallet → relayer。Daily Distribution Scheduler → runDailyDistributionTick → createDailyProfitDistribution。 |
| **想定事故** | Sync 失敗時に DB が古いままになるケース（異常系で後述）。 |
| **修正案** | RPC 失敗時は DB を更新しない設計を徹底する。 |

---

## B. 権限・資金移動安全性

| 判定 | **危険（要修正1件）** |
|------|------------------------|
| **根拠ファイル** | `apps/api/src/routes/profit.ts` L211, `apps/api/src/auth/middleware.ts`, `apps/api/src/services/auth/wallet-authorization.ts` |
| **根拠内容** | ・`POST /profit/daily-distribution/trigger` に `requireWalletSignature` がなく、誰でも呼び出し可能。 ・`POST /profit/distributions/run`, `POST /profit/claim` は `requireWalletSignature` + `authorizeOwnerOrOperatorAction` で `requireCanExecute: true`。 ・`PLATFORM_WALLET` は env 必須、`.env.example` に記載済み。 ・送金先アドレスは PLATFORM_WALLET のほか DistributionWallet.destination 等、DB/設定由来。ハードコードの出金先はなし。 ・Automation execute/evaluate は owner または operator（canExecute/canEvaluate）で制御。 |
| **想定事故** | 第三者が `POST /profit/daily-distribution/trigger` を大量に叩き、不要な配当レコードを大量作成。スケジューラ無効時も `runDailyDistributionForDate` は実行される。 |
| **修正案** | `POST /profit/daily-distribution/trigger` に `requireWalletSignature` を追加し、owner または限定的な operator のみ許可する設計にする。 |

---

## C. 数値ロジック整合性

| 判定 | **問題なし** |
|------|--------------|
| **根拠ファイル** | `apps/api/src/services/daily-profit-engine.ts` L70-92, `apps/api/src/services/revenue-calculator.ts`, `apps/api/src/services/strategy/rebalance-ratio-utils.ts` |
| **根拠内容** | ・`ownerShareBps`, `operatorShareBps`, `platformShareBps` の合計が 10000 でない場合は 10000/0/0 に正規化。 ・`platformPart = profit - ownerPart - operatorPart` で丸め残りを platform に集約。 ・50:50 リバランスは `rebalance-ratio-utils.ts` で `TARGET_RATIO_50_50`, `rebalanceToEqualWeight` を実装。 ・token decimals は `position-analytics` 等で適切に利用。 ・MAX_SLIPPAGE_BPS は env にあり、フロントの validateSlippagePercent で 1% 上限をチェック。 |
| **想定事故** | 特になし。 |
| **修正案** | 現状維持。 |

---

## D. 異常系・失敗時安全性

| 判定 | **要注意** |
|------|------------|
| **根拠ファイル** | `apps/api/src/services/indexer/wallet-position-sync.ts`, `apps/api/src/services/automation-executor.ts`, `apps/api/src/services/daily-distribution-scheduler.ts`, `apps/api/src/services/automation-tx-relayer.ts` |
| **根拠内容** | ・RPC 失敗時: 完全失敗なら reader が throw し DB 更新なし。部分失敗時は読めた positions のみ upsert/snapshot し、読めなかった分は前回のまま（`wallet-position-sync.ts` L159-186）。 ・relayer 失敗時: `markAutomationJobFailed` で FAILED、maxAttempts 超で DEAD_LETTER。リトライで二重実行は `claimNextAutomationJob` の FOR UPDATE SKIP LOCKED により防止。 ・日次配当: `daily-distribution-{wallet}-{date}` で既存レコードをチェックしてスキップ。二重配当防止は実装済み。 ・Executor 側の relayer 障害（relayer_disabled, relayer_url_missing）時は `markAutomationJobSucceeded` で完了扱い。オンチェーン送金は行われない。 ・監査ログは automation-executor, daily-distribution-scheduler で `writeAuditLogV2` を呼び出し。 |
| **想定事故** | RPC が部分的に失敗した際、一部ポジションだけ DB が古いままになり、収益計算がずれる。また、tx 送信成功後に DB 更新で例外が発生した場合の整合性が不明瞭。 |
| **修正案** | RPC 失敗時は DB を一切更新しない。クリティカルな更新はトランザクション境界を明確にし、部分成功を許さない設計にする。 |

---

## E. 運用性・保守性

| 判定 | **問題なし** |
|------|--------------|
| **根拠ファイル** | `apps/api/src/index.ts`, `apps/api/src/services/automation-emergency-check.ts`, `apps/api/src/routes/automation.ts`, `.env.example` |
| **根拠内容** | ・`/health` に automationDaemon, dailyDistributionScheduler, automationRelayer の状態を返却。 ・`checkEmergencyPaused` で AutomationSetting.emergencyPaused を参照し、ポジション単位・グローバルで停止可能。 ・`POST /automation/daemon/tick-now`, `POST /automation/daily-distribution/tick-now` で手動トリガー可能。 ・`.env.example` に主要な env を記載。`AUTOMATION_EXECUTOR_ADDRESS_*` は未記載。 ・AuditLogV2 で誰がいつ何を実行したか追跡可能。 |
| **想定事故** | 特になし。 |
| **修正案** | .env.example に `AUTOMATION_EXECUTOR_ADDRESS_ARBITRUM` 等を追加。 |

---

## F. チェーン・トランザクション安全性

| 判定 | **要注意** |
|------|------------|
| **根拠ファイル** | `apps/api/src/config/env.ts`, `apps/api/src/routes/positions.ts` L203-205, `apps/api/src/services/strategy/tx-request-builders.ts`, `apps/web/lib/security.ts` |
| **根拠内容** | ・chainId 検証: `allowedChainIds.includes(input.chainId)` でポジション作成時にチェック。 ・`tx-request-builders.ts`: `executeRebalance`, `executeAutoCompound` の calldata に deadline・slippage は含まれていない。コメントで「Executor contract should use this internally」と記載。 ・`RECOMMENDED_DEADLINE_SECONDS = 300` は定義のみ。 ・MAX_SLIPPAGE_BPS は env にあり、automation tx 構築では未使用。 ・フロントの Uniswap 操作では `getDeadline()` を使用。 ・`confirmAutomationTxOnchain` で receipt 確認後に状態更新。txHash は AutomationExecution に保存。 |
| **想定事故** | Executor コントラクトが deadline を適切に扱っていない場合、フロントントランザクション同様に期限切れリスクあり。 |
| **修正案** | Executor コントラクトの実装を確認し、deadline/slippage が適切に扱われていることを担保する。必要なら API から calldata に渡す。 |

---

# 4. 本番前に必須で直すべきTOP10

| # | 優先度 | 項目 | 対応 |
|---|--------|------|------|
| 1 | P0 | POST /profit/daily-distribution/trigger に認証を追加 | requireWalletSignature + 権限チェック（owner または制限付き operator） |
| 2 | P1 | RPC 部分失敗時のポリシー明確化 | 部分失敗時に Snapshot を更新するか、全件成功のみ更新にするか方針を決める |
| 3 | P1 | Executor の deadline/slippage を確認 | コントラクト側の実装確認、必要なら calldata に含める |
| 4 | P1 | 部分成功時の整合性設計 | tx 成功／DB 失敗のケースを明示的に扱い、リカバリ手順を文書化 |
| 5 | P1 | AUTOMATION_EXECUTOR_ADDRESS の .env.example 整備 | 各チェーン用の変数を追加 |
| 6 | P2 | MAX_SLIPPAGE_BPS の automation 利用 | Executor が slippage を受け取る場合、API から渡す |
| 7 | P2 | PositionRevenuePolicy の positionIds フィルタ | 不要な policy を読み込まないよう IN (positionIds) で絞る |
| 8 | P2 | relayer 障害時のアラート・監視 | DEAD_LETTER 発生時の通知・ダッシュボード |
| 9 | P2 | 本番用 env チェックリスト | 本番投入前の必須 env 一覧を docs に作成 |
| 10 | P3 | 配当計算のユニットテスト | platformPart の丸め・正規化のテストを追加 |

---

# 5. テストケース一覧

| カテゴリ | テストケース | 確認内容 | 成功条件 | 失敗時の危険性 |
|----------|-------------|----------|----------|----------------|
| 正常系 | ポジション作成→Sync→配当計算→claim | 導線が途切れずに動作する | 全ステップが期待どおり | 導線の不具合が放置される |
| 権限異常系 | operator が canExecute なしで profit/claim を呼ぶ | 403 が返る | 403、claim されない | 不正な資金移動 |
| 権限異常系 | 未認証で POST /profit/daily-distribution/trigger を呼ぶ | 401 が返る（現状は未実装のため通過する） | 401 | 不正配当の大量作成 |
| RPC失敗 | Sync 中に RPC が timeout | エラーが返り、DB が不整合な状態にならない | partialFailure で DB は古いまま、または更新なし | 誤った収益計算 |
| gas不足 | relayer が gas 不足で revert | AutomationExecution が FAILED、ジョブが DEAD_LETTER に | 二重送金なし、監査ログあり | 二重送金の試み |
| approval不足 | Executor が approval なしで実行 | オンチェーンで revert | 監査ログに記録、ジョブ FAILED | 不正な approval 要求 |
| slippage超過 | スワップで slippage 超過 | revert または最小額で約定 | 期待した slippage 制御 | スワップ損失 |
| deadline切れ | tx が deadline 後に実行 | revert | 監査ログに記録 | ストールした tx |
| 二重実行 | 同一 idempotencyKey で複数リクエスト | 2件目は既存を返すか 409 | 二重送金なし | 二重送金 |
| 部分成功 | tx 成功後に DB 更新で例外 | リカバリ可能な状態で停止 | 手動復旧手順が明確 | 不整合な状態 |
| Mainnet自動実行防止 | chainId=1 で REBALANCE job を daemon が実行 | PRECHECK_FAILED, mainnet_auto_disabled | 自動実行されない | Mainnet で意図せぬ実行 |
| env未設定 | PLATFORM_WALLET 未設定で起動 | 起動時に Zod エラーで失敗 | 起動しない | 不正な送金先 |
| 不正な送金先 | PLATFORM_WALLET が不正なアドレス | env パースで reject | 起動しない | 資金の誤送先 |
| 分配比率誤差 | ownerShareBps + operatorShareBps + platformShareBps != 10000 | 100% owner にフォールバック | 計算が一貫 | 分配のずれ |
| UIとDBの不整合 | Sync 後に UI が古い表示 | 再読み込みで反映 | 最終的に一致 | ユーザー混乱 |

---

# 6. 結論

## このまま少額テスト運用できるか

**条件付きで可能。** 以下を満たす場合に限る:
- `POST /profit/daily-distribution/trigger` を外部に露出しない（ファイアウォール／未公開）
- 本番資金を入れず、テストネットまたはごく少額で動作確認する

## このまま本番資金投入してよいか

**不可。** 以下を直すまで本番資金投入は推奨しない:
1. `POST /profit/daily-distribution/trigger` の認証追加
2. RPC 部分失敗時の Snapshot 更新ポリシーの明確化（全件成功のみ更新等）

## 何が残っている限り危険か

1. **認証なしの配当トリガー** … 第三者による不正配当の大量作成が可能
2. **RPC 失敗時の DB 整合性** … 誤った収益計算に基づく配当のリスク
3. **Executor の deadline/slippage** … コントラクト依存のため、実装未確認のままではフロントントランザクションと同等以上のリスク

## 次にやるべき実装順

1. `POST /profit/daily-distribution/trigger` に `requireWalletSignature` を追加し、owner 専用とする（または制限付き operator）
2. RPC 失敗時は DB を更新しないよう wallet-position-sync を修正
3. Executor コントラクトで deadline/slippage の扱いを確認し、必要なら API から渡す
4. .env.example に `AUTOMATION_EXECUTOR_ADDRESS_*` を追加
5. 上記のテストケースを CI に組み込む
