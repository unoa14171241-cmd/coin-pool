# Render.com デプロイ手順

## 問題の原因

Render が **Python** プロジェクトと誤検知していました。LP Manager は **Node.js** プロジェクトです。

## 解決方法

### 1. render.yaml をプッシュ

`render.yaml` を GitHub にコミット・プッシュしてください：

```bash
git add render.yaml RENDER_DEPLOY.md
git commit -m "Add Render deployment config (Node.js)"
git push origin main
```

### 2. Render Dashboard での設定

**Blueprint を使う場合（推奨）**
- ダッシュボードで「New」→「Blueprint」
- リポジトリを選択
- `render.yaml` が自動読み込みされ、Node.js でビルドされます

**既存サービスを編集する場合**
- 対象サービス → Settings
- **Environment**: `Node` に変更（Python になっていないか確認）
- **Build Command**:  
  `npm install && cd apps/api && npx prisma generate && npm run build -w apps/api`
- **Start Command**:  
  `npm run start -w apps/api`
- **Pre-Deploy Command**（必須・render.yaml に含む）:  
  `npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma`  
  ※ 初回デプロイ前に `prisma/migrations/` をコミットしておくこと。マイグレーションが無いと本番DBにテーブルが作成されず `Position` テーブル不存在エラーが発生します。

### 3. 必須環境変数

Render Dashboard の Environment で以下を設定：

| 変数 | 必須 | 説明 |
|------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 接続文字列（Render Postgres 作成時に自動設定可） |
| `PLATFORM_WALLET` | ✅ | 例: `0x...`（オーナーウォレット） |
| `ARBITRUM_RPC_URL` | 推奨 | Arbitrum RPC（Alchemy / Infura 等） |
| `PORT` | - | Render が自動設定（通常は変更不要） |

### 4. データベース

- Render で「PostgreSQL」を新規作成
- 作成後、接続情報を `DATABASE_URL` として API サービスに紐付け

---

**補足**: フロントエンド（Next.js）は Vercel 等でのデプロイを推奨。API のみ Render にデプロイする構成が一般的です。

### 5. Web アプリをインターネットで公開する

API が Render で動いたら、Web アプリを **Vercel** にデプロイすると、どこからでもアクセスできます。

詳細は [`docs/VERCEL_WEB_DEPLOY.md`](docs/VERCEL_WEB_DEPLOY.md) を参照してください。
