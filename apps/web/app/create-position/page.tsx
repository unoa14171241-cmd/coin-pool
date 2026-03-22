"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { MetricRow } from "@/components/ui/metric-row";
import { SectionHeader } from "@/components/ui/section-header";
import { WarningBox } from "@/components/ui/warning-box";
import { ApprovalExecutionCard, type ApprovalExecutionResult } from "@/components/cards/approval-execution-card";
import { FlowStatusCard } from "@/components/cards/flow-status-card";
import { ExecutionChecklistCard } from "@/components/cards/execution-checklist-card";
import { RANGE_PRESETS, TARGET_PAIR } from "@/lib/constants";
import type { PreparedCreatePositionTx } from "@/lib/adapters/dex-adapter";
import { useUniswapV3Adapter } from "@/hooks/use-uniswap-v3-adapter";
import { useStrategies } from "@/hooks/use-strategies";
import { calculateRangeFromPercent } from "@/lib/range";
import { displayPriceToApproxTick } from "@/lib/uniswap/tick";
import { validateApproveTarget, validateChainId, validateSlippagePercent } from "@/lib/security";
import { getApproveAllowListByChain, POSITION_MANAGER_BY_CHAIN } from "@/lib/contracts";
import { buildExactApprovalPlan, checkApprovalRequirements } from "@/lib/approval";
import { getExplorerTxUrl } from "@/lib/explorer";
import { useAccount, useSignMessage } from "wagmi";

