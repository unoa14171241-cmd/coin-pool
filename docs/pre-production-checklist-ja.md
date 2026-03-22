# LP Manager 本番投入前チェックリスト

本番資金を扱う前に、必ずこのチェックリストを完了してください。

## 1. 環境・インフラ

| 項目 | 確認内容 | 完了 |
|------|----------|------|
| DB | PostgreSQL が起動し、マイグレーションが適用済み | ☐ |
| Redis | マルチインスタンス運用時は `CHALLENGE_STORE_BACKEND=redis` と `REDIS_URL` を設定。pool snapshot 共有時は `REDIS_SNAPSHOT_CACHE_ENABLED=true` も設定 | ☐ |
| RPC | 各チェーンの RPC URL が有効で、レート制限内 | ☐ |
| API | `NEXT_PUBLIC_API_BASE_URL` が本番 API を指している | ☐ |
| WalletConnect | `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` が本番用 | ☐ |

## 2. セキュリティ

| 項目 | 確認内容 | 完了 |
|------|----------|------|
| 署名 | 保護 API が署名検証を正しく行う | ☐ |
| Nonce | challenge の nonce がリプレイ防止されている | ☐ |
| Operator | owner が operator 権限を意図どおり設定している | ☐ |
| Approve | exact approve のみ使用（無制限 approve なし） | ☐ |
| Spender | approve 先が allowlist（Position Manager）に一致 | ☐ |

## 3. 資金操作前の毎回確認

| 項目 | 確認内容 | 完了 |
|------|----------|------|
| Approve 先 | コントラクトアドレスが正しい | ☐ |
| チェーン ID | 操作対象チェーンが正しい | ☐ |
| スリッページ | 許容範囲内（1–100 bps） | ☐ |
| 受取アドレス | 自分のウォレットである | ☐ |
| 数量 | 入力数量が意図どおり | ☐ |

## 4. 少額 E2E テスト（必須）

本番資金投入前に、**少額**で以下を実施してください。

| 項目 | 手順 | 完了 |
|------|------|------|
| Position 作成 | 最小限の ETH/USDC で LP を作成 | ☐ |
| Collect | 手数料を収集 | ☐ |
| Rebalance | レンジ外れ時に再配置 | ☐ |
| 全画面表示 | Command Center / My Positions / Detail / Activity がエラーなく表示 | ☐ |
| Automation | evaluate 実行、operator 権限の確認 | ☐ |

詳細手順: `docs/e2e-validation-checklist-ja.md`  
結果記録: `docs/e2e-result-template-ja.md`

## 5. 自動化設定（運用時）

| 項目 | 確認内容 | 完了 |
|------|----------|------|
| `AUTOMATION_EXECUTION_ENABLED` | 本番で有効にする場合は `true` | ☐ |
| `AUTOMATION_DAEMON_ENABLED` | 定期評価が必要な場合は `true` | ☐ |
| `AUTOMATION_MIN_NET_BENEFIT_USD` | 実行閾値を適切に設定 | ☐ |
| `AUTOMATION_RELAYER_ENABLED` | relayer 利用時は `true` と URL 設定 | ☐ |

## 6. リスク確認

- 本ツールは投資支援ツールであり、投資運用サービスではありません。
- Impermanent loss、価格変動、スマートコントラクトリスク、ガスコストに留意してください。
- 収益は保証されません。`Estimated` / `Realized` の表現を尊重してください。

## 7. 合格基準

- [ ] 上記 1–5 の全項目を確認済み
- [ ] 少額 E2E テストが成功
- [ ] 資金操作前の毎回確認を運用フローに組み込み済み
