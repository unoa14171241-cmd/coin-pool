# Coin Pool

Uniswap V3互換DEX向けの、**非カストディアル（資産預かりなし）**な流動性ポジション管理ツールです。  
集中流動性ポジションを可視化し、レンジ外れを検知し、再配置（Rebalance）を支援します。

## 1) Architecture

- Frontend: `Next.js + TypeScript + Tailwind + shadcn/ui + wagmi + viem + React Query`
- Backend: `Node.js + TypeScript + Express + Prisma + PostgreSQL + Zod`
- Web3: `Uniswap V3 SDK対応設計（Adapter layer） + viem`
- Infra: `Docker(PostgreSQL) + .env`
- 設計方針:
  - ユーザー資産を預からない
  - 秘密鍵を保持しない
  - ウォレット署名ベース
  - 収益は Estimated/Realized 表現のみ
  - 全画面でリスクを明示

## 2) Folder structure

```txt
.
├─ apps
│  ├─ web
│  │  ├─ app
│  │  │  ├─ page.tsx                 # Command Center (Dashboard)
│  │  │  ├─ create-position/page.tsx
│  │  │  ├─ my-positions/page.tsx
│  │  │  ├─ positions/[positionId]/page.tsx
│  │  │  ├─ portfolio/page.tsx
│  │  │  ├─ strategy-lab/page.tsx
│  │  │  ├─ automation/page.tsx
│  │  │  ├─ rebalance/page.tsx
│  │  │  ├─ activity/page.tsx        # 監査トレイル（検索・フィルタ対応）
│  │  │  └─ settings/page.tsx
│  │  ├─ components
│  │  ├─ hooks
│  │  ├─ lib
│  │  └─ tests
│  └─ api
│     ├─ src
│     │  ├─ config
│     │  ├─ db
│     │  ├─ routes
│     │  └─ schemas
│     ├─ prisma
│     └─ tests
├─ docker-compose.yml
└─ .env.example
```

## 3) DB schema

`apps/api/prisma/schema.prisma` に以下を定義しています。

- `Position`
  - wallet
  - positionId
  - chainId
  - chainName (表示用)
  - poolAddress
  - token0Address / token1Address
  - token0Symbol / token1Symbol
  - feeTier
  - tickLower
  - tickUpper
  - createdTx
  - collectTx
  - rebalanceTx
  - createdAt
  - status
  - lastCheck
  - logs
  - error
- `ActivityLog`
  - Position created / Collect / Rebalance / Error の履歴を記録

## 4) Key modules

- Frontend
  - `apps/web/lib/apr.ts`: Estimated APR計算
  - `apps/web/lib/range.ts`: レンジ計算（Conservative/Balanced/Aggressive）
  - `apps/web/lib/uniswap/tick.ts`: tick計算ユーティリティ（display向け近似変換を含む）
  - `apps/web/lib/uniswap/price-conversion.ts`: token向き/decimals対応の精密変換interface
  - `apps/web/lib/security.ts`: chain/slippage/approve先バリデーション
  - `apps/web/lib/adapters/uniswap-v3-adapter.ts`: prepare/execute形式のUniswap V3 Adapter（`fetchPositionNfts` はon-chain read実装）
  - `apps/web/components/risk-warning-modal.tsx`: 初回接続時モーダル
  - `apps/web/components/risk-disclosure.tsx`: 全ページ下部リスク表示
- Backend
  - `apps/api/src/schemas/position.ts`: ZodによるAPI入力検証
  - `apps/api/src/routes/positions.ts`: Dashboard/Position API
  - `apps/api/src/routes/logs.ts`: Activity Log API
  - `apps/api/src/routes/automation.ts`: Automation evaluate/execute/executions API
  - `apps/api/src/routes/profit.ts`: Profit distribution/claim API
  - `apps/api/src/services/automation-queue.ts`: Durable queue + lease + retry
  - `apps/api/src/services/automation-executor.ts`: Idempotent execution orchestration
  - `apps/api/src/services/risk-engine.ts`: Circuit-breaker style risk checks
- `apps/api/src/routes/settings.ts`: 通知設定API
- `apps/api/src/routes/market.ts`: ETH価格API（Chainlink）
  - `apps/api/prisma/schema.prisma`: 永続化モデル

E2E 実行手順:

- `docs/e2e-validation-checklist-ja.md`
- `docs/e2e-result-template-ja.md`
- `docs/automation-prisma-api-draft-ja.md` (automation拡張の Prisma/API 草案)

Automation execution foundation:

