"use client";

import { Card } from "@/components/ui/card";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";

type AutomationMode = "MANUAL" | "SEMI_AUTO" | "AUTO";

interface Props {
  automationMode: AutomationMode;
  minNetBenefitUsd: number;
  cooldownMinutes: number;
  maxGasCostUsd: number;
  staleSnapshotReject: boolean;
  volatilitySafetyThreshold: number;
  autoCollectEnabled: boolean;
  autoRebalanceEnabled: boolean;
  lastAutoActionAt?: string | null;
  nextEligibleRebalanceAt?: string | null;
}

function modeDescription(mode: AutomationMode): string {
  if (mode === "MANUAL") return "提案のみ。実行は手動です。";
  if (mode === "SEMI_AUTO") return "提案後に承認し、承認後の実行を自動化できます。";
  return "条件一致で自動実行候補になります（worker連携）。";
}

export function AutomationSafetyPanel(props: Props) {
  const rules = [
    "Exact approval only",
    props.staleSnapshotReject ? "Reject stale snapshots" : "Allow stale snapshots (caution)",
    "Reject negative net benefit",
    "Max gas cost enforced",
    "Cooldown active"
  ];

  return (
    <Card>
      <p className="font-semibold">Automation Safety Panel</p>
      <p className="mt-2 text-sm">Mode: {props.automationMode}</p>
      <p className="text-xs text-slate-600">{modeDescription(props.automationMode)}</p>
      <div className="mt-3 space-y-1 text-sm text-slate-700">
        <p>Min net benefit: ${props.minNetBenefitUsd.toFixed(2)}</p>
        <p>Cooldown: {props.cooldownMinutes} min</p>
        <p>Max gas cost: ${props.maxGasCostUsd.toFixed(2)}</p>
        <p>Volatility safety threshold: {props.volatilitySafetyThreshold}</p>
        <p>Auto collect: {props.autoCollectEnabled ? "enabled" : "disabled"}</p>
        <p>Auto rebalance: {props.autoRebalanceEnabled ? "enabled" : "disabled"}</p>
      </div>
      <div className="mt-3 text-sm text-slate-700">
        <p className="font-medium">Safety rules</p>
        {rules.map((rule) => (
          <p key={rule}>✓ {rule}</p>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-600">
        <p>
          Last auto action: {props.lastAutoActionAt ? <TimestampWithAge iso={props.lastAutoActionAt} /> : "N/A (worker integration pending)"}
        </p>
        <p>
          Next eligible rebalance:{" "}
          {props.nextEligibleRebalanceAt ? <TimestampWithAge iso={props.nextEligibleRebalanceAt} /> : "N/A (scheduler integration pending)"}
        </p>
      </div>
    </Card>
  );
}
