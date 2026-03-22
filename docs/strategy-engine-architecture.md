# LP 戦略エンジン アーキテクチャ設計

## 1. アーキテクチャ設計

### 責務分離

| コンポーネント | 責務 | 既存/新規 |
|----------------|------|-----------|
| **PairClassifier** | ペアを VOLATILE / STABLE に分類 | 新規 |
| **PairSelector** | 戦略モードに応じたペア選定（新規ポジション作成時） | 新規 |
| **IlFeeEvaluator** | IL vs 手数料の比較判定 | 新規 |
| **RangeProposalEngine** | レンジ幅の提案（VOLATILE/STABLE 分岐、ボラティリティ対応） | 拡張 |
| **RebalanceDecisionEngine** | リバランス実行判定（IL vs fee 考慮追加） | 拡張 |
| **StrategyEngine** | 全体オーケストレーション | 拡張 |

### 統合ポイント

```
StrategyEngine.evaluate()
  ├─ classifyPair() → pairClassification
  ├─ RangeProposalEngine.propose({ pairClassification })
  ├─ evaluateIlVsFees() → ilFeeEvaluation
  └─ RebalanceDecisionEngine.decide({ ilFeeEvaluation })
```

---

## 2. 実装ファイル一覧

| ファイル | 内容 |
|----------|------|
| `apps/api/src/services/strategy/pair-classifier.ts` | ペア分類（VOLATILE/STABLE） |
| `apps/api/src/services/strategy/pair-selector.ts` | ペア選定（戦略モード別） |
| `apps/api/src/services/strategy/il-fee-evaluator.ts` | IL vs 手数料評価 |
| `apps/api/src/services/strategy/range-proposal-engine.ts` | レンジ提案（拡張） |
| `apps/api/src/services/strategy/rebalance-decision-engine.ts` | リバランス判定（拡張） |
| `apps/api/src/services/strategy/strategy-engine.ts` | 戦略エンジン（統合） |
| `apps/api/src/services/strategy/types.ts` | 型定義（PairClassification, IlFeeEvaluationSummary） |

---

## 3. 既存コードへの組み込み

### 変更ファイル

- `apps/api/src/services/position-strategy-recommendation.ts`  
  - context に `token0Symbol`, `token1Symbol` を追加
- `apps/api/src/services/strategy/worker.ts`  
  - context に `token0Symbol`, `token1Symbol` を追加
- `apps/api/src/services/position-strategy-response.ts`  
  - API レスポンスに `ilFeeEvaluation`, `pairClassification` を追加
- `apps/api/src/schemas/position.ts`  
  - `strategyRecommendationSchema` に `ilFeeEvaluation`, `pairClassification` を追加

### フックポイント

- **StrategyEngine.evaluate()**: 評価開始時に classifyPair, evaluateIlVsFees を実行
- **RangeProposalEngine.propose()**: pairClassification でレンジ幅を分岐
- **RebalanceDecisionEngine.decide()**: ilFeeEvaluation で IL > fee 時にリバランスを強化

---

## 4. 不足データ / 外部依存

### 価格データソース

| 用途 | 現状 | 拡張案 |
|------|------|--------|
| 相関係数算出 | 未実装（ヒューリスティックで代替） | PoolMarketSnapshot または外部 API で過去価格を取得し、相関係数を算出 |
| ボラティリティ | PoolMarketSnapshot の currentPrice 時系列から算出 | 既存 `rollingVolatility` を使用 |

### 必要な追加テーブル（オプション）

相関係数を永続化する場合:

```sql
-- 将来拡張用
CREATE TABLE "PoolPairMetadata" (
  "id" TEXT PRIMARY KEY,
  "chainId" INT NOT NULL,
  "poolAddress" TEXT NOT NULL,
  "token0Symbol" TEXT NOT NULL,
  "token1Symbol" TEXT NOT NULL,
  "correlation" FLOAT,
  "classification" TEXT,
  "updatedAt" TIMESTAMP
);
```

現状はトークンシンボルベースのヒューリスティックで動作。

---

## 5. パラメータ制御

### 環境変数

既存の `STRATEGY_MODE_CONFIG` で制御:

- `widthMultiplier`: レンジ幅の倍率
- `volatilitySensitivity`: ボラティリティ感度
- `minimumNetBenefitUsd`: リバランス最小 net benefit

### IL vs Fee 閾値（il-fee-evaluator.ts）

- `feeVsIlRatio >= 1.2` → CONTINUE
- `feeVsIlRatio >= 0.8` → REBALANCE_CONSIDER
- `feeVsIlRatio >= 0.5` → REBALANCE_CONSIDER + EXIT_CONSIDER
- `feeVsIlRatio < 0.5` → EXIT_CONSIDER

---

## 6. テスト観点

1. **PairClassifier**: WETH/USDC → VOLATILE, USDC/USDT → STABLE
2. **IlFeeEvaluator**: fee > IL → CONTINUE, fee < IL → REBALANCE_CONSIDER
3. **RangeProposalEngine**: STABLE 時はレンジ幅が狭くなる
4. **RebalanceDecisionEngine**: ilFeeEvaluation.shouldConsiderExit 時に urgency HIGH
5. **StrategyEngine**: 統合フローで ilFeeEvaluation, pairClassification が返る