- `AutomationJob` / `AutomationExecution` / `AutomationPolicy` / `AutomationWorker` を追加
- Worker loop の基本形（enqueue -> lease -> run -> verify/precheck -> finalize）を実装
- daemon tick 監査ログに `processedJobIds` / `failedJobIds` / `processedExecutionIds` を保存
- daemon tick 監査ログは `AutomationDaemonTick` に永続化（APIはDB優先、障害時はメモリフォールバック）
- idempotency key で重複実行を抑止
- ガス閾値・最小ネットベネフィット・リスクルールで precheck ガード
- `ProfitDistribution` / `ProfitDistributionItem` / `DistributionWallet` / `PositionRevenuePolicy` を追加
- 日次分配は `PositionRevenuePolicy`（owner/operator/platform）に応じて複数ウォレットへ配分
- API 拡張:
  - `POST /automation/execute`
  - `GET /automation/executions`
  - `GET /automation/jobs`
  - `GET /automation/policies`
  - `POST /automation/policies`
  - `POST /automation/worker/tick`
  - `GET /automation/worker/health`
  - `GET /automation/metrics`
  - `GET /automation/daemon/ticks`
  - `POST /automation/daemon/tick-now`
  - `POST /automation/daemon/cleanup-now`
  - `POST /profit/distributions/run`
  - `GET /profit/distributions`
  - `POST /profit/claim`
  - `GET /profit/distribution-wallets/:wallet`
  - `POST /profit/distribution-wallets`
  - `GET /profit/revenue-policies/:wallet`
  - `POST /profit/revenue-policies`
  - `POST /profit/claim` は `paidTxHash` 明示、または `txRequest` + relayer で確定可能（`idempotencyKey` / `chainId` / `waitForConfirmation` 対応）
  - `GET /automation/metrics` は `failureByErrorCode` / `relayerFailureCount` / `byType` / `byTxStatus` / `trend` を返却（運用分析用）
  - `trend` の各バケットには `relayerFailed` / `relayerFailureRate` / `p95ElapsedMs` を含み、障害と性能劣化の時系列把握が可能
  - `GET /automation/metrics` は `alerts` / `alertThresholds` も返却し、最新バケットの劣化判定に利用可能
  - `wallet` 指定でアラート閾値超過時、`ActivityLog` に `type=Automation Alert` / `source=system-alert` を記録（同一内容30分は重複抑止）
  - `GET /automation/metrics?wallet=<ownerWallet>&chainId=<chainId>&type=<REBALANCE|COLLECT|COMPOUND|DISTRIBUTE|EVALUATE>&since=<ISO8601>&trendBucket=<15m|1h>&trendLimit=<n>` で対象・チェーン・種別・期間・トレンド解像度を絞り込み可能

### daemon tick監査APIの使い方

- 監査ログ取得:
  - `GET /automation/daemon/ticks?limit=20&offset=0`
  - `GET /automation/worker/health`（`recentTicks` に同等情報を含む）
  - `POST /automation/daemon/cleanup-now`（古い監査ログを即時クリーンアップ）
- job詳細の一括追跡:
  - `GET /automation/jobs?wallet=<ownerWallet>&ids=<jobId1>,<jobId2>`
  - `ids` は `ids=a,b,c` と `ids=a&ids=b` の両形式に対応
  - `includePayload=true` を付けると job の `payload` を返却
- execution詳細の一括追跡:
  - `GET /automation/executions?wallet=<ownerWallet>&ids=<executionId1>,<executionId2>`
  - `ids` は `ids=a,b,c` と `ids=a&ids=b` の両形式に対応
  - `includePayload=true` を付けると execution の `context` を返却
- 各tickで以下を返却:
  - `processedJobIds`: そのtickで実行対象になった job ID 一覧
  - `failedJobIds`: 失敗した job ID 一覧
  - `processedExecutionIds`: 生成された execution ID 一覧

レスポンス例（抜粋）:

```json
{
  "daemon": {
    "running": true,
    "workerId": "daemon-worker"
  },
  "ticks": [
    {
      "at": "2026-03-10T12:34:56.000Z",
      "workerId": "daemon-worker",
      "walletCount": 2,
      "processed": 3,
      "failed": 1,
      "requeued": 0,
      "processedJobIds": ["job-a", "job-b", "job-c"],
      "failedJobIds": ["job-c"],
      "processedExecutionIds": ["exec-1", "exec-2", "exec-3"],
      "elapsedMs": 842,
      "ok": true,
      "error": null
    }
  ]
}
```

監査トレース手順:

1. `GET /automation/daemon/ticks` で対象tickの `processedJobIds` / `processedExecutionIds` を取得
2. job単位の追跡は `GET /automation/jobs`（`id` で絞り込み）で状態を確認
3. execution単位の追跡は `GET /automation/executions`（`jobId` もしくは `wallet`）で詳細確認
4. 失敗分析は `failedJobIds` と `AutomationExecution.errorCode/errorMessage/context` を突合

## 5) Security risks

本ツールは投資支援ツールであり、投資運用サービスではありません。  
以下のリスクに留意してください。

- Impermanent loss
- Price volatility
- Smart contract risk
- Gas costs
- Returns are not guaranteed.

**UIポリシー**
- 禁止表現: Guaranteed / Expected profit / Stable yield
- 許可表現: Estimated / Realized
- Dashboardに以下を表示:
  - `Estimated Fees Earned`
  - `Estimated APR`
  - `Realized PnL`
  - `Total Value`

## 6) Implementation plan

- Step1 Architecture設計: 完了
- Step2 ディレクトリ作成: 完了
- Step3 Wallet接続: 完了（wagmi）
- Step4 Poolデータ取得: API/Adapterの土台実装
- Step5 Range計算: 完了
- Step6 LP mint: Tx確認UIとAdapter雛形実装
- Step7 Position取得: API + My Positions実装
- Step8 Collect: Adapter雛形実装
- Step9 Rebalance: UIフロー実装（withdraw -> optional swap -> new mint）
- Step10 Dashboard: 完了
- Step11 DB保存: Prisma schema + API実装
- Step12 UI改善: 基本画面・警告文言実装
- Step13 README: 完了

---

## 対応チェーン

- 正式対応範囲（本リポジトリ）: Arbitrum / Ethereum / Base / Polygon
- 初期運用推奨: Arbitrum

## 対象DEX

- 初期: Uniswap V3互換DEX
- DEX Adapter layerで将来追加可能

## 対象ペア

- 初期: ETH / USDC

## APR計算ロジック

```txt
APR = (累積手数料 / ポジション価値) × (365 / 運用日数)
```

画面では必ず `Estimated APR` として表示し、参考値である旨を表示します。

## 起動方法

1. 依存関係インストール
   - `npm install`
2. 環境変数作成
   - `.env.example` を `.env` にコピーして値を設定
3. DB起動
   - `docker compose up -d` （PostgreSQL + Redis）
4. Prisma適用
   - `npm run prisma:generate -w apps/api`
   - `npm run prisma:migrate -w apps/api`
5. 開発起動
   - API: `npm run dev:api`
   - Web: `npm run dev:web`

