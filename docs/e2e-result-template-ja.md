# LP Manager E2E 実行結果テンプレート

実行日: YYYY-MM-DD  
実行者:  
対象ブランチ/コミット:

---

## 1. 実行環境

- API URL:
- Web URL:
- DB:
- 使用チェーン:
- 使用ウォレット（owner/operator）:

---

## 2. API E2E 結果

| 項目 | 結果 (Pass/Fail) | 証跡（レスポンス/ログ） | 備考 |
|---|---|---|---|
| auth challenge 発行 |  |  |  |
| 署名検証（正常） |  |  |  |
| 署名検証（異常） |  |  |  |
| position 作成 |  |  |  |
| positions 一覧取得 |  |  |  |
| position detail |  |  |  |
| strategy preview |  |  |  |
| rebalance preview |  |  |  |
| sync 実行 |  |  |  |
| sync overview |  |  |  |
| indexed positions |  |  |  |
| automation evaluate (owner) |  |  |  |
| automation evaluate (operator) |  |  |  |
| operator permissions |  |  |  |

---

## 3. 精度/フォールバック検証

| 項目 | 結果 (Pass/Fail) | 証跡 | 備考 |
|---|---|---|---|
| fee exact 経路（tokensOwed） |  |  |  |
| fee estimated fallback 経路 |  |  |  |
| NFT on-chain 読み取り |  |  |  |
| NFT indexer fallback（署名時） |  |  |  |
| NFT API fallback |  |  |  |
| PendingSnapshotWrite 退避 |  |  |  |
| PendingSnapshotWrite drain |  |  |  |

---

## 4. UI E2E 結果

| 画面 | 結果 (Pass/Fail) | 証跡（スクショ/ログ） | 備考 |
|---|---|---|---|
| Home / Command Center |  |  |  |
| My Positions |  |  |  |
| Position Detail |  |  |  |
| Strategy Lab |  |  |  |
| Automation |  |  |  |
| Portfolio |  |  |  |
| Activity |  |  |  |

---

## 5. 観測性確認

| 項目 | 結果 (Pass/Fail) | 証跡（ログイベント） | 備考 |
|---|---|---|---|
| GET /health（redisSnapshotCacheEnabled 含む） |  |  |  |
| route latency summary 出力 |  |  |  |
| route outcome summary 出力 |  |  |  |
| auth deny reason 出力 |  |  |  |
| cache hit/miss counters 出力 |  |  |  |

---

## 6. 不具合一覧

| ID | 重要度 | 事象 | 再現手順 | 影響範囲 | 暫定回避策 |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

---

## 7. リリース判断

- 判定: GO / NO-GO
- 理由:
- 条件付き GO の条件:
