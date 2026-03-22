"use client";

import { Button } from "@/components/ui/button";
import { MetricRow } from "@/components/ui/metric-row";
import { WarningBox } from "@/components/ui/warning-box";
import type { ApprovalRequirement } from "@/lib/approval";

type ApprovalStatus = "SKIPPED" | "PENDING" | "SUCCESS" | "FAILED";

interface TokenApprovalExecutionResult {
  token: "WETH" | "USDC";
  status: ApprovalStatus;
  attempted: boolean;
  approvalSkipped: boolean;
  approvalRequired: boolean;
  success: boolean;
  txHash?: `0x${string}`;
  errorMessage?: string;
  currentAllowance: string;
  finalAllowance: string;
  requiredAmount: string;
}

export interface ApprovalExecutionResult {
  exactApprovalOnly: true;
  spender: `0x${string}`;
  results: {
    weth: TokenApprovalExecutionResult;
    usdc: TokenApprovalExecutionResult;
  };
  hasFailure: boolean;
  hasPartialFailure: boolean;
}

interface Props {
  isCheckingApprovals: boolean;
  isApproving: boolean;
  approvalStatus: ApprovalRequirement[] | null;
  approvalExecution: ApprovalExecutionResult | null;
  hasMissingApprovals: boolean;
  onCheckApprovals: () => Promise<void>;
  onApproveMissing: () => Promise<void>;
}

export function ApprovalExecutionCard({
  isCheckingApprovals,
  isApproving,
  approvalStatus,
  approvalExecution,
  hasMissingApprovals,
  onCheckApprovals,
  onApproveMissing
}: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
      <p className="text-sm font-semibold">承認チェック</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={isCheckingApprovals || isApproving} onClick={() => void onCheckApprovals()}>
          {isCheckingApprovals ? "確認中..." : "承認状態を確認"}
        </Button>
        <Button
          disabled={!approvalStatus || !hasMissingApprovals || isApproving || isCheckingApprovals}
          onClick={() => void onApproveMissing()}
        >
          {isApproving ? "承認中..." : "不足トークンを承認"}
        </Button>
      </div>

      {approvalStatus && (
        <div className="mt-3 space-y-2">
          {approvalStatus.map((row) => (
            <MetricRow
              key={`${row.token}-${row.tokenAddress}`}
              label={`${row.token} allowance`}
              value={`${row.currentAllowance.toString()} / 必要量 ${row.requiredAmount.toString()} (${row.approvalRequired ? `承認が必要 / 不足 ${row.missingAmount.toString()}` : "OK"})`}
            />
          ))}
        </div>
      )}

      {approvalExecution && (
        <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
          <MetricRow label="Approve実行（exact only）" value={String(approvalExecution.exactApprovalOnly)} />
          <MetricRow label="spender" value={approvalExecution.spender} />
          <MetricRow
            label="WETH"
            value={
              <span className={getApprovalStatusClassName(approvalExecution.results.weth.status)}>
                {renderTokenExecutionText(approvalExecution.results.weth)}
              </span>
            }
          />
          <MetricRow
            label="USDC"
            value={
              <span className={getApprovalStatusClassName(approvalExecution.results.usdc.status)}>
                {renderTokenExecutionText(approvalExecution.results.usdc)}
              </span>
            }
          />
          {approvalExecution.hasPartialFailure && (
            <WarningBox type="WARNING" title="部分成功" description="片方のみ成功しています。失敗したトークンのみ再度approveしてください。" />
          )}
        </div>
      )}
    </div>
  );
}

function renderTokenExecutionText(result: TokenApprovalExecutionResult): string {
  const detail = result.approvalSkipped
    ? "スキップ（allowance充足済み）"
    : result.attempted
      ? result.success
        ? `成功${result.txHash ? ` (${result.txHash})` : ""} finalAllowance=${result.finalAllowance}`
        : `失敗 (${result.errorMessage ?? "unknown"})`
      : "不要";
  return `${detail} / status=${getApprovalStatusLabel(result.status)}`;
}

function getApprovalStatusLabel(status: ApprovalStatus): string {
  if (status === "SUCCESS") return "成功";
  if (status === "FAILED") return "失敗";
  if (status === "SKIPPED") return "スキップ";
  return "承認待ち";
}

function getApprovalStatusClassName(status: ApprovalStatus): string {
  if (status === "SUCCESS") return "text-green-300";
  if (status === "FAILED") return "text-red-300";
  if (status === "SKIPPED") return "text-slate-300";
  return "text-yellow-300";
}