### 署名認証付き保護API

`POST /positions` / `POST /settings` / `POST /activity` / `POST /automation/evaluate` / `POST /automation/execute` / `POST /automation/operators` / `POST /automation/policies` / `POST /automation/worker/tick` / `POST /automation/daemon/cleanup-now` / `POST /profit/distributions/run` / `POST /profit/claim` / `POST /profit/distribution-wallets` / `POST /profit/revenue-policies` は署名が必須です。  
`GET /automation/operators/:ownerWallet` も署名必須です（owner または許可された operator のみ参照可）。
フロントの署名ヘッダ生成は `apps/web/lib/wallet-auth.ts` に共通化しています。
クライアントは `GET /auth/challenge/:wallet` で challenge message を取得し、署名してヘッダ送信します。

#### 署名フロー仕様

- challenge取得時に `action` クエリを付与します（例: `POST /positions`）。
- サーバは固定テンプレートのメッセージを返します。

```txt
Coin Pool Authentication
Wallet:<wallet>
Nonce:<nonce>
IssuedAt:<issuedAt-iso8601>
Action:<action>
ChainId:<chainId | none>
```

- クライアントはこの全文字列をそのまま署名します。
- 検証時はテンプレートを厳密にパースし、`wallet` / `nonce` / `issuedAt` / `action` を照合します。
- `chainId` を含める場合は、メッセージとヘッダ/ボディの `chainId` 一致を検証します。
- `action` は実際のリクエスト（`METHOD + path`）と一致する必要があります。
- nonce は署名検証成功後に consume され、リプレイを防止します。
- challenge store は現在 in-memory 実装です（`apps/api/src/auth/challenge-store.ts`）。
- ストアキーは `wallet + nonce` のため、同一walletで複数challengeを同時保持できます。
- 現状は単一インスタンス前提です。マルチインスタンス運用では Redis など共有ストア化が必要です。
- `ChallengeStore` interface を導入しており、将来的な Redis 実装へ差し替えやすい構造です。
- Redis 実装雛形は `apps/api/src/auth/challenge-store.redis.ts` にあります（`RedisLikeClient` アダプタ方式）。
- `CHALLENGE_STORE_BACKEND=redis` では API 起動時に Redis ストアへ切り替わります（`REDIS_URL` 必須）。
- Redis バックエンド利用時は `redis` パッケージが必要です（例: `npm install redis -w apps/api`）。
- ローカル開発では `.env` に `CHALLENGE_STORE_BACKEND=redis` と `REDIS_URL=redis://localhost:6379` を設定し、`docker compose up -d` でRedisを起動してください。
- `GET /health` では `challengeStoreBackend` と `challengeTtlMs` を返し、現在の認証ストア設定を確認できます。

## 環境変数

- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_DEFAULT_CHAIN_ID`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`
- `NEXT_PUBLIC_RPC_URL_ARBITRUM`
- `NEXT_PUBLIC_RPC_URL_ETHEREUM`
- `NEXT_PUBLIC_RPC_URL_BASE`
- `NEXT_PUBLIC_RPC_URL_POLYGON`
- `PORT`
- `DATABASE_URL`
- `ALLOWED_CHAIN_IDS`
- `MAX_SLIPPAGE_BPS`
- `CHALLENGE_TTL_MS`
- `CHALLENGE_STORE_BACKEND` (`memory` or `redis`)
- `REDIS_URL`
- `REDIS_SNAPSHOT_CACHE_ENABLED` (`true` / `false`, default `false`) - マルチインスタンス時、pool snapshot を Redis で共有
- `AUTOMATION_EXECUTION_ENABLED` (`true` / `false`, default `false`)
- `AUTOMATION_MIN_NET_BENEFIT_USD` (guarded execute threshold)
- `AUTOMATION_AUTO_COMPOUND_ENABLED` (`true` / `false`, default `false`)
- `AUTOMATION_MIN_COMPOUND_FEES_USD` (auto-compound candidate threshold)
- `AUTOMATION_DAEMON_ENABLED` (`true` / `false`, default `false`)
- `AUTOMATION_DAEMON_INTERVAL_MS` (daemon tick interval, default `15000`)
- `AUTOMATION_DAEMON_MAX_WALLETS_PER_TICK` (default `20`)
- `AUTOMATION_DAEMON_MAX_JOBS_PER_WALLET` (default `5`)
- `AUTOMATION_DAEMON_RETRY_FAILED_LIMIT` (default `0`)
- `AUTOMATION_DAEMON_SNAPSHOT_REFRESH_BEFORE_EVALUATE` (`true` / `false`, default `false`) — evaluate 前に sync で snapshot を更新
- `AUTOMATION_RELAYER_ENABLED` (`true` / `false`, default `false`)
- `AUTOMATION_RELAYER_URL` (relayer endpoint URL)
- `AUTOMATION_RELAYER_API_KEY` (optional header `x-api-key`)
- `AUTOMATION_RELAYER_TIMEOUT_MS` (default `10000`)
- `AUTOMATION_RELAYER_WAIT_CONFIRMATION` (`true` / `false`, default `false`)
- `AUTOMATION_TX_CONFIRM_TIMEOUT_MS` (default `120000`)
- `AUTOMATION_AUDIT_RETENTION_DAYS` (default `30`)
- `AUTOMATION_AUDIT_CLEANUP_INTERVAL_MS` (default `21600000`)
- `AUTOMATION_AUDIT_CLEANUP_BATCH` (default `5000`)
- `AUTOMATION_EXECUTOR_ADDRESS_ARBITRUM` (worker rebalance/compound txRequest の送信先コントラクト)
- `AUTOMATION_EXECUTOR_ADDRESS_MAINNET`
- `AUTOMATION_EXECUTOR_ADDRESS_BASE`
- `AUTOMATION_EXECUTOR_ADDRESS_POLYGON`
- `ARBITRUM_RPC_URL`
- `MAINNET_RPC_URL`
- `BASE_RPC_URL`
- `POLYGON_RPC_URL`

