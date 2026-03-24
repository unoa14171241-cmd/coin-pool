# Web アプリ（Next.js）の Vercel デプロイ手順

API が Render で動いている場合、Web フロントエンドを **Vercel** にデプロイすると、どこからでもアクセスできます。

## 「開けない」「アクセスできない」場合の修正手順

URL にアクセスできない場合は、**Root Directory** が誤っている可能性が高いです。以下を実行してください。

1. Vercel ダッシュボードで **coin-pool-api** プロジェクトを開く
2. 上部メニュー **Settings** をクリック
3. 左側 **General** を選択
4. **Root Directory** の右にある **Edit** をクリック
5. 入力欄に `apps/web` と入力し、**Save** をクリック
6. 上部メニュー **Deployments** に移動
7. 最新のデプロイの **⋯** メニュー → **Redeploy** をクリック
8. 再デプロイ完了後、URL に再度アクセスする

---

## 1. Vercel にプロジェクトを追加（新規の場合）

1. [vercel.com](https://vercel.com) にログイン（GitHub アカウントで連携が簡単）
2. **Add New** → **Project**
3. GitHub リポジトリ `unoa14171241-cmd/coin-pool` を選択
4. **Import** をクリック

## 2. ビルド設定

Vercel がモノレポを認識するため、次のように設定します：

| 設定項目 | 値 |
|----------|-----|
| **Framework Preset** | Next.js（自動検出） |
| **Root Directory** | `apps/web` |
| **Build Command** | `npm run build`（ルートの `cd apps/web && npm run build` でも可。Vercel が apps/web をルートにすれば `next build` が自動実行） |
| **Output Directory** | 空欄（Next.js デフォルト） |

※ Root Directory を `apps/web` にすると、Vercel は `apps/web` をプロジェクトルートとして扱い、`npm run build` で `next build` が実行されます。

**モノレポでビルドエラーになる場合**（`@lp-manager/shared` が見つからない等）は、以下を試してください：
- **Root Directory**: 空欄（プロジェクトルート）
- **Build Command**: `npm install && npm run build -w apps/web`
- **Output Directory**: `apps/web/.next`
- **Install Command**: （空欄のまま＝デフォルトの `npm install`）

## 3. 環境変数（必須）

**Environment Variables** で以下を追加：

| 変数名 | 値 | 説明 |
|--------|-----|------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://coin-pool-jghf.onrender.com` | Render の API URL |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | （WalletConnect ダッシュボードで取得） | ウォレット接続用 |
| `NEXT_PUBLIC_DEFAULT_CHAIN_ID` | `42161` | Arbitrum デフォルト |
| `NEXT_PUBLIC_RPC_URL_ARBITRUM` | （Alchemy / Infura 等の RPC URL） | Arbitrum RPC |
| `NEXT_PUBLIC_RPC_URL_ETHEREUM` | （同上） | Ethereum Mainnet RPC |

最低限 `NEXT_PUBLIC_API_BASE_URL` を設定しないと API に接続できません。

## 4. デプロイ

**Deploy** をクリック。数分で完了し、`https://your-project.vercel.app` のような URL が発行されます。

## 結果

- **API**: `https://coin-pool-jghf.onrender.com`（Render）
- **Web**: `https://xxx.vercel.app`（Vercel）

ブラウザで Web の URL を開けば、ダッシュボードがどこからでも利用できます。
