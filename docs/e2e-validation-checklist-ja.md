# Coin Pool E2E確認手順

この手順は、現在の実装（sync/automation/positions observability 含む）を対象にした実行用チェックリストです。

## 1. 事前準備

- API 環境変数を設定（`DATABASE_URL`、各 chain RPC URL、automation フラグ）。
- DB マイグレーションを適用。
- API/Web を起動。
- 署名可能なウォレットを 1 つ以上用意（owner / operator の 2 アカウント推奨）。

## 2. API E2E（コア）

### 2.1 Challenge と署名

- `GET /auth/challenge/:wallet` を実行して `nonce` / `issuedAt` / `action` / `chainId` を確認。
- 同じ `action` で署名し、署名ヘッダ付きで保護 API にアクセスできることを確認。
- 不正署名・期限切れ署名で 401/403 が返ることを確認。

### 2.2 Position 作成・参照

- `POST /positions` で position を作成。
- `GET /positions/:wallet` で作成データが返ることを確認。
- `savedStatus` と `computedStatus` が分離表示されることを確認。
- `GET /positions/:wallet/:positionId` で `liveState` / `analyticsState` / `placeholderFlags` が返ることを確認。

### 2.3 Strategy / Preview

- `GET /positions/:wallet/:positionId/strategy?mode=BALANCED` 実行。
- 同一リクエスト再実行時に cache hit ログ（`position_strategy_read_cache_hit`）が出ることを確認。
- `POST /positions/:wallet/:positionId/rebalance-preview` 実行。
- レスポンスの `decision.netExpectedBenefitUsd`、`rationale`、`explanationLines` を確認。

### 2.4 Sync / Indexing

- `POST /sync/:wallet` 実行。
- `GET /sync/:wallet` / `GET /sync/:wallet/overview?chainId=...` / `GET /sync/:wallet/indexed?chainId=...` を確認。
- `/overview` が短TTLキャッシュされ、`POST /sync` 後に invalidate されることを確認。

### 2.5 Automation

- `POST /automation/operators` で operator 権限を登録（owner 実行）。
- operator で `POST /automation/evaluate` 実行。
- `canEvaluate` / `canExecute` の組み合わせで許可/拒否が変わることを確認。
- `GET /automation/config` で runtime 設定が返ることを確認。

## 3. API E2E（精度・フォールバック）

### 3.1 Fee 推定経路

- `OnchainPositionState.tokensOwed0/1` ありの状態で fee が `exact` 経路になることを確認。
- `tokensOwed` 欠損状態でも `estimated` ヒューリスティック値へフォールバックすることを確認。

### 3.2 NFT 取得

- Web 側 adapter の `fetchPositionNfts` 実行で on-chain `balanceOf/tokenOfOwnerByIndex/positions` が動くことを確認。
- on-chain 読み取り失敗時に indexer fallback（`/sync/:wallet/indexed`、署名必須）→ API fallback（`/positions/:wallet`）の順で切り替わることを確認。

### 3.3 Snapshot durable queue

- `PoolMarketSnapshot` 書き込み失敗を意図的に作り、`PendingSnapshotWrite` に保存されることを確認。
- drain 関数で取り出せることを確認。

## 4. UI E2E

### 4.1 Command Center（`/`）

- 集計カードが表示されること。
- quality / freshness バッジの表示を確認。

### 4.2 My Positions（`/my-positions`）

- filter / sort / strategy preview 導線 / collect 導線を確認。
- モバイル表示で card fallback が有効なことを確認。

### 4.3 Position Detail（`/positions/[positionId]`）

- Current State / Analytics / Strategy / History / Safety セクションを確認。
- `TimestampWithAge` と data quality 表示を確認。

### 4.4 Strategy Lab（`/strategy-lab`）

- 3モード比較を実行。
- 履歴サマリ（samples / pnl proxy / apr proxy / stale ratio）が表示されることを確認。

### 4.5 Automation / Portfolio / Activity

- `/automation`: owner/operator 設定、評価実行、警告表示を確認。
- `/portfolio`: strategy 集計（high volatility/range/negative-net）を確認。
- `/activity`: tx link、quality、freshness 表示を確認。

## 5. 観測性 E2E

- 各 route で遅延サマリ（`count/p50/p95/p99/max`）ログが出ること。
- 4xx/5xx で `route_http_outcome` ログが出ること。
- 認可拒否時に `sync_authorization_denied` / `automation_authorization_denied` が出ること。
- operator permission cache と sync overview cache の hit/miss カウンタ推移を確認。

## 6. 合格基準

- 主要 API が 2xx を返し、失敗ケースは期待どおり 4xx/5xx で制御される。
- sync/automation/positions のログに route latency と outcome サマリが出る。
- Web 主要画面（home/my-positions/detail/strategy-lab/automation/portfolio/activity）がエラーなく表示される。
- data quality と freshness が UI で視認できる。