## Adapter実装状況（重要）

`UniswapV3Adapter` は次の形に分離済みです。

- `prepareCreatePosition`: target contract / calldata / value / warnings を返す
- `executeCreatePosition`: ウォレット送信フェーズ（EIP-1193 provider経由）
- `fetchPositionNfts`: Position NFT一覧取得（on-chain `balanceOf` + `tokenOfOwnerByIndex` + `positions`）

現在の adapter は安全な統合手順のための土台であり、`fetchPositionNfts` は on-chain read → indexer（`/sync/:wallet/indexed`、署名時）→ API fallback（`/positions/:wallet`）の順で取得します。

## Tick / Price 変換の注意

- `displayPriceToApproxTick` / `displayTickToApproxPrice` は表示向けの近似実装です。
- 実運用での厳密計算は `apps/web/lib/uniswap/price-conversion.ts` の精密変換実装を使用してください。

## 実行処理の段階実装範囲

- `fetchPositionNfts` は on-chain read 実装済みです（indexer / API fallback あり）。
- 一部の周辺ロジックは段階実装中のため、本番資金での即時運用は推奨しません。
- `GET /positions/:wallet` は保存済みポジションを live pool state で補完して返します。
- `GET /positions/:wallet` は `savedStatus`（DB保存値）と `computedStatus`（`currentTick` と range から算出）を返します。
- `GET /positions/:wallet` の `currentTick / currentPrice` は pool `slot0()` からライブ取得します（取得失敗時は部分フォールバック）。
- `GET /positions/:wallet` の `uncollectedFeesUsd / valueUsd / estimatedApr` は estimated ベースで返却されます。
- `isPlaceholderMetrics` / `isPlaceholderValuation` / `isPlaceholderYieldMetrics` は明示的に `status === "placeholder"` のときのみ true になります。
- Pool read は `chainId + poolAddress` 単位で deduplicate されます。
- Pool/token decimals read は可能な範囲で multicall を使用します。
- Live pool snapshot は短時間 TTL で cross-request cache されます（成功結果のみ）。
- `GET /dashboard/:wallet` の `estimatedFeesEarned / estimatedApr / estimatedPositionPnlUsd / totalValue` は estimated 指標です。
- `ethPrice` は Chainlink 取得失敗時に `null` を返し、UIでは `price unavailable` と表示します。
- `poolAddress` は create position 保存時に、Uniswap V3 Factory `getPool(token0, token1, fee)` で on-chain 取得します。
- `poolAddress` は Uniswap V3 Factory 経由の on-chain read で導出されます（`UniswapV3Factory.getPool`）。
- mint 最終利用 tick は fee-tier の tick spacing に基づいて正規化されます（lower は切り下げ、upper は切り上げ）。
- Positions API enriches saved positions with live pool state.
- Data sources:
  - pool.slot0() -> currentTick
  - sqrtPriceX96 -> price
  - token decimals -> price normalization
- Failure tolerance:
  - If pool reads fail, the API returns a fallback snapshot instead of failing the entire request.
- same pool reads are deduplicated by `chainId + poolAddress`.
- multicall is used where possible for pool/token reads.
- short-lived live snapshot cache is used for performance.
- graceful fallback is preserved.
- route observability:
  - `positions_invalid_wallet_param` (invalid wallet path)
  - `position_not_found` (detail/strategy/preview not found)
  - `position_strategy_read_cache_hit` / `position_strategy_read_cache_miss`
  - `position_history_fallback_empty` (snapshot table unavailable fallback)
  - counters are tracked via `services/observability/positions-observability.ts`
  - analytics pipeline phases are logged via `onchainReadDurationMs` / `referencePriceReadDurationMs` / `liveEnrichDurationMs` / `analyticsComputeDurationMs`
  - strategy payload/preview/gas estimate helper is extracted to `services/position-strategy-response.ts`
  - strategy recommendation build path is extracted to `services/position-strategy-recommendation.ts`
  - positions analytics row build path is extracted to `services/position-analytics-row-builder.ts`
  - route latency summary (`count` / `p50` / `p95` / `p99` / `max`) is tracked via `services/observability/route-latency-observability.ts`
  - latency summary is now emitted across positions/sync/automation/auth/settings/activity/market routes
  - route outcome summary (`success2xx` / `client4xx` / `server5xx` / `errorRate`) is tracked via `services/observability/route-outcome-observability.ts`

Future architecture plan:
- Redis cache for cross-instance snapshot/token metadata sharing（`RedisPoolSnapshotCache` 実装済み、`apps/api/src/services/cache/redis-pool-snapshot-cache.ts`）
- worker-based snapshot refresh pipeline（`AUTOMATION_DAEMON_SNAPSHOT_REFRESH_BEFORE_EVALUATE=true` で evaluate 前に sync 実行）
- indexer-based position/event tracking（`PositionNftSource` / `IndexerPositionNftSource` 実装済み、adapter に注入可能）

## LP Analytics Architecture

The API separates LP analytics into three state domains:

- Saved state (DB): position metadata, range, savedStatus
- Live state (RPC/cache): currentTick/currentPrice/sqrtPriceX96/liquidity/snapshotUpdatedAt/stale/source
- Analytics state (service): estimated value, PnL, APR, ROI, net return, IL, fee estimate status

Exact / estimated / placeholder policy:

- Exact:
  - currentTick from `pool.slot0().tick`
- Estimated:
  - currentPrice from `sqrtPriceX96` + decimals normalization
  - token amounts from liquidity math when liquidity is available
  - APR/ROI/net return/IL as model-based estimates
- Placeholder:
  - 必要データ不足時にのみ明示的に返却されます（通常パスは estimated / exact）

