"use client";

import { useEffect, useState } from "react";
import type { StrategyMode } from "@/lib/strategy/types";

export type AutomationMode = "MANUAL" | "SEMI_AUTO" | "AUTO";

export interface AutomationSettings {
  automationMode: AutomationMode;
  strategyMode: StrategyMode;
  minNetBenefitUsd: number;
  cooldownMinutes: number;
  maxGasCostUsd: number;
  volatilitySafetyThreshold: number;
  staleSnapshotReject: boolean;
  autoCollectEnabled: boolean;
  autoRebalanceEnabled: boolean;
  emergencyPaused: boolean;
}

const KEY = "lp_manager_automation_settings_v1";

const DEFAULTS: AutomationSettings = {
  automationMode: "MANUAL",
  strategyMode: "BALANCED",
  minNetBenefitUsd: 5,
  cooldownMinutes: 45,
  maxGasCostUsd: 15,
  volatilitySafetyThreshold: 0.02,
  staleSnapshotReject: true,
  autoCollectEnabled: false,
  autoRebalanceEnabled: false,
  emergencyPaused: false
};

export function useAutomationSettings() {
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULTS);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<AutomationSettings>;
      setSettings({ ...DEFAULTS, ...parsed });
    } catch {
      // Ignore malformed data.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings));
  }, [settings]);

  return { settings, setSettings };
}
