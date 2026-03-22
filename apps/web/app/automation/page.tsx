"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { AutomationSafetyPanel } from "@/components/cards/automation-safety-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { WarningBox } from "@/components/ui/warning-box";
import { Button } from "@/components/ui/button";
import { MobileBottomActionBar } from "@/components/mobile/mobile-bottom-action-bar";
import { ConfirmDangerActionModal } from "@/components/modals/confirm-danger-action-modal";
import { useAutomationSettings } from "@/hooks/use-automation-settings";
import {
  useAutomationEvaluate,
  useAutomationPreflight,
  useAutomationRuntimeConfig,
  useAutomationSmokeTest
} from "@/hooks/use-automation-evaluate";
import { useAutomationMetrics } from "@/hooks/use-automation-metrics";
import {
  useLoadAutomationOperators,
  useUpsertAutomationOperator,
  type AutomationOperatorPermission
} from "@/hooks/use-automation-operators";
import { useAutomationSettingsV2, useUpsertAutomationSettingsV2 } from "@/hooks/use-automation-settings-v2";
import { useActivity } from "@/hooks/use-activity";
import {
  useAutomationExecutions,
  type ExecutionStatusFilter
} from "@/hooks/use-automation-executions";
import { useSyncOverview } from "@/hooks/use-sync-overview";
import { usePositions } from "@/hooks/use-positions";
import { useLocalStorageBoolean } from "@/hooks/use-local-storage-boolean";
import { useLocalStorageJson } from "@/hooks/use-local-storage-json";
import { useKeySequenceShortcut } from "@/hooks/use-key-sequence-shortcut";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { getExplorerTxUrl, shortTx } from "@/lib/explorer";
import { KEY_SEQUENCE_INTERVAL_MS, SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { UI_PREFERENCE_KEYS } from "@/lib/ui-preference-keys";
import { LOCAL_DATA_KEYS } from "@/lib/local-data-keys";

type SmokeHistoryItem = {
  id: string;
  mode: "DRY_RUN" | "LIVE";
  success: boolean;
  message: string;
  jobId?: string;
  executionId?: string | null;
  executionStatus?: string | null;
  txStatus?: string | null;
  txHash?: string | null;
  chainId?: number | null;
  createdAt: string;
};

const SMOKE_HISTORY_STORAGE_KEY = LOCAL_DATA_KEYS.AUTOMATION_SMOKE_HISTORY;
const GLOBAL_POSITION_KEY = "__GLOBAL__";
const TARGET_CONTEXT_PANEL_ID = "automation-target-context-panel";

export default function AutomationPage() {
  const { address, chain } = useAccount();
  const { settings, setSettings } = useAutomationSettings();
  const [signedViewsLoaded, setSignedViewsLoaded] = useState(false);
  const [targetOwnerWallet, setTargetOwnerWallet] = useState("");
  const historyWallet =
    targetOwnerWallet.trim().length > 0 && /^0x[a-fA-F0-9]{40}$/.test(targetOwnerWallet.trim())
      ? (targetOwnerWallet.trim().toLowerCase() as `0x${string}`)
      : (address as `0x${string}` | undefined);
  const runtimeConfigQuery = useAutomationRuntimeConfig();
  const preflightQuery = useAutomationPreflight();
  const metricsQuery = useAutomationMetrics({
    signerWallet: address as `0x${string}` | undefined,
    targetWallet: historyWallet,
    chainId: chain?.id,
    enabled: signedViewsLoaded
  });
  const evaluateMutation = useAutomationEvaluate(address);
  const smokeMutation = useAutomationSmokeTest(address as `0x${string}` | undefined);
  const settingsQuery = useAutomationSettingsV2({
    signerWallet: address as `0x${string}` | undefined,
    targetWallet: historyWallet,
    chainId: chain?.id,
    enabled: signedViewsLoaded
  });
  const saveSettingsMutation = useUpsertAutomationSettingsV2(address as `0x${string}` | undefined);
  const positionsQuery = usePositions(historyWallet);
  const activityQuery = useActivity(historyWallet);
  const executionsQuery = useAutomationExecutions({
    signerWallet: address as `0x${string}` | undefined,
    targetWallet: historyWallet,
    limit: 30,
    status: executionStatusFilter,
    enabled: signedViewsLoaded
  });
  const syncOverviewQuery = useSyncOverview({
    signerWallet: address,
    targetWallet: historyWallet,
    chainId: chain?.id ?? 42161,
    auto: false
  });
  const hasRiskyConfig = !settings.staleSnapshotReject || settings.minNetBenefitUsd <= 0;
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [settingsServerMessage, setSettingsServerMessage] = useState<string | null>(null);
  const [settingsPositionTarget, setSettingsPositionTarget] = useState<string>(GLOBAL_POSITION_KEY);
  const [batchTargetPositionIds, setBatchTargetPositionIds] = useState<string[]>([]);
  const [confirmBatchCopy, setConfirmBatchCopy] = useState(false);
  const [executionStatusFilter, setExecutionStatusFilter] = useState<ExecutionStatusFilter>("all");
  const [workerMessage, setWorkerMessage] = useState<string | null>(null);
  const [securedRefreshMessage, setSecuredRefreshMessage] = useState<string | null>(null);
  const [smokeMessage, setSmokeMessage] = useState<string | null>(null);
  const [smokeTxHash, setSmokeTxHash] = useState<string | null>(null);
  const [smokeTxChainId, setSmokeTxChainId] = useState<number | null>(null);
  const [smokeHistory, setSmokeHistory, smokeHistoryStorage] = useLocalStorageJson<SmokeHistoryItem[]>({
    key: SMOKE_HISTORY_STORAGE_KEY,
    defaultValue: [],
    deserialize: (raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is SmokeHistoryItem => {
          if (typeof item !== "object" || item == null) return false;
          const row = item as Record<string, unknown>;
          return (
            typeof row.id === "string" &&
            (row.mode === "DRY_RUN" || row.mode === "LIVE") &&
            typeof row.success === "boolean" &&
            typeof row.message === "string" &&
            typeof row.createdAt === "string"
          );
        })
        .slice(0, 3);
    },
    serialize: (items) => JSON.stringify(items.slice(0, 3)),
    debugEventName: "automation_smoke_history_changed",
    debugPayload: (next) => ({ count: next.length })
  });
  const [liveSmokeTo, setLiveSmokeTo] = useState("");
  const [liveSmokeData, setLiveSmokeData] = useState("0x");
  const [confirmLiveSmoke, setConfirmLiveSmoke] = useState(false);
  const [operatorWalletInput, setOperatorWalletInput] = useState("");
  const [operatorCanEvaluate, setOperatorCanEvaluate] = useState(true);
  const [operatorCanExecute, setOperatorCanExecute] = useState(false);
  const [operatorCanPause, setOperatorCanPause] = useState(false);
  const [operatorCanChangeStrategy, setOperatorCanChangeStrategy] = useState(false);
  const [operatorActive, setOperatorActive] = useState(true);
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [confirmEnableExecute, setConfirmEnableExecute] = useState<{
    operatorWallet: `0x${string}`;
  } | null>(null);
  const [confirmDisableOperator, setConfirmDisableOperator] = useState<{
    operatorWallet: `0x${string}`;
  } | null>(null);
  const [targetContextCollapsed, setTargetContextCollapsed] = useLocalStorageBoolean(
    UI_PREFERENCE_KEYS.AUTOMATION_TARGET_CONTEXT_COLLAPSED,
    true,
    {
      debugEventName: "automation_target_context_collapsed_changed"
    }
  );
  const [operatorSearch, setOperatorSearch] = useState("");
  const [showInactiveOperators, setShowInactiveOperators] = useState(true);
  const [operators, setOperators] = useState<AutomationOperatorPermission[]>([]);
  const loadOperatorsMutation = useLoadAutomationOperators(address as `0x${string}` | undefined);
  const upsertOperatorMutation = useUpsertAutomationOperator(address as `0x${string}` | undefined);
  const workerHistory = (activityQuery.data ?? [])
    .filter((item) => item.source === "worker")
    .slice(0, 5);
  const visibleOperators = operators.filter((item) => {
    if (!showInactiveOperators && !item.active) return false;
    const q = operatorSearch.trim().toLowerCase();
    if (!q) return true;
    return item.operatorWallet.toLowerCase().includes(q);
  });
  const ownerWalletForPermission =
    targetOwnerWallet.trim().length > 0 && /^0x[a-fA-F0-9]{40}$/.test(targetOwnerWallet.trim())
      ? (targetOwnerWallet.trim().toLowerCase() as `0x${string}`)
      : (address as `0x${string}` | undefined);
  const settingTargetPositionId = settingsPositionTarget === GLOBAL_POSITION_KEY ? null : settingsPositionTarget;
  const connectedWallet = address?.toLowerCase() as `0x${string}` | undefined;
  const targetSettingsWallet = (historyWallet ?? address)?.toLowerCase() as `0x${string}` | undefined;
  const actingAsOperator = Boolean(
    connectedWallet && targetSettingsWallet && connectedWallet.toLowerCase() !== targetSettingsWallet.toLowerCase()
  );
  const selfOperatorPermission = useMemo(() => {
    if (!actingAsOperator || !connectedWallet || !targetSettingsWallet) return null;
    return (
      operators.find(
        (item) =>
          item.active &&
          item.ownerWallet.toLowerCase() === targetSettingsWallet.toLowerCase() &&
          item.operatorWallet.toLowerCase() === connectedWallet.toLowerCase()
      ) ?? null
    );
  }, [actingAsOperator, connectedWallet, operators, targetSettingsWallet]);
  const selectedSettingRow = useMemo(
    () =>
      settingsQuery.data?.find((item) => (settingTargetPositionId ? item.positionId === settingTargetPositionId : item.positionId == null)) ??
      settingsQuery.data?.find((item) => item.positionId == null) ??
      null,
    [settingTargetPositionId, settingsQuery.data]
  );
  const baselineEmergencyPaused = selectedSettingRow?.emergencyPaused ?? false;
  const canEditSettingsByRole = !actingAsOperator || Boolean(selfOperatorPermission?.canChangeStrategy);
  const canPauseByRole = !actingAsOperator || Boolean(selfOperatorPermission?.canPause);
  const operatorNeedsPausePermission = actingAsOperator && settings.emergencyPaused !== baselineEmergencyPaused;
  const settingsActionBlockedReason = useMemo(() => {
    if (!actingAsOperator) return null;
    if (!selfOperatorPermission) {
      return "Operator権限が未ロード、または active 権限がありません。Ownerが権限を付与した後、Load Permissions を実行してください。";
    }
    if (!selfOperatorPermission.canChangeStrategy) {
      return "canChangeStrategy がないため、設定保存・コピーは実行できません。";
    }
    if (operatorNeedsPausePermission && !selfOperatorPermission.canPause) {
      return "emergency paused の変更には canPause が必要です。";
    }
    return null;
  }, [actingAsOperator, operatorNeedsPausePermission, selfOperatorPermission]);
  const canSaveSettings =
    Boolean(address) &&
    !saveSettingsMutation.isPending &&
    canEditSettingsByRole &&
    (!operatorNeedsPausePermission || canPauseByRole);
  const canCopyGlobalToSingle =
    Boolean(address) &&
    Boolean(settingTargetPositionId) &&
    !saveSettingsMutation.isPending &&
    canEditSettingsByRole &&
    canPauseByRole;
  const canOpenBatchCopy =
    Boolean(address) && batchTargetPositionIds.length > 0 && !saveSettingsMutation.isPending && canEditSettingsByRole && canPauseByRole;
  const canEvaluateByRole = !actingAsOperator || Boolean(selfOperatorPermission?.canEvaluate);
  const canExecuteByRole = !actingAsOperator || Boolean(selfOperatorPermission?.canExecute);
  const evaluateActionBlockedReason = useMemo(() => {
    if (!actingAsOperator) return null;
    if (!selfOperatorPermission) {
      return "Operator権限が未ロード、または active 権限がありません。Load Permissions で再取得してください。";
    }
    if (!selfOperatorPermission.canEvaluate) {
      return "canEvaluate がないため、Run Worker Evaluation は実行できません。";
    }
    return null;
  }, [actingAsOperator, selfOperatorPermission]);
  const executeActionBlockedReason = useMemo(() => {
    if (!actingAsOperator) return null;
    if (!selfOperatorPermission) {
      return "Operator権限が未ロード、または active 権限がありません。Load Permissions で再取得してください。";
    }
    if (!selfOperatorPermission.canExecute) {
      return "canExecute がないため、Smoke Test は実行できません。";
    }
    return null;
  }, [actingAsOperator, selfOperatorPermission]);
  const canRunEvaluate = Boolean(address) && !evaluateMutation.isPending && canEvaluateByRole;
  const canRunSmoke = Boolean(address) && !smokeMutation.isPending && canExecuteByRole;
  const actorScope = !actingAsOperator
    ? ({ kind: "owner_full" } as const)
    : selfOperatorPermission
      ? ({
          kind: "operator",
          canEvaluate: selfOperatorPermission.canEvaluate,
          canExecute: selfOperatorPermission.canExecute,
          canPause: selfOperatorPermission.canPause,
          canChangeStrategy: selfOperatorPermission.canChangeStrategy
        } as const)
      : ({ kind: "permission_unknown" } as const);
  const actorScopeText =
    actorScope.kind === "owner_full"
      ? "full owner scope"
      : actorScope.kind === "permission_unknown"
        ? "permission unknown (load pending or not granted)"
        : `evaluate=${actorScope.canEvaluate ? "Y" : "N"}, execute=${actorScope.canExecute ? "Y" : "N"}, pause=${
            actorScope.canPause ? "Y" : "N"
          }, strategy=${actorScope.canChangeStrategy ? "Y" : "N"}`;
  const globalSettingRow = useMemo(
    () => settingsQuery.data?.find((item) => item.positionId == null) ?? null,
    [settingsQuery.data]
  );
  const batchCopyDryRunSummary = useMemo(() => {
    if (!globalSettingRow || batchTargetPositionIds.length === 0) {
      return {
        compared: 0,
        modeChanged: 0,
        rebalanceChanged: 0,
        compoundChanged: 0,
        gasChanged: 0,
        sampleLines: [] as string[]
      };
    }
    let modeChanged = 0;
    let rebalanceChanged = 0;
    let compoundChanged = 0;
    let gasChanged = 0;
    const sampleLines: string[] = [];
    for (const positionId of batchTargetPositionIds) {
      const current = settingsQuery.data?.find((item) => item.positionId === positionId) ?? null;
      const position = (positionsQuery.data ?? []).find((item) => item.id === positionId);
      const label = position ? `${position.token0Symbol}/${position.token1Symbol}#${positionId}` : positionId;
      const currentMode = current?.executionMode ?? "MANUAL_APPROVAL";
      const currentRebalance = current?.autoRebalanceEnabled ?? false;
      const currentCompound = current?.autoCompoundEnabled ?? false;
      const currentGas = current?.maxGasUsd ?? null;
      if (currentMode !== globalSettingRow.executionMode) modeChanged += 1;
      if (currentRebalance !== globalSettingRow.autoRebalanceEnabled) rebalanceChanged += 1;
      if (currentCompound !== globalSettingRow.autoCompoundEnabled) compoundChanged += 1;
      if ((currentGas ?? null) !== (globalSettingRow.maxGasUsd ?? null)) gasChanged += 1;
      if (sampleLines.length < 5) {
        sampleLines.push(
          `${label}: mode ${currentMode}->${globalSettingRow.executionMode}, rebalance ${currentRebalance ? "ON" : "OFF"}->${globalSettingRow.autoRebalanceEnabled ? "ON" : "OFF"}, compound ${currentCompound ? "ON" : "OFF"}->${globalSettingRow.autoCompoundEnabled ? "ON" : "OFF"}, gas ${currentGas ?? "-"}->${globalSettingRow.maxGasUsd ?? "-"}`
        );
      }
    }
    return {
      compared: batchTargetPositionIds.length,
      modeChanged,
      rebalanceChanged,
      compoundChanged,
      gasChanged,
      totalChanged: modeChanged + rebalanceChanged + compoundChanged + gasChanged,
      sampleLines
    };
  }, [batchTargetPositionIds, globalSettingRow, positionsQuery.data, settingsQuery.data]);

  useEffect(() => {
    if (!actingAsOperator) return;
    if (!ownerWalletForPermission) return;
    if (!address) return;
    const alreadyLoaded = operators.some(
      (item) =>
        item.ownerWallet.toLowerCase() === ownerWalletForPermission.toLowerCase() &&
        item.operatorWallet.toLowerCase() === address.toLowerCase()
    );
    if (alreadyLoaded || loadOperatorsMutation.isPending) return;
    void loadOperatorsMutation
      .mutateAsync({ ownerWallet: ownerWalletForPermission })
      .then((items) => {
        setOperators(items);
      })
      .catch(() => {
        // keep manual load as fallback
      });
  }, [actingAsOperator, address, loadOperatorsMutation, operators, ownerWalletForPermission]);
  useKeySequenceShortcut({
    firstKey: SHORTCUTS.AUTOMATION_TARGET_CONTEXT_TOGGLE.firstKey,
    secondKey: SHORTCUTS.AUTOMATION_TARGET_CONTEXT_TOGGLE.secondKey,
    maxIntervalMs: KEY_SEQUENCE_INTERVAL_MS,
    onMatch: () => setTargetContextCollapsed((prev) => !prev)
  });

  useEffect(() => {
    if (!settingsQuery.data || settingsQuery.data.length === 0) return;
    const current =
      settingsQuery.data.find((item) => (settingTargetPositionId ? item.positionId === settingTargetPositionId : item.positionId == null)) ??
      settingsQuery.data.find((item) => item.positionId == null) ??
      settingsQuery.data[0];
    setSettings((prev) => ({
      ...prev,
      automationMode: current.executionMode === "AUTO_EXECUTE" ? "AUTO" : "SEMI_AUTO",
      maxGasCostUsd: current.maxGasUsd ?? prev.maxGasCostUsd,
      autoCollectEnabled: current.autoCompoundEnabled,
      autoRebalanceEnabled: current.autoRebalanceEnabled,
      emergencyPaused: current.emergencyPaused
    }));
    setSettingsServerMessage(
      `Server settings loaded (${current.source ?? "automation_setting"}) / target=${
        current.positionId ?? "GLOBAL"
      } / updated ${new Date(current.updatedAt).toLocaleString()}`
    );
  }, [settingTargetPositionId, settingsQuery.data, setSettings]);

  async function runEvaluate() {
    setWorkerMessage(null);
    if (!canEvaluateByRole) {
      setWorkerMessage("この操作には canEvaluate 権限が必要です。");
      return;
    }
    const target = targetOwnerWallet.trim();
    if (target.length > 0 && !/^0x[a-fA-F0-9]{40}$/.test(target)) {
      setWorkerMessage("Target owner wallet の形式が不正です。");
      return;
    }
    try {
      const result = await evaluateMutation.mutateAsync({
        mode: settings.strategyMode,
        ...(target.length > 0 ? { wallet: target.toLowerCase() as `0x${string}` } : {})
      });
      setWorkerMessage(
        `${result.note} (actor=${result.actorRole}, triggeredBy=${result.triggeredByWallet}, target=${result.wallet})`
      );
      await activityQuery.refetch();
    } catch (error) {
      setWorkerMessage(error instanceof Error ? error.message : "Worker実行に失敗しました。");
    }
  }

  async function saveSettingsToServer() {
    if (!address) {
      setSaveError("Wallet is not connected.");
      return;
    }
    try {
      setSaved(false);
      setSaveError(null);
      setSettingsServerMessage(null);
      const executionMode = settings.automationMode === "AUTO" ? "AUTO_EXECUTE" : "MANUAL_APPROVAL";
      const row = await saveSettingsMutation.mutateAsync({
        wallet: (historyWallet ?? address) as `0x${string}`,
        ...(settingTargetPositionId ? { positionId: settingTargetPositionId } : {}),
        chainId: chain?.id ?? 42161,
        executionMode,
        autoRebalanceEnabled: settings.autoRebalanceEnabled,
        autoCompoundEnabled: settings.autoCollectEnabled,
        compoundSchedule: "THRESHOLD",
        maxGasUsd: settings.maxGasCostUsd,
        minCompoundUsd: 0,
        emergencyPaused: settings.emergencyPaused
      });
      setSaved(true);
      setSettingsServerMessage(`Server settings saved (source=${row.source ?? "automation_setting"}, target=${row.positionId ?? "GLOBAL"})`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function copyGlobalSettingsToSelectedPosition() {
    if (!address) {
      setSaveError("Wallet is not connected.");
      return;
    }
    if (!settingTargetPositionId) {
      setSaveError("先に settings target position でポジションを選択してください。");
      return;
    }
    const globalRow = settingsQuery.data?.find((item) => item.positionId == null);
    if (!globalRow) {
      setSaveError("GLOBAL設定が見つかりません。先にGLOBAL設定を保存してください。");
      return;
    }
    try {
      setSaved(false);
      setSaveError(null);
      setSettingsServerMessage(null);
      const row = await saveSettingsMutation.mutateAsync({
        wallet: (historyWallet ?? address) as `0x${string}`,
        positionId: settingTargetPositionId,
        chainId: chain?.id ?? globalRow.chainId ?? 42161,
        executionMode: globalRow.executionMode,
        autoRebalanceEnabled: globalRow.autoRebalanceEnabled,
        autoCompoundEnabled: globalRow.autoCompoundEnabled,
        compoundSchedule: globalRow.compoundSchedule,
        maxGasUsd: globalRow.maxGasUsd ?? undefined,
        minCompoundUsd: globalRow.minCompoundUsd ?? undefined,
        emergencyPaused: globalRow.emergencyPaused,
        strategyTemplateId: globalRow.strategyTemplateId ?? undefined
      });
      setSaved(true);
      setSettings((prev) => ({
        ...prev,
        automationMode: row.executionMode === "AUTO_EXECUTE" ? "AUTO" : "SEMI_AUTO",
        maxGasCostUsd: row.maxGasUsd ?? prev.maxGasCostUsd,
        autoCollectEnabled: row.autoCompoundEnabled,
        autoRebalanceEnabled: row.autoRebalanceEnabled,
        emergencyPaused: row.emergencyPaused
      }));
      setSettingsServerMessage(`Copied GLOBAL -> ${settingTargetPositionId} (source=${row.source ?? "automation_setting"})`);
      await settingsQuery.refetch();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "GLOBAL設定のコピーに失敗しました。");
    }
  }

  async function copyGlobalSettingsToBatchPositions() {
    if (!address) {
      setSaveError("Wallet is not connected.");
      return;
    }
    if (batchTargetPositionIds.length === 0) {
      setSaveError("一括コピー対象ポジションを1つ以上選択してください。");
      return;
    }
    const globalRow = settingsQuery.data?.find((item) => item.positionId == null);
    if (!globalRow) {
      setSaveError("GLOBAL設定が見つかりません。先にGLOBAL設定を保存してください。");
      return;
    }
    try {
      setSaved(false);
      setSaveError(null);
      setSettingsServerMessage(null);
      let successCount = 0;
      for (const positionId of batchTargetPositionIds) {
        await saveSettingsMutation.mutateAsync({
          wallet: (historyWallet ?? address) as `0x${string}`,
          positionId,
          chainId: chain?.id ?? globalRow.chainId ?? 42161,
          executionMode: globalRow.executionMode,
          autoRebalanceEnabled: globalRow.autoRebalanceEnabled,
          autoCompoundEnabled: globalRow.autoCompoundEnabled,
          compoundSchedule: globalRow.compoundSchedule,
          maxGasUsd: globalRow.maxGasUsd ?? undefined,
          minCompoundUsd: globalRow.minCompoundUsd ?? undefined,
          emergencyPaused: globalRow.emergencyPaused,
          strategyTemplateId: globalRow.strategyTemplateId ?? undefined
        });
        successCount += 1;
      }
      setSaved(true);
      setSettingsServerMessage(`Copied GLOBAL -> ${successCount} positions`);
      await settingsQuery.refetch();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "GLOBAL設定の一括コピーに失敗しました。");
    }
  }

  async function refreshSecuredViews() {
    try {
      setSecuredRefreshMessage(null);
      await Promise.all([syncOverviewQuery.refetch(), activityQuery.refetch()]);
      setSignedViewsLoaded(true);
      setSecuredRefreshMessage("署名付きビューを更新しました。");
    } catch (error) {
      setSecuredRefreshMessage(error instanceof Error ? error.message : "署名付きビューの更新に失敗しました。");
    }
  }

  async function runSmokeDryRun() {
    setSmokeMessage(null);
    setSmokeTxHash(null);
    setSmokeTxChainId(null);
    if (!canExecuteByRole) {
      setSmokeMessage("この操作には canExecute 権限が必要です。");
      return;
    }
    const target = targetOwnerWallet.trim();
    if (target.length > 0 && !/^0x[a-fA-F0-9]{40}$/.test(target)) {
      setSmokeMessage("Target owner wallet の形式が不正です。");
      return;
    }
    try {
      const out = await smokeMutation.mutateAsync({
        mode: "DRY_RUN",
        ...(target.length > 0 ? { wallet: target.toLowerCase() as `0x${string}` } : {}),
        ...(chain?.id ? { chainId: chain.id } : {})
      });
      setSmokeMessage(`${out.note} (job=${out.jobId}, execution=${out.executionId ?? "n/a"})`);
      setSmokeTxHash(out.txHash ?? null);
      setSmokeTxChainId(chain?.id ?? null);
      setSmokeHistory((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random()}`,
            mode: "DRY_RUN",
            success: true,
            message: out.note,
            jobId: out.jobId,
            executionId: out.executionId,
            executionStatus: out.executionStatus,
            txStatus: out.txStatus,
            txHash: out.txHash,
            chainId: chain?.id ?? null,
            createdAt: new Date().toISOString()
          },
          ...prev
        ].slice(0, 3)
      );
      await Promise.all([activityQuery.refetch(), metricsQuery.refetch()]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Smoke test 実行に失敗しました。";
      setSmokeMessage(msg);
      setSmokeHistory((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random()}`,
            mode: "DRY_RUN",
            success: false,
            message: msg,
            createdAt: new Date().toISOString()
          },
          ...prev
        ].slice(0, 3)
      );
    }
  }

  async function runSmokeLive() {
    setSmokeMessage(null);
    setSmokeTxHash(null);
    setSmokeTxChainId(null);
    if (!canExecuteByRole) {
      setSmokeMessage("この操作には canExecute 権限が必要です。");
      return;
    }
    const target = targetOwnerWallet.trim();
    if (target.length > 0 && !/^0x[a-fA-F0-9]{40}$/.test(target)) {
      setSmokeMessage("Target owner wallet の形式が不正です。");
      return;
    }
    const to = liveSmokeTo.trim();
    const data = liveSmokeData.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      setSmokeMessage("LIVE smoke: txRequest.to の形式が不正です。");
      return;
    }
    if (!/^0x[0-9a-fA-F]*$/.test(data)) {
      setSmokeMessage("LIVE smoke: txRequest.data は 0x 始まり16進文字列で入力してください。");
      return;
    }
    try {
      const out = await smokeMutation.mutateAsync({
        mode: "LIVE",
        ...(target.length > 0 ? { wallet: target.toLowerCase() as `0x${string}` } : {}),
        ...(chain?.id ? { chainId: chain.id } : {}),
        allowLiveSubmission: true,
        txRequest: {
          to: to as `0x${string}`,
          data: data as `0x${string}`,
          value: "0"
        }
      });
      setSmokeMessage(
        `${out.note} (job=${out.jobId}, execution=${out.executionId ?? "n/a"}, txStatus=${out.txStatus ?? "n/a"}, tx=${
          out.txHash ?? "n/a"
        })`
      );
      setSmokeTxHash(out.txHash ?? null);
      setSmokeTxChainId(chain?.id ?? null);
      setSmokeHistory((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random()}`,
            mode: "LIVE",
            success: true,
            message: out.note,
            jobId: out.jobId,
            executionId: out.executionId,
            executionStatus: out.executionStatus,
            txStatus: out.txStatus,
            txHash: out.txHash,
            chainId: chain?.id ?? null,
            createdAt: new Date().toISOString()
          },
          ...prev
        ].slice(0, 3)
      );
      await Promise.all([activityQuery.refetch(), metricsQuery.refetch()]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "LIVE smoke test 実行に失敗しました。";
      setSmokeMessage(msg);
      setSmokeHistory((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random()}`,
            mode: "LIVE",
            success: false,
            message: msg,
            createdAt: new Date().toISOString()
          },
          ...prev
        ].slice(0, 3)
      );
    }
  }

  async function loadOperatorPermissions() {
    setOperatorMessage(null);
    if (!ownerWalletForPermission) {
      setOperatorMessage("Owner wallet を特定できません。");
      return;
    }
    try {
      const items = await loadOperatorsMutation.mutateAsync({ ownerWallet: ownerWalletForPermission });
      setOperators(items);
      setOperatorMessage(`Operator permissions loaded: ${items.length} 件`);
    } catch (error) {
      setOperatorMessage(error instanceof Error ? error.message : "Operator permissions の取得に失敗しました。");
    }
  }

  async function saveOperatorPermission() {
    setOperatorMessage(null);
    if (!ownerWalletForPermission) {
      setOperatorMessage("Owner wallet を特定できません。");
      return;
    }
    const operatorWallet = operatorWalletInput.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(operatorWallet)) {
      setOperatorMessage("Operator wallet の形式が不正です。");
      return;
    }
    try {
      await upsertOperatorMutation.mutateAsync({
        ownerWallet: ownerWalletForPermission,
        operatorWallet: operatorWallet.toLowerCase() as `0x${string}`,
        canEvaluate: operatorCanEvaluate,
        canExecute: operatorCanExecute,
        canPause: operatorCanPause,
        canChangeStrategy: operatorCanChangeStrategy,
        active: operatorActive
      });
      setOperatorMessage("Operator permission を保存しました。");
      const items = await loadOperatorsMutation.mutateAsync({ ownerWallet: ownerWalletForPermission });
      setOperators(items);
      await activityQuery.refetch();
    } catch (error) {
      setOperatorMessage(error instanceof Error ? error.message : "Operator permission の保存に失敗しました。");
    }
  }

  async function applyOperatorPermissionQuick(input: {
    operatorWallet: `0x${string}`;
    canEvaluate: boolean;
    canExecute: boolean;
    canPause: boolean;
    canChangeStrategy: boolean;
    active: boolean;
  }) {
    setOperatorMessage(null);
    if (!ownerWalletForPermission) {
      setOperatorMessage("Owner wallet を特定できません。");
      return;
    }
    try {
      await upsertOperatorMutation.mutateAsync({
        ownerWallet: ownerWalletForPermission,
        operatorWallet: input.operatorWallet,
        canEvaluate: input.canEvaluate,
        canExecute: input.canExecute,
        canPause: input.canPause,
        canChangeStrategy: input.canChangeStrategy,
        active: input.active
      });
      setOperatorMessage("Operator permission を更新しました。");
      const items = await loadOperatorsMutation.mutateAsync({ ownerWallet: ownerWalletForPermission });
      setOperators(items);
      await activityQuery.refetch();
    } catch (error) {
      setOperatorMessage(error instanceof Error ? error.message : "Operator permission の更新に失敗しました。");
    }
  }

  async function toggleOperatorFlags(input: {
    operatorWallet: `0x${string}`;
    nextCanEvaluate?: boolean;
    nextCanExecute?: boolean;
    nextCanPause?: boolean;
    nextCanChangeStrategy?: boolean;
  }) {
    const current = operators.find((item) => item.operatorWallet.toLowerCase() === input.operatorWallet.toLowerCase());
    if (!current) {
      setOperatorMessage("対象 operator が見つかりません。");
      return;
    }
    const willEnableExecute = input.nextCanExecute === true && current.canExecute === false;
    if (willEnableExecute) {
      setConfirmEnableExecute({ operatorWallet: current.operatorWallet });
      return;
    }
    await applyOperatorPermissionQuick({
      operatorWallet: current.operatorWallet,
      canEvaluate: input.nextCanEvaluate ?? current.canEvaluate,
      canExecute: input.nextCanExecute ?? current.canExecute,
      canPause: input.nextCanPause ?? current.canPause,
      canChangeStrategy: input.nextCanChangeStrategy ?? current.canChangeStrategy,
      active: current.active
    });
  }

  async function confirmEnableExecuteNow() {
    if (!confirmEnableExecute) return;
    const current = operators.find((item) => item.operatorWallet.toLowerCase() === confirmEnableExecute.operatorWallet.toLowerCase());
    if (!current) {
      setConfirmEnableExecute(null);
      setOperatorMessage("対象 operator が見つかりません。");
      return;
    }
    setConfirmEnableExecute(null);
    await applyOperatorPermissionQuick({
      operatorWallet: current.operatorWallet,
      canEvaluate: current.canEvaluate,
      canExecute: true,
      canPause: current.canPause,
      canChangeStrategy: current.canChangeStrategy,
      active: current.active
    });
  }

  async function confirmDisableOperatorNow() {
    if (!confirmDisableOperator) return;
    const current = operators.find((item) => item.operatorWallet.toLowerCase() === confirmDisableOperator.operatorWallet.toLowerCase());
    if (!current) {
      setConfirmDisableOperator(null);
      setOperatorMessage("対象 operator が見つかりません。");
      return;
    }
    setConfirmDisableOperator(null);
    await applyOperatorPermissionQuick({
      operatorWallet: current.operatorWallet,
      canEvaluate: current.canEvaluate,
      canExecute: current.canExecute,
      canPause: current.canPause,
      canChangeStrategy: current.canChangeStrategy,
      active: false
    });
  }

  return (
    <section className="mx-auto max-w-7xl bg-slate-950 px-6 py-8 text-slate-100">
      <h1 className="text-2xl font-bold">Automation Center</h1>
      <SectionHeader title="Automation Controls" description="自動化設定を安全装置とセットで管理します。" />
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="text-slate-400">automation target context</p>
          <button
            type="button"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
            aria-pressed={!targetContextCollapsed}
            aria-expanded={!targetContextCollapsed}
            aria-controls={TARGET_CONTEXT_PANEL_ID}
            title={`Shortcut: ${SHORTCUTS.AUTOMATION_TARGET_CONTEXT_TOGGLE.keys}`}
            onClick={() => setTargetContextCollapsed((prev) => !prev)}
          >
            {targetContextCollapsed ? "Show Target Context" : "Hide Target Context"}
          </button>
        </div>
        {!targetContextCollapsed ? (
          <div id={TARGET_CONTEXT_PANEL_ID}>
            <p className="mt-1 text-slate-300">target owner: {historyWallet ?? "-"}</p>
            <p className="mt-1 text-slate-400">scope: {actorScopeText}</p>
          </div>
        ) : null}
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-xs text-slate-400">Worker Runtime</p>
        {runtimeConfigQuery.isError ? (
          <p className="mt-1 text-xs text-red-400">{runtimeConfigQuery.error instanceof Error ? runtimeConfigQuery.error.message : "設定取得に失敗しました。"}</p>
        ) : runtimeConfigQuery.data ? (
          <div className="mt-2 space-y-1 text-sm">
            <p>
              execution:{" "}
              <span className={runtimeConfigQuery.data.executionEnabled ? "text-emerald-300" : "text-yellow-300"}>
                {runtimeConfigQuery.data.executionEnabled ? "guarded execute enabled" : "dry-run only"}
              </span>
            </p>
            <p className="text-slate-300">minimum net benefit: ${runtimeConfigQuery.data.minimumNetBenefitUsd.toFixed(2)}</p>
            <p>
              auto-compound:{" "}
              <span className={runtimeConfigQuery.data.autoCompoundEnabled ? "text-emerald-300" : "text-yellow-300"}>
                {runtimeConfigQuery.data.autoCompoundEnabled ? "enabled" : "disabled"}
              </span>
            </p>
            <p className="text-slate-300">minimum compound fees: ${runtimeConfigQuery.data.minimumCompoundFeesUsd.toFixed(2)}</p>
            <p>
              relayer:{" "}
              <span className={runtimeConfigQuery.data.relayer?.ready ? "text-emerald-300" : "text-yellow-300"}>
                {runtimeConfigQuery.data.relayer?.ready
                  ? "ready"
                  : runtimeConfigQuery.data.relayer?.enabled
                    ? "enabled (url missing)"
                    : "disabled"}
              </span>
            </p>
            <p className="text-slate-300">
              relayer wait confirmation: {runtimeConfigQuery.data.relayer?.waitConfirmation ? "on" : "off"}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">読み込み中...</p>
        )}
        <div className="mt-3">
          <Button
            className="h-9"
            variant="outline"
            disabled={!address || syncOverviewQuery.isFetching}
            onClick={() => void refreshSecuredViews()}
          >
            {syncOverviewQuery.isFetching
              ? "Refreshing..."
              : signedViewsLoaded
                ? "Refresh Signed Views"
                : "Load Signed Views"}
          </Button>
          {securedRefreshMessage && <p className="mt-2 text-xs text-slate-300">{securedRefreshMessage}</p>}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-xs text-slate-400">Preflight Check</p>
        {preflightQuery.isError ? (
          <p className="mt-1 text-xs text-red-400">
            {preflightQuery.error instanceof Error ? preflightQuery.error.message : "preflight 取得に失敗しました。"}
          </p>
        ) : preflightQuery.data ? (
          <div className="mt-2 space-y-2">
            <p className={preflightQuery.data.ok ? "text-emerald-300" : "text-red-300"}>
              {preflightQuery.data.ok
                ? `ready (${preflightQuery.data.summary.ok}/${preflightQuery.data.summary.total})`
                : `not ready (error=${preflightQuery.data.summary.error}, warn=${preflightQuery.data.summary.warn})`}
            </p>
            {preflightQuery.data.checks.map((item) => (
              <p key={item.id} className="text-xs text-slate-300">
                [{item.status}] {item.label}: {item.message}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">読み込み中...</p>
        )}
        <div className="mt-3">
          <Button
            className="h-9"
            variant="outline"
            disabled={!canRunSmoke}
            onClick={() => void runSmokeDryRun()}
          >
            {smokeMutation.isPending ? "Smoke Running..." : "Run Smoke Test (Dry-run)"}
          </Button>
          <div className="mt-3 space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
            <p className="text-xs text-slate-400">LIVE Smoke (Relayer required)</p>
            <label className="block text-xs text-slate-300">
              txRequest.to
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100"
                value={liveSmokeTo}
                onChange={(e) => setLiveSmokeTo(e.target.value)}
                placeholder="0x..."
              />
            </label>
            <label className="block text-xs text-slate-300">
              txRequest.data
              <textarea
                className="mt-1 h-20 w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100"
                value={liveSmokeData}
                onChange={(e) => setLiveSmokeData(e.target.value)}
                placeholder="0x..."
              />
            </label>
            <Button
              className="h-9"
              variant="outline"
              disabled={!canRunSmoke}
              onClick={() => setConfirmLiveSmoke(true)}
            >
              {smokeMutation.isPending ? "Live Smoke Running..." : "Run Smoke Test (LIVE)"}
            </Button>
          </div>
          {executeActionBlockedReason ? <p className="mt-2 text-xs text-amber-300">{executeActionBlockedReason}</p> : null}
          {smokeMessage ? <p className="mt-2 text-xs text-slate-300">{smokeMessage}</p> : null}
          {smokeTxHash
            ? (() => {
                const url = getExplorerTxUrl(smokeTxChainId, smokeTxHash);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-blue-300 underline-offset-2 hover:underline"
                  >
                    smoke tx: {shortTx(smokeTxHash)}
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">smoke tx: {shortTx(smokeTxHash)}</p>
                );
              })()
            : null}
          {smokeHistory.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-400">Recent Smoke Results (latest 3)</p>
                <Button
                  className="h-7 px-2 text-[11px]"
                  variant="outline"
                  onClick={() => {
                    smokeHistoryStorage.remove({ resetValue: true });
                    setSmokeMessage("Smoke履歴をクリアしました。");
                  }}
                >
                  Clear
                </Button>
              </div>
              {smokeHistory.map((item) => {
                const txUrl = item.txHash ? getExplorerTxUrl(item.chainId ?? undefined, item.txHash) : null;
                return (
                  <div
                    key={item.id}
                    className={`rounded border p-2 text-xs ${
                      item.success
                        ? "border-emerald-800 bg-emerald-950/30 text-emerald-200"
                        : "border-red-900 bg-red-950/30 text-red-200"
                    }`}
                  >
                    <p>
                      [{item.mode}] {item.success ? "SUCCESS" : "FAILED"} / {item.message}
                    </p>
                    <p className="mt-1 text-[11px] opacity-80">
                      job={item.jobId ?? "n/a"} / execution={item.executionId ?? "n/a"} / status=
                      {item.executionStatus ?? "n/a"} / txStatus={item.txStatus ?? "n/a"}
                    </p>
                    <p className="mt-1 text-[11px] opacity-70">
                      <TimestampWithAge iso={item.createdAt} compact />
                    </p>
                    {item.txHash ? (
                      txUrl ? (
                        <a href={txUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block underline">
                          tx: {shortTx(item.txHash)}
                        </a>
                      ) : (
                        <p className="mt-1 text-[11px]">tx: {shortTx(item.txHash)}</p>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-xs text-slate-400">Automation Metrics (signed)</p>
        {!signedViewsLoaded ? (
          <p className="mt-1 text-xs text-slate-400">Load Signed Views を押すとメトリクスを取得します。</p>
        ) : metricsQuery.isLoading ? (
          <p className="mt-1 text-xs text-slate-400">読み込み中...</p>
        ) : metricsQuery.isError ? (
          <p className="mt-1 text-xs text-red-400">
            {metricsQuery.error instanceof Error ? metricsQuery.error.message : "メトリクス取得に失敗しました。"}
          </p>
        ) : metricsQuery.data ? (
          <div className="mt-2 space-y-2">
            <p className="text-slate-300">
              total={metricsQuery.data.total} / completed={metricsQuery.data.completed} / failed={metricsQuery.data.failed} /
              precheckFailed={metricsQuery.data.precheckFailed}
            </p>
            <p className="text-slate-300">
              {`successRate=${(metricsQuery.data.successRate * 100).toFixed(1)}% / relayerFailureCount=${metricsQuery.data.relayerFailureCount}`}
            </p>
            {metricsQuery.data.alerts.degradedSuccessRate ||
            metricsQuery.data.alerts.elevatedRelayerFailureRate ||
            metricsQuery.data.alerts.elevatedP95ElapsedMs ? (
              <WarningBox
                type="WARNING"
                title="Automation Metrics Alert"
                description={`latest=${metricsQuery.data.alerts.latestBucketStart ?? "n/a"} / success<${
                  (metricsQuery.data.alertThresholds.minSuccessRate * 100).toFixed(0)
                }%=${metricsQuery.data.alerts.degradedSuccessRate ? "yes" : "no"} / relayerFailure>${
                  (metricsQuery.data.alertThresholds.maxRelayerFailureRate * 100).toFixed(0)
                }%=${metricsQuery.data.alerts.elevatedRelayerFailureRate ? "yes" : "no"} / p95>${
                  metricsQuery.data.alertThresholds.maxP95ElapsedMs
                }ms=${metricsQuery.data.alerts.elevatedP95ElapsedMs ? "yes" : "no"}`}
              />
            ) : null}
            {metricsQuery.data.trend.length > 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">
                {(() => {
                  const latest = metricsQuery.data.trend[metricsQuery.data.trend.length - 1];
                  const trendWindow = metricsQuery.data.trend.slice(-6);
                  const baseline = computeTrendBaseline(trendWindow);
                  return (
                    <>
                      <p>
                        latest bucket: <TimestampWithAge iso={latest.bucketStart} compact />
                      </p>
                      <p>
                        success={(latest.successRate * 100).toFixed(1)}% / relayerFailure={(latest.relayerFailureRate * 100).toFixed(1)}% /
                        p95={latest.p95ElapsedMs ?? "n/a"}ms
                      </p>
                      <p className="text-[11px] text-slate-400">
                        vs avg(6): success{" "}
                        <span className={getDeltaToneClass((latest.successRate - baseline.successRateAvg) * 100, "higher_better")}>
                          {formatSignedPercent((latest.successRate - baseline.successRateAvg) * 100)}
                        </span>{" "}
                        / relayerFailure{" "}
                        <span
                          className={getDeltaToneClass(
                            (latest.relayerFailureRate - baseline.relayerFailureRateAvg) * 100,
                            "lower_better"
                          )}
                        >
                          {formatSignedPercent((latest.relayerFailureRate - baseline.relayerFailureRateAvg) * 100)}
                        </span>{" "}
                        / p95{" "}
                        <span
                          className={getDeltaToneClass(
                            (latest.p95ElapsedMs ?? baseline.p95ElapsedMsAvg) - baseline.p95ElapsedMsAvg,
                            "lower_better"
                          )}
                        >
                          {formatSignedMs((latest.p95ElapsedMs ?? baseline.p95ElapsedMsAvg) - baseline.p95ElapsedMsAvg)}
                        </span>
                      </p>
                      {metricsQuery.data.trend.length >= 2 ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-[11px] text-slate-400">trend chart (success/relayerFailure)</p>
                          <MiniTrendChart
                            successRates={metricsQuery.data.trend.map((x) => x.successRate)}
                            relayerFailureRates={metricsQuery.data.trend.map((x) => x.relayerFailureRate)}
                          />
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="text-xs text-slate-400">trend data はまだありません。</p>
            )}
            {metricsQuery.data.byType.length > 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">
                <p className="font-medium text-slate-200">By Type</p>
                <div className="mt-2 space-y-1">
                  {metricsQuery.data.byType.map((row) => {
                    const ratio = row.total > 0 ? row.completed / row.total : 0;
                    const width = Math.max(4, Math.min(100, Math.round(ratio * 100)));
                    return (
                      <div key={row.type} className="space-y-1">
                        <p>
                          {row.type}: total={row.total}, ok={row.completed}, failed={row.failed}, precheck={row.precheckFailed}
                        </p>
                        <div className="h-2 w-full rounded bg-slate-800">
                          <div className="h-2 rounded bg-emerald-500" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {metricsQuery.data.failureByErrorCode.length > 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">
                <p className="font-medium text-slate-200">Top Failure Codes</p>
                <div className="mt-2 space-y-1">
                  {metricsQuery.data.failureByErrorCode.slice(0, 5).map((row) => (
                    <p key={row.errorCode}>
                      {row.errorCode}: {row.count} (last: <TimestampWithAge iso={row.lastSeenAt} compact />)
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-xs text-slate-400">Sync Status (chain {chain?.id ?? 42161})</p>
        {!signedViewsLoaded ? (
          <p className="mt-1 text-xs text-slate-400">未取得です。Load Signed Views を押すと取得します。</p>
        ) : syncOverviewQuery.isError ? (
          <p className="mt-1 text-xs text-red-400">
            {syncOverviewQuery.error instanceof Error ? syncOverviewQuery.error.message : "sync status の取得に失敗しました。"}
          </p>
        ) : syncOverviewQuery.data ? (
          <div className="mt-2 space-y-1 text-sm">
            <div className="rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">
              <p>chain: {syncOverviewQuery.data.chainId}</p>
              <p>
                success={syncOverviewQuery.data.syncStatus.successCount} / partial={syncOverviewQuery.data.syncStatus.partialCount} /
                error={syncOverviewQuery.data.syncStatus.errorCount} / never={syncOverviewQuery.data.syncStatus.neverCount}
              </p>
              <p>onchain owned: {syncOverviewQuery.data.syncStatus.onchainStatesOwnedCount}</p>
              <p>
                actor={syncOverviewQuery.data.actorRole} / triggeredBy={syncOverviewQuery.data.triggeredByWallet}
              </p>
              {syncOverviewQuery.data.syncStatus.lastSyncSuccessAt ? (
                <p>
                  last success: <TimestampWithAge iso={syncOverviewQuery.data.syncStatus.lastSyncSuccessAt} compact />
                </p>
              ) : null}
              {syncOverviewQuery.data.syncStatus.latestSyncError ? (
                <p className="text-red-400">latest error: {syncOverviewQuery.data.syncStatus.latestSyncError}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">読み込み中...</p>
        )}
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-xs text-slate-400">NFT Indexing Coverage (chain {chain?.id ?? 42161})</p>
        {!signedViewsLoaded ? (
          <p className="mt-1 text-xs text-slate-400">未取得です。Load Signed Views を押すと取得します。</p>
        ) : syncOverviewQuery.isError ? (
          <p className="mt-1 text-xs text-red-400">{syncOverviewQuery.error instanceof Error ? syncOverviewQuery.error.message : "インデックス取得に失敗しました。"}</p>
        ) : syncOverviewQuery.data ? (
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-slate-300">indexed positions: {syncOverviewQuery.data.indexing.totalIndexed}</p>
            <p className="text-slate-300">matched local: {syncOverviewQuery.data.indexing.matchedLocalCount}</p>
            <p className="text-slate-300">unmatched discovered: {syncOverviewQuery.data.indexing.unmatchedDiscoveredCount}</p>
            <p className="text-xs text-slate-400">
              updated: <TimestampWithAge iso={syncOverviewQuery.data.indexing.indexedAt} compact />
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">読み込み中...</p>
        )}
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-sm font-semibold">Automation Mode</p>
        <div className="mt-2 flex gap-2">
          {(["MANUAL", "SEMI_AUTO", "AUTO"] as const).map((mode) => (
            <button
              key={mode}
              className={`rounded px-3 py-1 ${settings.automationMode === mode ? "bg-blue-600 text-white" : "border border-slate-700 bg-slate-800 text-slate-100"}`}
              onClick={() => setSettings((prev) => ({ ...prev, automationMode: mode }))}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Manual: 提案のみ / Semi-Auto: 承認後実行 / Auto: 条件一致で実行候補（worker連携）
        </p>
      </div>

      <div className="mt-6 grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm md:grid-cols-2">
        <label>
          <span className="text-xs text-slate-400">strategy mode</span>
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
            value={settings.strategyMode}
            onChange={(e) => setSettings((prev) => ({ ...prev, strategyMode: e.target.value as typeof prev.strategyMode }))}
          >
            <option value="CONSERVATIVE">CONSERVATIVE</option>
            <option value="BALANCED">BALANCED</option>
            <option value="AGGRESSIVE">AGGRESSIVE</option>
          </select>
        </label>
        <NumberField label="min net benefit usd" value={settings.minNetBenefitUsd} onChange={(v) => setSettings((prev) => ({ ...prev, minNetBenefitUsd: v }))} />
        <NumberField label="cooldown minutes" value={settings.cooldownMinutes} onChange={(v) => setSettings((prev) => ({ ...prev, cooldownMinutes: v }))} />
        <NumberField label="max gas cost usd" value={settings.maxGasCostUsd} onChange={(v) => setSettings((prev) => ({ ...prev, maxGasCostUsd: v }))} />
        <NumberField
          label="volatility safety threshold"
          value={settings.volatilitySafetyThreshold}
          onChange={(v) => setSettings((prev) => ({ ...prev, volatilitySafetyThreshold: v }))}
          step={0.001}
        />
        <Toggle label="stale snapshot reject" checked={settings.staleSnapshotReject} onChange={(checked) => setSettings((prev) => ({ ...prev, staleSnapshotReject: checked }))} />
        <Toggle label="auto collect enabled" checked={settings.autoCollectEnabled} onChange={(checked) => setSettings((prev) => ({ ...prev, autoCollectEnabled: checked }))} />
        <Toggle label="auto rebalance enabled" checked={settings.autoRebalanceEnabled} onChange={(checked) => setSettings((prev) => ({ ...prev, autoRebalanceEnabled: checked }))} />
        <Toggle
          label="emergency paused"
          checked={settings.emergencyPaused}
          disabled={actingAsOperator && !canPauseByRole}
          onChange={(checked) => setSettings((prev) => ({ ...prev, emergencyPaused: checked }))}
        />
        <label className="md:col-span-2">
          <span className="text-xs text-slate-400">settings target position</span>
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
            value={settingsPositionTarget}
            onChange={(e) => setSettingsPositionTarget(e.target.value)}
          >
            <option value={GLOBAL_POSITION_KEY}>GLOBAL (wallet-level)</option>
            {(positionsQuery.data ?? []).map((position) => (
              <option key={position.id} value={position.id}>
                {position.token0Symbol}/{position.token1Symbol} #{position.id}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <Button
            className="h-8 px-2 text-xs"
            variant="outline"
            disabled={!canCopyGlobalToSingle}
            onClick={() => void copyGlobalSettingsToSelectedPosition()}
          >
            {saveSettingsMutation.isPending ? "Copying..." : "Copy GLOBAL -> Selected Position"}
          </Button>
          <p className="pt-2 text-xs text-slate-400">
            GLOBALの execution/rebalance/compound/gas 条件を、選択中ポジションに複製します。
          </p>
        </div>
        <div className="md:col-span-2 rounded border border-slate-800 bg-slate-950 p-3">
          <p className="text-xs text-slate-400">Batch copy targets</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {(positionsQuery.data ?? []).map((position) => {
              const checked = batchTargetPositionIds.includes(position.id);
              return (
                <label key={`batch-${position.id}`} className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setBatchTargetPositionIds((prev) =>
                        on ? Array.from(new Set([...prev, position.id])) : prev.filter((id) => id !== position.id)
                      );
                    }}
                  />
                  {position.token0Symbol}/{position.token1Symbol} #{position.id}
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="h-8 px-2 text-xs"
              variant="outline"
              disabled={!canOpenBatchCopy}
              onClick={() => setConfirmBatchCopy(true)}
            >
              {saveSettingsMutation.isPending ? "Batch Copying..." : `Copy GLOBAL -> ${batchTargetPositionIds.length} Selected`}
            </Button>
            <Button
              className="h-8 px-2 text-xs"
              variant="outline"
              disabled={batchTargetPositionIds.length === 0}
              onClick={() => setBatchTargetPositionIds([])}
            >
              Clear Selected
            </Button>
          </div>
        </div>
        <label className="md:col-span-2">
          <span className="text-xs text-slate-400">target owner wallet (optional, operator mode)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
            placeholder="0x... (empty = connected wallet)"
            value={targetOwnerWallet}
            onChange={(e) => setTargetOwnerWallet(e.target.value)}
          />
        </label>
        {settingsActionBlockedReason ? (
          <p className="md:col-span-2 text-xs text-amber-300">{settingsActionBlockedReason}</p>
        ) : null}
        {actingAsOperator && loadOperatorsMutation.isPending ? (
          <p className="md:col-span-2 text-xs text-slate-400">operator権限を確認中です...</p>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">Saved Automation Settings</p>
          <Button
            className="h-8 px-2 text-xs"
            variant="outline"
            disabled={!signedViewsLoaded || settingsQuery.isFetching}
            onClick={() => void settingsQuery.refetch()}
          >
            {settingsQuery.isFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        {!signedViewsLoaded ? (
          <p className="mt-2 text-xs text-slate-400">Load Signed Views を押すと設定一覧を取得します。</p>
        ) : settingsQuery.isError ? (
          <p className="mt-2 text-xs text-red-400">
            {settingsQuery.error instanceof Error ? settingsQuery.error.message : "設定一覧の取得に失敗しました。"}
          </p>
        ) : settingsQuery.data && settingsQuery.data.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="px-2 py-2">target</th>
                  <th className="px-2 py-2">source</th>
                  <th className="px-2 py-2">mode</th>
                  <th className="px-2 py-2">rebalance</th>
                  <th className="px-2 py-2">compound</th>
                  <th className="px-2 py-2">maxGasUsd</th>
                  <th className="px-2 py-2">updated</th>
                  <th className="px-2 py-2">action</th>
                </tr>
              </thead>
              <tbody>
                {settingsQuery.data.map((row) => {
                  const pos = (positionsQuery.data ?? []).find((item) => item.id === row.positionId);
                  const label = row.positionId
                    ? `${pos ? `${pos.token0Symbol}/${pos.token1Symbol}` : "position"} #${row.positionId}`
                    : "GLOBAL";
                  return (
                    <tr key={row.id} className="border-b border-slate-900/80 text-slate-200">
                      <td className="px-2 py-2">{label}</td>
                      <td className="px-2 py-2">{row.source ?? "automation_setting"}</td>
                      <td className="px-2 py-2">{row.executionMode}</td>
                      <td className="px-2 py-2">{row.autoRebalanceEnabled ? "ON" : "OFF"}</td>
                      <td className="px-2 py-2">{row.autoCompoundEnabled ? "ON" : "OFF"}</td>
                      <td className="px-2 py-2">{row.maxGasUsd ?? "-"}</td>
                      <td className="px-2 py-2">
                        <TimestampWithAge iso={row.updatedAt} compact />
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          className="h-7 px-2 text-[11px]"
                          variant="outline"
                          onClick={() => {
                            setSettingsPositionTarget(row.positionId ?? GLOBAL_POSITION_KEY);
                            setSettings((prev) => ({
                              ...prev,
                              automationMode: row.executionMode === "AUTO_EXECUTE" ? "AUTO" : "SEMI_AUTO",
                              maxGasCostUsd: row.maxGasUsd ?? prev.maxGasCostUsd,
                              autoCollectEnabled: row.autoCompoundEnabled,
                              autoRebalanceEnabled: row.autoRebalanceEnabled
                            }));
                            setSettingsServerMessage(`Loaded row into form: ${label}`);
                          }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">設定はまだありません。</p>
        )}
      </div>

      <div className="mt-6">
        <AutomationSafetyPanel
          automationMode={settings.automationMode}
          minNetBenefitUsd={settings.minNetBenefitUsd}
          cooldownMinutes={settings.cooldownMinutes}
          maxGasCostUsd={settings.maxGasCostUsd}
          staleSnapshotReject={settings.staleSnapshotReject}
          volatilitySafetyThreshold={settings.volatilitySafetyThreshold}
          autoCollectEnabled={settings.autoCollectEnabled}
          autoRebalanceEnabled={settings.autoRebalanceEnabled}
          lastAutoActionAt={null}
          nextEligibleRebalanceAt={null}
        />
      </div>
      {hasRiskyConfig ? (
        <WarningBox
          type="WARNING"
          title="Automation Warning"
          description="stale snapshot reject が無効、または min net benefit が 0 以下です。不要な実行リスクが増えます。"
          className="mt-6"
        />
      ) : (
        <WarningBox type="SUCCESS" title="Safety Checks" description="主要な安全装置が有効です。実行前に Preview を確認してください。" className="mt-6" />
      )}
      {saved && <p className="mt-3 text-xs text-emerald-300">サーバー設定を保存しました。</p>}
      {saveError && <p className="mt-3 text-xs text-red-400">{saveError}</p>}
      {settingsServerMessage && <p className="mt-2 text-xs text-slate-300">{settingsServerMessage}</p>}
      {workerMessage && <p className="mt-2 text-xs text-slate-300">{workerMessage}</p>}
      {!address && <p className="mt-2 text-xs text-amber-300">Worker実行にはウォレット接続が必要です。</p>}
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-sm font-semibold text-slate-100">Owner / Operator Permissions</p>
        <p className="mt-1 text-xs text-slate-400">
          owner と operator の権限を分離します。operator は canEvaluate / canExecute を個別に設定できます。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="text-xs text-slate-400">owner wallet (target)</span>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
              value={ownerWalletForPermission ?? ""}
              readOnly
            />
          </label>
          <label className="md:col-span-2">
            <span className="text-xs text-slate-400">operator wallet</span>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
              placeholder="0x..."
              value={operatorWalletInput}
              onChange={(e) => setOperatorWalletInput(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-slate-200">
            <input type="checkbox" checked={operatorCanEvaluate} onChange={(e) => setOperatorCanEvaluate(e.target.checked)} />
            canEvaluate
          </label>
          <label className="flex items-center gap-2 text-slate-200">
            <input type="checkbox" checked={operatorCanExecute} onChange={(e) => setOperatorCanExecute(e.target.checked)} />
            canExecute
          </label>
          <label className="flex items-center gap-2 text-slate-200">
            <input type="checkbox" checked={operatorCanPause} onChange={(e) => setOperatorCanPause(e.target.checked)} />
            canPause
          </label>
          <label className="flex items-center gap-2 text-slate-200">
            <input
              type="checkbox"
              checked={operatorCanChangeStrategy}
              onChange={(e) => setOperatorCanChangeStrategy(e.target.checked)}
            />
            canChangeStrategy
          </label>
          <label className="flex items-center gap-2 text-slate-200">
            <input type="checkbox" checked={operatorActive} onChange={(e) => setOperatorActive(e.target.checked)} />
            active
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="h-10" disabled={!address || loadOperatorsMutation.isPending} onClick={loadOperatorPermissions}>
            {loadOperatorsMutation.isPending ? "Loading..." : "Load Permissions"}
          </Button>
          <Button className="h-10" disabled={!address || upsertOperatorMutation.isPending} onClick={saveOperatorPermission}>
            {upsertOperatorMutation.isPending ? "Saving..." : "Save Permission"}
          </Button>
        </div>
        {operatorMessage && <p className="mt-2 text-xs text-slate-300">{operatorMessage}</p>}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label>
            <span className="text-xs text-slate-400">search operator</span>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
              placeholder="0x... / partial"
              value={operatorSearch}
              onChange={(e) => setOperatorSearch(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-slate-200 md:pt-6">
            <input
              type="checkbox"
              checked={showInactiveOperators}
              onChange={(e) => setShowInactiveOperators(e.target.checked)}
            />
            show inactive operators
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          visible {visibleOperators.length} / total {operators.length}
        </p>
        <div className="mt-3 space-y-2">
          {operators.length === 0 && <p className="text-xs text-slate-400">permission はまだありません。</p>}
          {operators.length > 0 && visibleOperators.length === 0 && (
            <p className="text-xs text-slate-400">条件に一致する operator はありません。</p>
          )}
          {visibleOperators.map((item) => (
            <div key={`${item.ownerWallet}:${item.operatorWallet}`} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-xs text-slate-200">operator: {item.operatorWallet}</p>
              <p className="mt-1 text-xs text-slate-300">
                evaluate={item.canEvaluate ? "true" : "false"} / execute={item.canExecute ? "true" : "false"} / pause=
                {item.canPause ? "true" : "false"} / strategy={item.canChangeStrategy ? "true" : "false"} / active=
                {item.active ? "true" : "false"}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                updated: <TimestampWithAge iso={item.updatedAt} compact />
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  className="h-8 px-2 text-xs"
                  variant="outline"
                  disabled={upsertOperatorMutation.isPending || !item.active}
                  onClick={() =>
                    toggleOperatorFlags({
                      operatorWallet: item.operatorWallet,
                      nextCanEvaluate: !item.canEvaluate
                    })
                  }
                >
                  canEvaluate: {item.canEvaluate ? "ON" : "OFF"}
                </Button>
                <Button
                  className="h-8 px-2 text-xs"
                  variant="outline"
                  disabled={upsertOperatorMutation.isPending || !item.active}
                  onClick={() =>
                    toggleOperatorFlags({
                      operatorWallet: item.operatorWallet,
                      nextCanExecute: !item.canExecute
                    })
                  }
                >
                  canExecute: {item.canExecute ? "ON" : "OFF"}
                </Button>
                <Button
                  className="h-8 px-2 text-xs"
                  variant="outline"
                  disabled={upsertOperatorMutation.isPending || !item.active}
                  onClick={() =>
                    toggleOperatorFlags({
                      operatorWallet: item.operatorWallet,
                      nextCanPause: !item.canPause
                    })
                  }
                >
                  canPause: {item.canPause ? "ON" : "OFF"}
                </Button>
                <Button
                  className="h-8 px-2 text-xs"
                  variant="outline"
                  disabled={upsertOperatorMutation.isPending || !item.active}
                  onClick={() =>
                    toggleOperatorFlags({
                      operatorWallet: item.operatorWallet,
                      nextCanChangeStrategy: !item.canChangeStrategy
                    })
                  }
                >
                  canChangeStrategy: {item.canChangeStrategy ? "ON" : "OFF"}
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  className="h-8 px-2 text-xs"
                  variant="outline"
                  onClick={() => {
                    setOperatorWalletInput(item.operatorWallet);
                    setOperatorCanEvaluate(item.canEvaluate);
                    setOperatorCanExecute(item.canExecute);
                    setOperatorCanPause(item.canPause);
                    setOperatorCanChangeStrategy(item.canChangeStrategy);
                    setOperatorActive(item.active);
                    setOperatorMessage("選択した operator をフォームに反映しました。");
                  }}
                >
                  Edit in Form
                </Button>
                {item.active ? (
                  <Button
                    className="h-8 px-2 text-xs"
                    variant="outline"
                    disabled={upsertOperatorMutation.isPending}
                    onClick={() => setConfirmDisableOperator({ operatorWallet: item.operatorWallet })}
                  >
                    Disable
                  </Button>
                ) : (
                  <Button
                    className="h-8 px-2 text-xs"
                    variant="outline"
                    disabled={upsertOperatorMutation.isPending}
                    onClick={() =>
                      applyOperatorPermissionQuick({
                        operatorWallet: item.operatorWallet,
                        canEvaluate: item.canEvaluate,
                        canExecute: item.canExecute,
                        canPause: item.canPause,
                        canChangeStrategy: item.canChangeStrategy,
                        active: true
                      })
                    }
                  >
                    Enable
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">Execution History (AutomationExecution)</p>
          {address && signedViewsLoaded && (
            <select
              value={executionStatusFilter}
              onChange={(e) => setExecutionStatusFilter(e.target.value as ExecutionStatusFilter)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="precheck_failed">Precheck Failed</option>
            </select>
          )}
        </div>
        {!address && <p className="mt-2 text-xs text-slate-400">ウォレット接続・署名後に実行履歴を表示します。</p>}
        {address && !signedViewsLoaded && <p className="mt-2 text-xs text-slate-400">署名済みビュー読み込み後に表示します。</p>}
        {address && signedViewsLoaded && executionsQuery.isLoading && <p className="mt-2 text-xs text-slate-400">読み込み中...</p>}
        {address && signedViewsLoaded && executionsQuery.isError && (
          <p className="mt-2 text-xs text-red-400">
            {executionsQuery.error instanceof Error ? executionsQuery.error.message : "実行履歴の取得に失敗しました。"}
          </p>
        )}
        {address && signedViewsLoaded && !executionsQuery.isLoading && !executionsQuery.isError && (executionsQuery.data ?? []).length === 0 && (
          <p className="mt-2 text-xs text-slate-400">実行履歴はまだありません。</p>
        )}
        {address && signedViewsLoaded && (executionsQuery.data ?? []).length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="px-2 py-2">Started</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Position</th>
                  <th className="px-2 py-2">Error</th>
                  <th className="px-2 py-2">Tx</th>
                  <th className="px-2 py-2">Cost/Net</th>
                </tr>
              </thead>
              <tbody>
                {(executionsQuery.data ?? []).map((ex) => (
                  <tr key={ex.id} className="border-b border-slate-800">
                    <td className="px-2 py-2">
                      <TimestampWithAge iso={ex.startedAt} compact />
                    </td>
                    <td className="px-2 py-2 font-medium">{ex.type}</td>
                    <td className="px-2 py-2">
                      <span
                        className={
                          ex.status === "COMPLETED" || ex.status === "TX_CONFIRMED" || ex.status === "SNAPSHOT_UPDATED"
                            ? "text-emerald-400"
                            : ex.status === "PRECHECK_FAILED" || ex.status === "FAILED"
                              ? "text-red-400"
                              : "text-slate-300"
                        }
                      >
                        {ex.status}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-400">{ex.positionId ?? "-"}</td>
                    <td className="max-w-[120px] truncate px-2 py-2 text-slate-500" title={ex.errorCode ?? ex.errorMessage ?? ""}>
                      {ex.errorCode ?? ex.errorMessage ?? "-"}
                    </td>
                    <td className="px-2 py-2">
                      {ex.txHash ? (
                        <a
                          href={getExplorerTxUrl(ex.chainId ?? 42161, ex.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-300 underline-offset-2 hover:underline"
                        >
                          {shortTx(ex.txHash)}
                        </a>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {ex.costUsd != null ? `$${ex.costUsd.toFixed(2)}` : "-"}
                      {ex.netProfitUsd != null && (
                        <span className={ex.netProfitUsd >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {" "}
                          / ${ex.netProfitUsd.toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p className="text-sm font-semibold text-slate-100">Recent Worker Activity</p>
        {!address && <p className="mt-2 text-xs text-slate-400">ウォレット接続後に worker 履歴を表示します。</p>}
        {address && activityQuery.isLoading && <p className="mt-2 text-xs text-slate-400">読み込み中...</p>}
        {address && activityQuery.isError && (
          <p className="mt-2 text-xs text-red-400">
            {activityQuery.error instanceof Error ? activityQuery.error.message : "worker履歴の取得に失敗しました。"}
          </p>
        )}
        {address && !activityQuery.isLoading && !activityQuery.isError && workerHistory.length === 0 && (
          <p className="mt-2 text-xs text-slate-400">worker イベントはまだありません。</p>
        )}
        {address && workerHistory.length > 0 && (
          <div className="mt-3 space-y-2">
            {workerHistory.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-medium text-slate-200">
                    {item.type} {item.positionId ? `#${item.positionId}` : ""}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    <TimestampWithAge iso={item.createdAt} compact />
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-300">{item.error ?? item.message}</p>
                {item.tx
                  ? (() => {
                      const txUrl = getExplorerTxUrl(item.chainId, item.tx);
                      return txUrl ? (
                        <a
                          href={txUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-[11px] text-blue-300 underline-offset-2 hover:underline"
                        >
                          tx: {shortTx(item.tx)}
                        </a>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-400">tx: {shortTx(item.tx)}</p>
                      );
                    })()
                  : null}
              </div>
            ))}
            <div className="pt-1">
              <Link
                href="/activity"
                className="inline-flex h-9 items-center rounded border border-slate-700 px-3 text-xs text-slate-200 hover:bg-slate-800"
              >
                すべての履歴を見る
              </Link>
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 hidden gap-2 sm:flex">
        <Button
          className="h-11"
          disabled={!canSaveSettings}
          onClick={() => void saveSettingsToServer()}
        >
          {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
        <Button className="h-11" disabled={!canRunEvaluate} onClick={runEvaluate}>
          {evaluateMutation.isPending ? "Running Worker..." : "Run Worker Evaluation"}
        </Button>
      </div>
      <RiskDisclosure />
      <MobileBottomActionBar>
        <Button
          className="h-11 flex-1"
          disabled={!canSaveSettings}
          onClick={() => void saveSettingsToServer()}
        >
          {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
        <Button className="h-11 flex-1" disabled={!canRunEvaluate} onClick={runEvaluate}>
          {evaluateMutation.isPending ? "Running..." : "Run Worker"}
        </Button>
      </MobileBottomActionBar>
      {evaluateActionBlockedReason ? <p className="mt-2 text-xs text-amber-300">{evaluateActionBlockedReason}</p> : null}
      <ConfirmDangerActionModal
        isOpen={confirmBatchCopy}
        title="Copy GLOBAL settings to selected positions?"
        description="選択したポジションへ GLOBAL 設定を一括適用します。対象を確認して実行してください。"
        details={[
          { label: "target count", value: String(batchTargetPositionIds.length) },
          {
            label: "dry-run summary",
            value: `compared=${batchCopyDryRunSummary.compared}, totalΔ=${batchCopyDryRunSummary.totalChanged}, modeΔ=${batchCopyDryRunSummary.modeChanged}, rebalanceΔ=${batchCopyDryRunSummary.rebalanceChanged}, compoundΔ=${batchCopyDryRunSummary.compoundChanged}, gasΔ=${batchCopyDryRunSummary.gasChanged}`
          },
          {
            label: "targets",
            value:
              batchTargetPositionIds
                .map((id) => {
                  const pos = (positionsQuery.data ?? []).find((item) => item.id === id);
                  return pos ? `${pos.token0Symbol}/${pos.token1Symbol}#${id}` : id;
                })
                .slice(0, 8)
                .join(", ") || "-"
          },
          {
            label: "sample changes",
            value: batchCopyDryRunSummary.sampleLines.join(" | ") || "-"
          }
        ]}
        confirmLabel={batchCopyDryRunSummary.totalChanged === 0 ? "No Changes" : "Run Batch Copy"}
        cancelLabel="Cancel"
        isConfirming={saveSettingsMutation.isPending || batchCopyDryRunSummary.totalChanged === 0}
        onCancel={() => {
          setConfirmBatchCopy(false);
          setSettingsServerMessage("一括コピーをキャンセルしました。");
        }}
        onConfirm={async () => {
          if (batchCopyDryRunSummary.totalChanged === 0) {
            setConfirmBatchCopy(false);
            setSettingsServerMessage("差分がないため一括コピーはスキップしました。");
            return;
          }
          setConfirmBatchCopy(false);
          await copyGlobalSettingsToBatchPositions();
        }}
      />
      <ConfirmDangerActionModal
        isOpen={confirmLiveSmoke}
        title="Run LIVE smoke test?"
        description="実際に relayer 送信が走る可能性があります。to/data/target wallet/chain を確認して実行してください。"
        details={[
          { label: "targetWallet", value: targetOwnerWallet.trim() || (address ?? "-") },
          { label: "chainId", value: String(chain?.id ?? "-") },
          { label: "to", value: liveSmokeTo.trim() || "-" },
          { label: "data", value: liveSmokeData.trim() || "-" }
        ]}
        confirmLabel="Run LIVE smoke"
        cancelLabel="Cancel"
        isConfirming={smokeMutation.isPending}
        onCancel={() => {
          setConfirmLiveSmoke(false);
          setSmokeMessage("LIVE smoke test をキャンセルしました。");
        }}
        onConfirm={async () => {
          setConfirmLiveSmoke(false);
          await runSmokeLive();
        }}
      />
      <ConfirmDangerActionModal
        isOpen={Boolean(confirmEnableExecute)}
        title="Enable canExecute?"
        description="実行系パスを許可します。意図した operator か確認してください。"
        details={
          confirmEnableExecute
            ? [
                { label: "operator", value: confirmEnableExecute.operatorWallet },
                { label: "owner", value: ownerWalletForPermission ?? "-" }
              ]
            : []
        }
        confirmLabel="Enable canExecute"
        cancelLabel="Cancel"
        isConfirming={upsertOperatorMutation.isPending}
        onCancel={() => {
          setConfirmEnableExecute(null);
          setOperatorMessage("canExecute の更新をキャンセルしました。");
        }}
        onConfirm={() => void confirmEnableExecuteNow()}
      />
      <ConfirmDangerActionModal
        isOpen={Boolean(confirmDisableOperator)}
        title="Disable operator?"
        description="この operator の active を false に変更します。owner が再度有効化するまで evaluate/execute は許可されません。"
        details={
          confirmDisableOperator
            ? [
                { label: "operator", value: confirmDisableOperator.operatorWallet },
                { label: "owner", value: ownerWalletForPermission ?? "-" }
              ]
            : []
        }
        confirmLabel="Disable operator"
        cancelLabel="Cancel"
        isConfirming={upsertOperatorMutation.isPending}
        onCancel={() => {
          setConfirmDisableOperator(null);
          setOperatorMessage("operator の無効化をキャンセルしました。");
        }}
        onConfirm={() => void confirmDisableOperatorNow()}
      />
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "text-slate-500" : "text-slate-200"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
}) {
  return (
    <label>
      <span className="text-xs text-slate-400">{label}</span>
      <input
        className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-slate-100"
        type="number"
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function MiniTrendChart({
  successRates,
  relayerFailureRates
}: {
  successRates: number[];
  relayerFailureRates: number[];
}) {
  const width = 320;
  const height = 80;
  const pad = 6;
  const count = Math.max(successRates.length, relayerFailureRates.length);
  if (count < 2) return null;
  const toPoints = (values: number[]) =>
    values
      .map((value, idx) => {
        const x = pad + ((width - pad * 2) * idx) / Math.max(1, values.length - 1);
        const ratio = Math.min(1, Math.max(0, value));
        const y = pad + (height - pad * 2) * (1 - ratio);
        return `${x},${y}`;
      })
      .join(" ");
  const successLine = toPoints(successRates);
  const relayerLine = toPoints(relayerFailureRates);
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="rounded border border-slate-800 bg-slate-900">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#334155" strokeWidth="1" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#334155" strokeWidth="1" />
        <polyline points={successLine} fill="none" stroke="#34d399" strokeWidth="2" />
        <polyline points={relayerLine} fill="none" stroke="#f59e0b" strokeWidth="2" />
      </svg>
      <p className="mt-1 text-[11px] text-slate-400">
        <span className="text-emerald-300">success</span> / <span className="text-amber-300">relayerFailure</span>
      </p>
    </div>
  );
}

function computeTrendBaseline(
  items: Array<{ successRate: number; relayerFailureRate: number; p95ElapsedMs: number | null }>
): {
  successRateAvg: number;
  relayerFailureRateAvg: number;
  p95ElapsedMsAvg: number;
} {
  if (items.length === 0) {
    return {
      successRateAvg: 0,
      relayerFailureRateAvg: 0,
      p95ElapsedMsAvg: 0
    };
  }
  const successRateAvg = items.reduce((acc, row) => acc + row.successRate, 0) / items.length;
  const relayerFailureRateAvg = items.reduce((acc, row) => acc + row.relayerFailureRate, 0) / items.length;
  const p95Samples = items.map((row) => row.p95ElapsedMs).filter((value): value is number => typeof value === "number");
  const p95ElapsedMsAvg =
    p95Samples.length > 0 ? p95Samples.reduce((acc, value) => acc + value, 0) / p95Samples.length : 0;
  return {
    successRateAvg,
    relayerFailureRateAvg,
    p95ElapsedMsAvg
  };
}

function formatSignedPercent(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatSignedMs(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${Math.round(value)}ms`;
}

function getDeltaToneClass(value: number, direction: "higher_better" | "lower_better"): string {
  if (value === 0) return "text-slate-300";
  const positiveIsGood = direction === "higher_better";
  const improved = positiveIsGood ? value > 0 : value < 0;
  return improved ? "text-emerald-300" : "text-red-300";
}