## Phase 1 Sync Foundation

Phase 1 introduces a minimal, additive sync layer for on-chain position truth.

- New API routes:
  - `GET /sync/:wallet` (signed sync status by chain)
  - `GET /sync/:wallet/overview?chainId=<id>` (signed unified sync + indexing overview)
  - `POST /sync/:wallet` (signed manual sync execution)
  - `GET /sync/:wallet/indexed?chainId=<id>` (signed indexed NFT positions + local match coverage)
  - `/sync/:wallet/overview` は短TTLサーバーキャッシュ（wallet+chain）を使用し、`POST /sync` 後に対象キーを無効化
  - sync overview cache は `services/cache/sync-overview-cache.ts` で抽象化（将来 Redis へ差し替え可能）
  - observability: `/sync/:wallet/overview` は `cacheHit/cacheMiss/elapsedMs` を構造化ログ出力（`services/observability/sync-observability.ts`）
  - observability: operator permission read cache hit/miss/invalidate は `services/observability/operator-permission-observability.ts` で計測し、`/sync` と `/automation` のログに連携
  - observability: owner/operator 認可拒否は `sync_authorization_denied` / `automation_authorization_denied` イベントで理由（reason）を記録
  - observability: 認可拒否カウンタは `services/observability/authorization-observability.ts` で管理
  - `GET /automation/config` (worker guarded execution config)
  - `POST /automation/evaluate` (signed worker evaluation trigger)
  - `GET /automation/operators/:ownerWallet` (signed operator permission list)
  - `POST /automation/operators` (signed owner-managed operator permission upsert)
- New persistence:
  - `Position.syncStatus`
  - `Position.lastSyncAttemptAt`
  - `Position.lastSyncSuccessAt`
  - `Position.lastSyncError`
  - `OnchainPositionState` table for chain-derived position state
- Existing routes remain compatible:
  - `/positions` responses are backward compatible
  - sync metadata is additive (`sync` / `syncMetadata` optional fields)

### Source of Truth Policy

- Chain source of truth:
  - NFT ownership / tokenId discovery
  - position manager `positions(tokenId)` fields (liquidity, owed tokens, ticks)
  - persisted in `OnchainPositionState`
- Derived analytics:
  - value / fees / APR / IL are computed layers and may be estimated/placeholder
  - persisted/served separately from raw chain state

### Graceful Fallback Policy (Sync)

- Sync never hard-fails the whole wallet if only part of reads fail.
- Outcomes:
  - `SUCCESS`: no errors
  - `PARTIAL`: some data synced, some failed
  - `ERROR`: no usable sync result
- Fallback snapshots are not persisted as chain-truth snapshots.
- Structured logs are emitted for:
  - per-step sync errors (`step`, `tokenId`, `chainId`, `wallet`)
  - request-level sync summary and timing

Formula notes:

- Current price:
  - `price(token1/token0) = (sqrtPriceX96^2 / 2^192) * 10^(decimals0 - decimals1)`
- Liquidity math:
  - piecewise token0/token1 amount calculation by currentTick vs [tickLower, tickUpper)
- IL estimation:
  - currently estimated from reference/current price ratio (constant product benchmark approximation)
  - mint-time baseline integration uses earliest available snapshot reference price
- APR estimation:
  - ROI is annualized by holding period (`createdAt -> now`)
  - APY is additionally derived with compounded annualization when ROI is valid
  - still estimate-based and non-guaranteed

Current limitations:

- Fee analytics combines exact `tokensOwed0/1` conversion and heuristic fallback estimation when on-chain owed tokens are unavailable
- `PositionSnapshot` history route depends on DB migration (`PositionSnapshot` table)
- Token price provider currently prioritizes WETH/USDC support

## LP Auto-Strategy Engine (Rule-based AI)

Coin Pool は単純な「レンジ外れたら同幅再設定」から、以下の戦略エンジンへ拡張されています。

- Strategy layers
  - `MarketStateDetector`: 市場状態（`RANGE` / `UP_TREND` / `DOWN_TREND` / `HIGH_VOLATILITY` / `LOW_LIQUIDITY` / `UNKNOWN`）を判定
  - `RangeProposalEngine`: 市場状態とモードに応じて中心・幅・tickレンジを提案
  - `RebalanceDecisionEngine`: 期待利益 vs ガスコスト・cooldown・危険条件で実行可否を判定
  - `RangeStrategyEngine`: 上記を統合して説明可能な最終提案を返却

- Strategy modes
  - `CONSERVATIVE`: 広めレンジ、低頻度、ガス節約優先
  - `BALANCED`: 標準バランス
  - `AGGRESSIVE`: 狭めレンジ、高頻度、fee最大化寄り

- API
  - `GET /positions/:wallet/:positionId/strategy`
  - `POST /positions/:wallet/:positionId/rebalance-preview`
  - 返却: 市場状態、推奨レンジ、`shouldRebalance`、`urgency`、期待利益、推定ガス、純期待利益、説明文

- Explainability
  - 出力には `rationale` と `explanationLines` を含めます。
  - 例: "High volatility detected, widening range", "Rebalance skipped because expected net benefit is negative"

- Safety rules
  - unsupported feeTier reject
  - invalid pool / invalid range reject
  - excessively narrow range reject
  - cooldown中は原則hold（大きなレンジ逸脱は例外）
  - gas > expected benefit は hold/reject
  - stale snapshot は confidence 低下
  - live data不足は `UNKNOWN` + conservative fallback

- Exact / estimated / heuristic 区分
  - exact: on-chain `currentTick`
  - estimated: analytics値（value/APR/IL など）
  - heuristic: market state / range proposal / rebalance decision