export default function CreatePositionPage() {
  const { chain, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [feeTier, setFeeTier] = useState("500");
  const [preset, setPreset] = useState("Balanced");
  const [centerPrice, setCenterPrice] = useState("3000");
  const [ethAmount, setEthAmount] = useState("0.1");
  const [usdcAmount, setUsdcAmount] = useState("300");
  const [slippage, setSlippage] = useState("0.5");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [preparedTx, setPreparedTx] = useState<PreparedCreatePositionTx | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isCheckingApprovals, setIsCheckingApprovals] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<Awaited<ReturnType<typeof checkApprovalRequirements>> | null>(null);
  const [approvalExecution, setApprovalExecution] = useState<ApprovalExecutionResult | null>(null);
  const [savedPositionId, setSavedPositionId] = useState<string | null>(null);
  const [activityWarning, setActivityWarning] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<Record<FlowStep, FlowStepStatus>>(() => initialFlowStatus());
  const [strategyTemplateId, setStrategyTemplateId] = useState<string>("");

  const strategiesQuery = useStrategies({
    targetChain: chain?.id,
    enabled: true
  });
  const strategies = strategiesQuery.data ?? [];
  const selectedStrategy = strategyTemplateId ? strategies.find((s) => s.strategyId === strategyTemplateId) : null;

  const selected = useMemo(() => {
    if (preset === "__template__" && selectedStrategy) {
      const widthFromRisk: Record<string, number> = { LOW: 20, MEDIUM: 10, HIGH: 5 };
      const widthPercent = widthFromRisk[selectedStrategy.riskLevel] ?? 10;
      return {
        key: "__template__",
        widthPercent,
        description: selectedStrategy.description
      };
    }
    return RANGE_PRESETS.find((r) => r.key === preset) ?? RANGE_PRESETS[1];
  }, [preset, selectedStrategy]);
  const adapter = useUniswapV3Adapter();
  const range = useMemo(() => {
    const p = Number(centerPrice);
    const percent = selected.widthPercent;
    if (!Number.isFinite(p) || p <= 0) return { lowerPrice: 0, upperPrice: 0 };
    return calculateRangeFromPercent(p, percent);
  }, [centerPrice, selected.widthPercent]);
  const approvalPlan = useMemo(() => {
    try {
      if (!chain?.id) return [];
      return buildExactApprovalPlan(chain.id, ethAmount, usdcAmount);
    } catch {
      return [];
    }
  }, [chain?.id, ethAmount, usdcAmount]);
  const approveTarget =
    chain?.id != null ? POSITION_MANAGER_BY_CHAIN[chain.id] : undefined;
  const approxTickLower = Number.isFinite(range.lowerPrice) && range.lowerPrice > 0 ? displayPriceToApproxTick(range.lowerPrice) : 0;
  const approxTickUpper = Number.isFinite(range.upperPrice) && range.upperPrice > 0 ? displayPriceToApproxTick(range.upperPrice) : 0;
  const effectiveFeeTier = selectedStrategy ? selectedStrategy.poolFeeTier : Number(feeTier);
  const explorerUrl = txHash && preparedTx ? getExplorerTxUrl(preparedTx.chainId, txHash) : null;
  const hasMissingApprovals = Boolean(approvalStatus?.some((v) => v.approvalRequired));
  const canProceedWithTemplate = preset !== "__template__" || (preset === "__template__" && !!selectedStrategy);

  return (
    <section className="mx-auto max-w-7xl space-y-6 bg-slate-950 px-6 py-8 text-slate-100">
      <h1 className="text-2xl font-bold">ポジション作成</h1>
      <SectionHeader title="Create Position Flow" description="入力検証→準備→承認→実行→保存の順で安全に進めます。" />

      <div className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="text-xs text-slate-400">ペア</span>
          <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100" value={TARGET_PAIR} readOnly />
        </label>

        <label className="text-sm">
          <span className="text-xs text-slate-400">手数料ティア</span>
          <select
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100"
            value={selectedStrategy ? String(selectedStrategy.poolFeeTier) : feeTier}
            onChange={(e) => setFeeTier(e.target.value)}
            disabled={!!selectedStrategy}
          >
            <option value="100">0.01%</option>
            <option value="500">0.05%</option>
            <option value="3000">0.3%</option>
            <option value="10000">1%</option>
          </select>
          {selectedStrategy && (
            <p className="mt-0.5 text-xs text-slate-500">テンプレートから適用</p>
          )}
        </label>

        <label className="text-sm">
          <span className="text-xs text-slate-400">レンジ選択</span>
          <select
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value !== "__template__") setStrategyTemplateId("");
            }}
          >
            {RANGE_PRESETS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.key}
              </option>
            ))}
            <option value="__template__">Strategy Template (DB)</option>
          </select>
        </label>
        {preset === "__template__" && (
          <label className="text-sm md:col-span-2">
            <span className="text-xs text-slate-400">戦略テンプレート</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100"
              value={strategyTemplateId}
              onChange={(e) => setStrategyTemplateId(e.target.value)}
            >
              <option value="">— テンプレートを選択 —</option>
              {strategies.map((s) => (
                <option key={s.strategyId} value={s.strategyId}>
                  {s.strategyName} ({s.tokenA}/{s.tokenB} @ {s.poolFeeTier}bps, {s.riskLevel})
                </option>
              ))}
            </select>
            {strategiesQuery.isLoading && <p className="mt-1 text-xs text-slate-500">読み込み中...</p>}
            {selectedStrategy && (
              <p className="mt-1 text-xs text-slate-500">
                {selectedStrategy.description}
                {selectedStrategy.recommendedMinCapital != null && (
                  <> · 推奨最低資本: ${selectedStrategy.recommendedMinCapital}</>
                )}
              </p>
            )}
          </label>
        )}

        <label className="text-sm">
          <span className="text-xs text-slate-400">中心価格</span>
          <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100" value={centerPrice} onChange={(e) => setCenterPrice(e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="text-xs text-slate-400">入金 ETH</span>
          <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100" value={ethAmount} onChange={(e) => setEthAmount(e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="text-xs text-slate-400">入金 USDC</span>
          <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100" value={usdcAmount} onChange={(e) => setUsdcAmount(e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="text-xs text-slate-400">スリッページ (%)</span>
          <input className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-100" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </label>

        <div className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
          <div className="space-y-2">
            <MetricRow label="ガス見積り" value="~0.006 ETH" />
            <MetricRow label="レンジ" value={`${range.lowerPrice} - ${range.upperPrice}`} />
            <MetricRow label="概算ティック（プレビュー）" value={`${approxTickLower} - ${approxTickUpper}`} />
            <MetricRow label="Approve対象" value={approveTarget ?? "-"} />
          </div>
          <p className="mt-2 text-xs text-slate-400">承認ポリシー: 必要量の exact approve のみ（無制限approveは使いません）。</p>
          {approvalPlan.length > 0 && (
            <div className="mt-2 space-y-1 text-slate-300">
              {approvalPlan.map((v) => (
                <p key={`${v.token}-${v.tokenAddress}`}>
                  承認プラン [{v.token}] token: {v.tokenAddress} / spender: {v.spender} / exact: {v.humanAmount} (
                  {v.requiredAmount.toString()})
                </p>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400">{selected.description}</p>
        </div>
      </div>

      <ExecutionChecklistCard
        title="トランザクション事前確認"
        details={[
          "Approve対象コントラクトを検証済み",
          "Chain IDを検証済み",
          `スリッページ上限: ${slippage}%`
        ]}
        onConfirm={async () => {
          setValidationError(null);
          setPreparedTx(null);
          setTxHash(null);
          setApprovalStatus(null);
          setApprovalExecution(null);
          setSavedPositionId(null);
          setActivityWarning(null);
          setFlowStatus(initialFlowStatus());
          try {
            setFlowStatus((prev) => ({ ...prev, "入力検証": "in_progress" }));
            if (!address) throw new Error("先にウォレットを接続してください");
            if (!chain?.id || !chain?.name) throw new Error("ウォレットのチェーン情報が取得できません。再接続してください。");
            if (!approveTarget) throw new Error("現在のチェーンでApprove対象が取得できません。");
            validateUserInputs({
              centerPrice,
              ethAmount,
              usdcAmount,
              slippage
            });
            validateChainId(chain.id);
            validateSlippagePercent(Number(slippage));
            validateApproveTarget(approveTarget, getApproveAllowListByChain(chain.id));
            setFlowStatus((prev) => ({ ...prev, "入力検証": "done", "トランザクション準備": "in_progress" }));
            if (!canProceedWithTemplate) {
              throw new Error("戦略テンプレートを選択してください。");
            }
            const prepared = await adapter.prepareCreatePosition({
              chainId: chain.id,
              recipient: address,
              feeTier: effectiveFeeTier,
              tickLower: approxTickLower,
              tickUpper: approxTickUpper,
              amountEth: ethAmount,
              amountUsdc: usdcAmount,
              slippageBps: Math.round(Number(slippage) * 100)
            });
            setPreparedTx(prepared);
            setFlowStatus((prev) => ({ ...prev, "トランザクション準備": "done" }));
          } catch (e) {
            setFlowStatus((prev) => ({ ...prev, "入力検証": prev["入力検証"] === "in_progress" ? "error" : prev["入力検証"], "トランザクション準備": prev["トランザクション準備"] === "in_progress" ? "error" : prev["トランザクション準備"] }));
            setValidationError(e instanceof Error ? e.message : "入力検証に失敗しました");
          }
        }}
      />
      {validationError && <WarningBox type="DANGER" title="Validation Error" description={validationError} />}
      {preparedTx && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
          <p className="text-sm font-semibold">準備済みトランザクション</p>
          <div className="mt-3 space-y-2">
            <MetricRow label="送信先" value={preparedTx.targetContract} />
            <MetricRow label="チェーンID" value={preparedTx.summary.chainId} />
            <MetricRow label="受取先" value={preparedTx.summary.recipient} />
            <MetricRow label="value" value={preparedTx.value.toString()} />
            <MetricRow label="推定Gas" value={preparedTx.estimatedGas} />
            <MetricRow label="Approve対象一覧" value={preparedTx.approveTargets.join(", ")} />
            <MetricRow label="プール" value={preparedTx.summary.poolAddress} />
            <MetricRow label="プール算出元" value={preparedTx.summary.poolSource} />
            <MetricRow label="Factory" value={preparedTx.summary.poolDerivation.factoryAddress} />
            <MetricRow
              label="Pool derivation params"
              value={`token0=${preparedTx.summary.poolDerivation.token0Address} / token1=${preparedTx.summary.poolDerivation.token1Address} / fee=${preparedTx.summary.poolDerivation.feeTier}`}
            />
            <MetricRow label="token0" value={`${preparedTx.summary.token0Symbol} (${preparedTx.summary.token0Address})`} />
            <MetricRow label="token1" value={`${preparedTx.summary.token1Symbol} (${preparedTx.summary.token1Address})`} />
            <MetricRow label="サマリー" value={`${preparedTx.summary.pair} / fee ${preparedTx.summary.feeTier} / ticks ${preparedTx.summary.tickLower} - ${preparedTx.summary.tickUpper}`} />
            <MetricRow label="calldata" value={`${preparedTx.calldata.slice(0, 18)}...`} />
          </div>
          {preparedTx.warnings.length > 0 && (
            <ul className="mt-3 list-disc pl-6 text-yellow-300">
              {preparedTx.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {preparedTx && (
        <ApprovalExecutionCard
          isCheckingApprovals={isCheckingApprovals}
          isApproving={isApproving}
          approvalStatus={approvalStatus}
          approvalExecution={approvalExecution}
          hasMissingApprovals={hasMissingApprovals}
          onCheckApprovals={async () => {
            setValidationError(null);
            setIsCheckingApprovals(true);
            setFlowStatus((prev) => ({ ...prev, "承認チェック": "in_progress" }));
            try {
              if (!address) throw new Error("先にウォレットを接続してください");
              const plans = buildExactApprovalPlan(
                preparedTx.chainId,
                preparedTx.summary.amountEth,
                preparedTx.summary.amountUsdc
              );
              const status = await checkApprovalRequirements({
                chainId: preparedTx.chainId,
                owner: address,
                plans
              });
              setApprovalStatus(status);
              setFlowStatus((prev) => ({ ...prev, "承認チェック": "done" }));
            } catch (e) {
              setFlowStatus((prev) => ({ ...prev, "承認チェック": "error" }));
              setValidationError(e instanceof Error ? e.message : "承認チェックに失敗しました");
            } finally {
              setIsCheckingApprovals(false);
            }
          }}
          onApproveMissing={async () => {
            if (!approvalStatus) return;
            setValidationError(null);
            setIsApproving(true);
            setFlowStatus((prev) => ({ ...prev, "承認チェック": "done", "ミント実行": prev["ミント実行"], "ポジション保存": prev["ポジション保存"], "アクティビティ保存": prev["アクティビティ保存"] }));
            try {
              if (!address) throw new Error("先にウォレットを接続してください");
              const approvalResult = await adapter.approveMissingAllowances({
                chainId: preparedTx.chainId,
                owner: address,
                amountEth: preparedTx.summary.amountEth,
                amountUsdc: preparedTx.summary.amountUsdc
              });
              setApprovalExecution(approvalResult as ApprovalExecutionResult);
              if (approvalResult.hasFailure) {
                if (approvalResult.hasPartialFailure) {
                  setValidationError(
                    [
                      "Approveが部分成功しました。",
                      `WETH: ${approvalResult.results.weth.status}${
                        approvalResult.results.weth.errorMessage ? ` (${approvalResult.results.weth.errorMessage})` : ""
                      }`,
                      `USDC: ${approvalResult.results.usdc.status}${
                        approvalResult.results.usdc.errorMessage ? ` (${approvalResult.results.usdc.errorMessage})` : ""
                      }`
                    ].join(" ")
                  );
                } else {
                  setValidationError(
                    `Approveに失敗しました。WETH=${approvalResult.results.weth.status} (${approvalResult.results.weth.errorMessage ?? "unknown"}), USDC=${approvalResult.results.usdc.status} (${approvalResult.results.usdc.errorMessage ?? "unknown"})`
                  );
                }
              }
              const plans = buildExactApprovalPlan(
                preparedTx.chainId,
                preparedTx.summary.amountEth,
                preparedTx.summary.amountUsdc
              );
              const refreshed = await checkApprovalRequirements({
                chainId: preparedTx.chainId,
                owner: address,
                plans
              });
              setApprovalStatus(refreshed);
            } catch (e) {
              setValidationError(e instanceof Error ? e.message : "Approveに失敗しました");
            } finally {
              setIsApproving(false);
            }
          }}
        />
      )}
      <div className="flex gap-2">
        <Button
          disabled={
            !preparedTx ||
            isExecuting ||
            !approvalStatus ||
            hasMissingApprovals
          }
          onClick={async () => {
            if (!preparedTx) return;
            setValidationError(null);
            setTxHash(null);
            setSavedPositionId(null);
            setActivityWarning(null);
            setIsExecuting(true);
            try {
              if (!chain?.id || !chain?.name) throw new Error("ウォレットのチェーン情報が取得できません。再接続してください。");
              setFlowStatus((prev) => ({ ...prev, "ミント実行": "in_progress" }));
              const result = await adapter.executeCreatePosition(preparedTx);
              setFlowStatus((prev) => ({ ...prev, "ミント実行": "done", "ポジション保存": "in_progress" }));
              setTxHash(result.txHash);
              if (!address) throw new Error("実行中にウォレット接続が切断されました");
              if (!result.positionTokenId) {
                throw new Error(
                  "トランザクションは成功しましたが、ログからtokenIdを取得できませんでした。手動登録してください。"
                );
              }
              const centerPriceNum = Number(centerPrice);
              const ethPrice = Number.isFinite(centerPriceNum) && centerPriceNum > 0 ? centerPriceNum : 3000;
              const estimatedValueUsd =
                Number(preparedTx.summary.amountEth) * ethPrice + Number(preparedTx.summary.amountUsdc);
              await saveCreatedPosition({
                wallet: address,
                chainId: chain.id,
                chainName: chain.name,
                positionId: result.positionTokenId,
                createdTx: result.txHash,
                preparedSummary: preparedTx.summary,
                estimatedValueUsd,
                signMessageAsync
              });
              setFlowStatus((prev) => ({ ...prev, "ポジション保存": "done", "アクティビティ保存": "in_progress" }));
              try {
                await saveActivityLog({
                  wallet: address,
                  positionId: result.positionTokenId,
                  txHash: result.txHash,
                  signMessageAsync
                });
                setFlowStatus((prev) => ({ ...prev, "アクティビティ保存": "done" }));
              } catch (e) {
                setFlowStatus((prev) => ({ ...prev, "アクティビティ保存": "error" }));
                setActivityWarning(
                  e instanceof Error
                    ? `ポジション保存は成功しましたが、アクティビティ保存に失敗しました: ${e.message}`
                    : "ポジション保存は成功しましたが、アクティビティ保存に失敗しました。"
                );
              }
              setSavedPositionId(result.positionTokenId);
            } catch (e) {
              setFlowStatus((prev) => ({
                ...prev,
                "ミント実行": prev["ミント実行"] === "in_progress" ? "error" : prev["ミント実行"],
                "ポジション保存": prev["ポジション保存"] === "in_progress" ? "error" : prev["ポジション保存"]
              }));
              setValidationError(e instanceof Error ? e.message : "実行に失敗しました");
            } finally {
              setIsExecuting(false);
            }
          }}
        >
          {isExecuting ? "実行中..." : "ポジション作成を実行"}
        </Button>
      </div>
      {txHash && (
        <WarningBox
          type="SUCCESS"
          title="トランザクション送信済み"
          description={`tx: ${txHash}${explorerUrl ? ` / explorer: ${explorerUrl}` : ""}`}
        />
      )}
      {savedPositionId && <WarningBox type="SUCCESS" title="ポジション保存成功" description={`TokenId: ${savedPositionId}`} />}
      {activityWarning && <WarningBox type="WARNING" title="Activity Warning" description={activityWarning} />}
      <FlowStatusCard title="フロー状態" steps={FLOW_STEPS} statusByStep={flowStatus} />
      <RiskDisclosure />
    </section>
  );
}

async function saveCreatedPosition(input: {
  wallet: `0x${string}`;
  chainId: number;
  chainName: string;
  positionId: string;
  createdTx: string;
  preparedSummary: PreparedCreatePositionTx["summary"];
  estimatedValueUsd?: number;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
}) {
  await signedPost({
    wallet: input.wallet,
    signMessageAsync: input.signMessageAsync,
    path: "/positions",
    body: {
      wallet: input.wallet,
      positionId: input.positionId,
      chainId: input.chainId,
      chainName: input.chainName,
      poolAddress: input.preparedSummary.poolAddress,
      token0Address: input.preparedSummary.token0Address,
      token1Address: input.preparedSummary.token1Address,
      token0Symbol: input.preparedSummary.token0Symbol,
      token1Symbol: input.preparedSummary.token1Symbol,
      feeTier: input.preparedSummary.feeTier,
      tickLower: input.preparedSummary.tickLower,
      tickUpper: input.preparedSummary.tickUpper,
      createdTx: input.createdTx,
      slippageBps: input.preparedSummary.slippageBps,
      estimatedValueUsd: input.estimatedValueUsd,
      // Initial placeholder status. Future updates should re-compute using live currentTick vs tick range.
      status: "IN_RANGE"
    },
    errorPrefix: "ポジション保存に失敗しました"
  });
}

async function saveActivityLog(input: {
  wallet: `0x${string}`;
  positionId: string;
  txHash: string;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
}) {
  await signedPost({
    wallet: input.wallet,
    signMessageAsync: input.signMessageAsync,
    path: "/activity",
    body: {
      wallet: input.wallet,
      positionId: input.positionId,
      type: "Position created",
      tx: input.txHash,
      message: `Position ${input.positionId} created`
    },
    errorPrefix: "アクティビティログ保存に失敗しました"
  });
}

async function signedPost(input: {
  wallet: `0x${string}`;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  path: "/positions" | "/activity";
  body: Record<string, unknown>;
  errorPrefix: string;
}) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  const action = encodeURIComponent(`POST ${input.path}`);
  const chainIdQuery = typeof input.body.chainId === "number" ? `&chainId=${input.body.chainId}` : "";
  const challengeRes = await fetch(`${apiBaseUrl}/auth/challenge/${input.wallet}?action=${action}${chainIdQuery}`);
  if (!challengeRes.ok) throw new Error("認証チャレンジの取得に失敗しました");
  const challenge = (await challengeRes.json()) as { message: string };
  const signature = await input.signMessageAsync({ message: challenge.message });
  const messageB64 = utf8ToBase64(challenge.message);

  const response = await fetch(`${apiBaseUrl}${input.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet-address": input.wallet.toLowerCase(),
      "x-wallet-signature": signature,
      "x-wallet-message-b64": messageB64,
      ...(typeof input.body.chainId === "number" ? { "x-chain-id": String(input.body.chainId) } : {})
    },
    body: JSON.stringify(input.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${input.errorPrefix}: ${text || response.status}`);
  }
}

type FlowStep =
  | "入力検証"
  | "トランザクション準備"
  | "承認チェック"
  | "ミント実行"
  | "ポジション保存"
  | "アクティビティ保存";
type FlowStepStatus = "idle" | "in_progress" | "done" | "error";
type ApprovalStatus = "SKIPPED" | "PENDING" | "SUCCESS" | "FAILED";

const FLOW_STEPS: FlowStep[] = [
  "入力検証",
  "トランザクション準備",
  "承認チェック",
  "ミント実行",
  "ポジション保存",
  "アクティビティ保存"
];

function initialFlowStatus(): Record<FlowStep, FlowStepStatus> {
  return {
    "入力検証": "idle",
    "トランザクション準備": "idle",
    "承認チェック": "idle",
    "ミント実行": "idle",
    "ポジション保存": "idle",
    "アクティビティ保存": "idle"
  };
}

function getApprovalStatusLabel(status: ApprovalStatus): string {
  if (status === "SUCCESS") return "成功";
  if (status === "FAILED") return "失敗";
  if (status === "SKIPPED") return "スキップ";
  return "承認待ち";
}

function getApprovalStatusClassName(status: ApprovalStatus): string {
  if (status === "SUCCESS") return "text-emerald-700";
  if (status === "FAILED") return "text-rose-700";
  if (status === "SKIPPED") return "text-slate-700";
  return "text-amber-700";
}

function validateUserInputs(input: {
  centerPrice: string;
  ethAmount: string;
  usdcAmount: string;
  slippage: string;
}) {
  assertPositiveFinite("中心価格", input.centerPrice, 1_000_000_000);
  assertPositiveFinite("ETH数量", input.ethAmount, 100_000);
  assertPositiveFinite("USDC数量", input.usdcAmount, 10_000_000_000);
  assertPositiveFinite("スリッページ", input.slippage, 1);
}

function assertPositiveFinite(label: string, value: string, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`${label}は有効な数値で入力してください`);
  }
  if (parsed <= 0) {
    throw new Error(`${label}は0より大きい値を入力してください`);
  }
  if (parsed > max) {
    throw new Error(`${label}が大きすぎます`);
  }
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