- Snapshot / Store / Worker拡張前提
  - `PoolMarketSnapshot` テーブルを導入（時系列 market snapshot）
  - `StrategyStateStore`, `PoolMarketSnapshotStore`, `StrategyRecommendationCache` を interface 化
  - `StrategyEvaluationWorker`, `AutoRebalanceScheduler`, `RebalanceExecutionPolicy` に guarded execute パイプラインを導入（デフォルトは dry-run / execution disabled）
  - worker実行時は queue-backed executor を通じて `AutomationJob` を enqueue し、実行結果を `AutomationExecution` に記録
  - worker は position 単位で失敗分離し、partial failure でも他ポジション評価を継続
  - `POST /automation/evaluate` で手動トリガー可能（署名必須）
  - `AUTOMATION_EXECUTION_ENABLED=true` かつ net benefit が閾値以上の場合のみ guarded execute 判定に進む
  - `POST /automation/execute` の `payload.txRequest` があり、かつ `AUTOMATION_RELAYER_ENABLED=true` の場合は relayer 経由で `TX_SUBMITTED/TX_CONFIRMED` を記録
  - strategy worker の queue-backed executor は chain別 `AUTOMATION_EXECUTOR_ADDRESS_*` がある場合、自動で `payload.txRequest` を生成
  - auto-compounding は `AUTOMATION_AUTO_COMPOUND_ENABLED=true` かつ `estimatedFeesUsd >= AUTOMATION_MIN_COMPOUND_FEES_USD` のとき候補判定
  - owner/operator separation: owner は operator を許可し、`canEvaluate` / `canExecute` を分離管理
  - sync/indexing では owner 署名に加えて許可済み operator (`canEvaluate`) も実行可能
  - owner/operator 認可判定は `services/auth/wallet-authorization.ts` で共通化（`/sync` と `/automation` で同一ルール）
  - wallet address 正規化は `services/auth/wallet-authorization.ts` を利用し、`/positions` `/sync` `/automation` で統一
  - 永続ストア実装は `services/store/operator-permission-store.ts` (`PrismaOperatorPermissionStore`) に分離
  - operator permission read path は短TTL read cache を利用（`services/cache/operator-permission-cache.ts`）
  - operator permission cache hit/miss/invalidate は `services/observability/operator-permission-observability.ts` で計測
  - 将来は Redis / queue / indexer へ差し替え可能

## Product UX Overview (LP Operating System)

Coin Pool は「作成/再設定ツール」から、運用判断まで含む LP運用OS へ拡張されています。

- Command Center (`/`)
  - 今日やるべきアクション、市場状態、自動化状況を集約表示
- My Positions (`/my-positions`)
  - フィルタ/ソート、戦略判定、Collect、Review & Execute、詳細画面遷移
- Position Detail (`/positions/[positionId]`)
  - Current State / Composition / Analytics / Strategy / History / Safety を一画面で診断
- Strategy Lab (`/strategy-lab`)
  - Conservative/Balanced/Aggressive 比較、幅/閾値シミュレーションの土台
- Automation Center (`/automation`)
  - Manual / Semi-Auto / Auto と安全閾値を管理
- Portfolio (`/portfolio`)
  - 全体エクスポージャ・リスク・収益・最適化示唆
- Activity (`/activity`)
  - 監査トレイル（type/source/tx/position/time/success/error）

### Screen Roles (Action / Decision / Operation)

- Command Center:
  - 今日の優先アクションを最上段で提示（rebalance/collect/stale/negative-net）
  - 市場状態と自動化状態を横断で確認
- My Positions:
  - 日次運用の判断画面。フィルタ/ソート、戦略判定、実行導線を1テーブルへ統合
  - bulk insight（件数/価値/stale/negative-net）を表示
- Position Detail:
  - 個別ポジションの診断画面
  - Current State / Analytics / Strategy / Why / Range / Cost / Safety / History を分離表示
- Strategy Lab:
  - Conservative/Balanced/Aggressive を比較
  - 幅・閾値・ガス負担の試算UI + snapshot historyベースの簡易バックテスト表示
- Automation Center:
  - Manual/Semi-Auto/Auto 設定と安全装置を同時表示
  - stale reject / min net / cooldown / gas上限を明示
- Portfolio:
  - 全体最適画面。集中リスク・ボラ暴露・収益性・最適化提案を表示
- Activity / Audit:
  - 監査画面。何が起きたか、どの品質情報かを追跡

### Product UX Principles

- Action first
- Explainability first
- Safety first
- Freshness visible
- Data quality visible
- Do not over-promise
- `shouldRebalance = false` を尊重
- `netExpectedBenefitUsd < 0` は強警告

### Explainability policy

戦略提案は必ず以下を表示します。

- `rationale`
- `explanationLines`
- `confidence`
- stale warning

### State freshness policy

- snapshot updated at
- stale/fresh
- analytics source
- live state source
- quality/source/generatedAt/stale は可能な限り API レスポンスを source of truth とし、フロント側推論は最小化

### Exact / Estimated / Heuristic / Placeholder

- exact: on-chainで直接読める指標（例: currentTick）
- estimated: モデル/補助データによる推定
- heuristic: ルールベース意思決定（戦略提案）
- placeholder: 入力不足や安全フォールバック時の明示

UI上も可能な範囲でラベル表示し、誤認を防止します。

### API-driven quality/freshness

以下のAPIは `quality / source / generatedAt / stale` を返します。

- `GET /activity/:wallet`
- `GET /positions/:wallet/:positionId/strategy`
- `POST /positions/:wallet/:positionId/rebalance-preview`
- `GET /dashboard/:wallet`
- `GET /portfolio/:wallet`

フロントエンドはこれらを表示専用として利用し、`infer` ロジック依存を減らしています。

## 実装済み項目（現時点）

- on-chain position fetching（reader/adapters）
- on-chain position indexing（sync/indexed/overview routes）
- poolAddress derivation（Uniswap V3 Factory `getPool`）
- fee estimation（exact `tokensOwed0/1` + heuristic fallback）
- APR estimation（holding period annualization + APY）
- live tick/range validation（savedStatus + computedStatus 分離）

## Data Layer Structure (Final Shape)

本プロダクトは状態を以下の層に分離します。

- Saved State
  - DB保存状態（position metadata / range / savedStatus）
- Live State
  - `currentTick` / `currentPrice` / `snapshotUpdatedAt` / `source` / `stale`
- Analytics State
  - `estimatedValueUsd` / `estimatedFeesUsd` / `estimatedPnlUsd` / `estimatedApr` / `estimatedRoi`
  - `estimatedImpermanentLossUsd` / `estimatedImpermanentLossPercent`
- Strategy State
  - `marketState` / `strategyMode` / `shouldRebalance` / `urgency`
  - proposed range / expected gas / expected benefit / net expected benefit / confidence / explanation lines
- Execution State
  - approvals / tx hashes / execution results / failures

フロント型定義: `apps/web/lib/domain/state-layers.ts`

## Runtime Interfaces (Redis/Worker/Indexer Ready)

`apps/api/src/services/analytics-interfaces.ts` に以下の interface を定義済みです。

- `PoolSnapshotCache`
- `TokenMetadataCache`
- `PositionAnalyticsCache`
- `StrategyRecommendationCache`
- `PositionSnapshotRefresher`
- `StrategyEvaluationWorker`
- `PositionEventIndexer`

現在は in-process 実装を提供し、将来 Redis / queue / indexer へ差し替えます。

## API / State / Refetch Flow

- Command Center
  - API: `/dashboard/:wallet`, `/positions/:wallet`, strategy summary
  - local state: 集計済みアクション件数
  - refetch: collect/rebalance 完了後に positions/dashboard を再取得
- My Positions
  - API: `/positions/:wallet`, `/positions/:wallet/:positionId/strategy`, `/positions/:wallet/:positionId/rebalance-preview`
  - local state: filter/sort/selected mode/preview cache/modal open
  - refetch: collect/rebalance 成功後に positions を再取得
- Position Detail
  - API: `/positions/:wallet/:positionId`, `/positions/:wallet/:positionId/history`, `/activity/:wallet`
  - view: Action History の tx は `chainId` ベースで explorer リンク表示
  - local state: 画面内セクション表示/strategy summary
  - refetch: 実行成功後に detail/history/activity を再取得
- Strategy Lab
  - API: rebalance preview (3mode parallel)
  - local state: selected position / width / threshold / gas simulation
  - refetch: position切替・再比較ボタンで更新
- Automation
  - API: `/automation/config`, `/automation/evaluate`, `/automation/operators`（署名必須）
  - local state: mode/safety params + latest worker feedback message
  - view: `/activity/:wallet` の `source=worker` を再利用して直近 worker 履歴を表示
  - runtime: guarded rebalance / auto-compound toggle と閾値を表示
  - owner/operator: target owner wallet を指定して evaluate 可能（operator 許可前提）
  - operator management: Automation画面から `Load Permissions` / `Save Permission` で `canEvaluate` / `canExecute` / `active` を更新
  - quick actions: operator一覧から `Edit in Form` / `Enable` / `Disable` を直接実行可能
  - operator list UX: search と `show inactive` フィルタで表示件数を制御
  - inline toggles: operator 行で `canEvaluate` / `canExecute` をワンクリック更新
  - safety confirm: `canExecute` OFF→ON と `Disable operator` は共通モーダル（`ConfirmDangerActionModal`）で確認
  - sync visibility: `/sync/:wallet/overview` を利用し、status / indexed / matched / unmatched を一括可視化（旧分割フックは廃止）
  - signed view UX: 署名付きGETは `staleTime=60s` + `refetchOnWindowFocus=false`、初回は `Load Signed Views` で明示取得
  - refetch: worker evaluate 後に positions/dashboard/portfolio/activity を再取得
- Portfolio
  - API: `/portfolio/:wallet`
  - local state: risk suggestions の派生計算
  - refetch: positions/strategy 状態更新後に再取得
- Activity
  - API: `/activity/:wallet`
  - local state: filter
  - view: `chainId + tx` がある行は explorer への外部リンクを表示（`/activity`, `/automation`, Position Detail）
  - timestamp: `TimestampWithAge` を共通利用（mobile は `compact`、`ja-JP` ロケール + 日本語相対表現）
  - refetch: execute/create/collect/rebalance 後に再取得

## Future Roadmap (Redis / Worker / Indexer)

- Redis:
  - ~~cross-request snapshot cache共有~~ **実装済み**（`REDIS_SNAPSHOT_CACHE_ENABLED` + `REDIS_URL`）
  - strategy recommendation cache共有
  - distributed lock（wallet/job単位）
- Worker:
  - strategy periodic evaluation（daemon で一部実装）
  - ~~snapshot refresh pipeline~~ **実装済み**（`AUTOMATION_DAEMON_SNAPSHOT_REFRESH_BEFORE_EVALUATE`）
  - auto action scheduler with cooldown/safety policy
- Indexer:
  - on-chain position/event indexing（sync/indexed で一部実装）
  - historical backtest materialization
  - audit-grade event normalization

## Migration案

- `apps/api/prisma/MIGRATION_PLAN.md` に、`Position` テーブルの分離移行案を記載しています。現行 schema は既に `token0Address/token1Address/token0Symbol/token1Symbol` を採用済みです。

## 資金操作前の必須確認

- 本番資金を扱う前に、必ず少額で end-to-end テストを実施してください。
- approve先コントラクト、チェーンID、スリッページ、受取アドレスを毎回確認してください。

## Exact Approval Policy

- Approve は `exact approve only` です（無制限 approve は使用しません）。
- no unlimited approve（常に必要量のみ approve）を徹底します。
- allowance が不足しているトークンに対してのみ approve を送信します。
- approve spender は chain別 allowlist（Position Manager）に一致する場合のみ許可します。
- WETH / USDC は個別に approve 成否を扱い、部分成功（片方成功・片方失敗）を UI に表示します。
- 部分失敗時は token別の `txHash` と `errorMessage` を表示し、失敗トークンのみ再approveできる前提で扱います。
- exact approve のため、入力数量が変わると追加 approve が再度必要になる場合があります。
- decimal / numeric string のバリデーションは `@lp-manager/shared` の zod schema を Web/API で共通利用しています。

## テスト

- `npm run test -w apps/web`
  - tick計算
  - range計算
  - APR計算
- `npm run test -w apps/api`
  - API validation
  - settings validation

### Shared Schema 動作確認

`@lp-manager/shared` を導入した後は、以下の順で検証してください。

1. 依存解決（workspace 全体）
   - `npm install`
2. 1コマンド検証（推奨）
   - `npm run verify:shared`
3. 個別実行する場合
   - `npm run build -w apps/web`
   - `npm run build -w apps/api`
   - `npm run test -w apps/web`
   - `npm run test -w apps/api`

上記で、Web と API の両方が `@lp-manager/shared` の zod schema を参照して問題なく解決できることを確認できます。

## 免責

This tool helps manage liquidity positions.  
It does not provide financial advice.  
You may lose part or all of your funds.  
Use at your own risk.

## 運用引き継ぎガイド

運用担当者・引き継ぎ先向けの手順と注意点です。

### 起動・停止

| 操作 | コマンド |
|------|----------|
| DB・Redis 起動 | `docker compose -p lpmanager up -d` |
| DB・Redis 停止 | `docker compose -p lpmanager down` |
| Prisma マイグレーション | `npm run prisma:migrate -w apps/api` |
| API 起動 | `npm run dev:api` |
| Web 起動 | `npm run dev:web` |

**Windows での注意**: ワークスペースパスに日本語（例: デスクトップ）が含まれる場合、`docker compose` がプロジェクト名を空と解釈してエラーになることがあります。その場合は `-p lpmanager` を必ず指定してください。

### 必須環境変数（最小セット）

- `DATABASE_URL`: PostgreSQL 接続文字列
- `NEXT_PUBLIC_API_BASE_URL`: フロントから参照する API の URL
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`: WalletConnect 用
- 各チェーンの RPC URL（`NEXT_PUBLIC_RPC_URL_ARBITRUM` など）

本番運用時は「環境変数」セクションの一覧を参照し、automation / relayer / daemon 関連も適宜設定してください。

### 権限モデル（Owner / Operator）

- **Owner**: ポジション所有者。全操作が可能。
- **Operator**: Owner が許可したウォレット。権限は `canEvaluate` / `canExecute` / `canPause` / `canChangeStrategy` で個別に付与。
- 認可ロジックは `apps/api/src/services/auth/wallet-authorization.ts` に集約。
- Automation Center の「Load Permissions」で operator 一覧を取得し、権限を編集できます。

### トラブルシューティング

| 現象 | 確認・対処 |
|------|------------|
| `P1001: Can't reach database server` | PostgreSQL コンテナが起動しているか確認。`docker ps` で `lp-manager-postgres` を確認。 |
| `project name must not be empty` | `docker compose -p lpmanager up -d` のように `-p` でプロジェクト名を指定。 |
| `Conflict. The container name ... is already in use` | `docker rm -f lp-manager-redis lp-manager-postgres` で既存コンテナを削除してから再起動。 |
| 署名付き API が 401/403 | `GET /auth/challenge/:wallet` で challenge を取得し、同じ `action` で署名しているか確認。nonce の有効期限（`CHALLENGE_TTL_MS`）内か確認。 |
| マルチインスタンスで challenge が無効 | `CHALLENGE_STORE_BACKEND=redis` と `REDIS_URL` を設定し、Redis を起動。 |

### 監視・ログ

- **ヘルス**: `GET /health` で `challengeStoreBackend` / `redisSnapshotCacheEnabled` / automation 設定を確認。
- **Daemon tick 監査**: `GET /automation/daemon/ticks` で worker の実行履歴を確認。
- **Worker ヘルス**: `GET /automation/worker/health` で稼働状況を確認。
- **メトリクス**: `GET /automation/metrics` で失敗率・トレンド・アラート閾値を確認。
- **監査ログ**: Activity 画面（`/activity`）および `GET /activity/:wallet` で on-chain イベントと worker アクションを追跡。

### ローカルストレージ・UI 設定

フロントエンドは `localStorage` で UI 設定を永続化します。

- コンテキストバナー折りたたみ、ショートカットヘルプの「? ボタン非表示」など
- キーボードショートカット `?` でヘルプを開き、「Reset all UI preferences」で一括リセット可能
- デバッグ時は `NODE_ENV !== "production"` で `localStorage` 更新イベントが `console.debug` に出力される
- キー定義: `apps/web/lib/ui-preference-keys.ts`、`apps/web/lib/local-data-keys.ts`
- ショートカット定義: `apps/web/lib/keyboard-shortcuts.ts`

### リダイレクト

- `/activity-log` → `/activity`（301、後方互換のため `next.config.js` で設定）

### 関連ドキュメント

- `docs/pre-production-checklist-ja.md`: 本番投入前チェックリスト
- `docs/e2e-validation-checklist-ja.md`: E2E 確認手順
- `docs/e2e-result-template-ja.md`: E2E 結果テンプレート
- `apps/api/prisma/MIGRATION_PLAN.md`: DB マイグレーション案

## 将来拡張

- Auto rebalance bot
- MLベースの market state detector / policy optimizer
- Multi pool
- Strategy marketplace
- Performance analytics
- Yield comparison
