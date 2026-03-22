"use client";

import { useAccount } from "wagmi";
import { useAutomationSettings } from "@/hooks/use-automation-settings";
import { useLocalStorageBoolean } from "@/hooks/use-local-storage-boolean";
import { useKeySequenceShortcut } from "@/hooks/use-key-sequence-shortcut";
import { ActorContextBanner } from "@/components/common/actor-context-banner";
import { KEY_SEQUENCE_INTERVAL_MS, SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { UI_PREFERENCE_KEYS } from "@/lib/ui-preference-keys";

const GLOBAL_CONTEXT_PANEL_ID = "global-actor-context-panel";

export function GlobalActorContextBanner() {
  const { address } = useAccount();
  const { settings } = useAutomationSettings();
  const [collapsed, setCollapsed] = useLocalStorageBoolean(UI_PREFERENCE_KEYS.GLOBAL_ACTOR_BANNER_COLLAPSED, true, {
    debugEventName: "global_actor_context_collapsed_changed"
  });
  const role = address ? "OWNER" : "NOT_CONNECTED";
  const scope = address ? ({ kind: "owner_full" } as const) : undefined;
  useKeySequenceShortcut({
    firstKey: SHORTCUTS.GLOBAL_CONTEXT_TOGGLE.firstKey,
    secondKey: SHORTCUTS.GLOBAL_CONTEXT_TOGGLE.secondKey,
    maxIntervalMs: KEY_SEQUENCE_INTERVAL_MS,
    onMatch: () => setCollapsed((prev) => !prev)
  });

  return (
    <div className="mt-4 mb-4">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
          aria-pressed={!collapsed}
          aria-expanded={!collapsed}
          aria-controls={GLOBAL_CONTEXT_PANEL_ID}
          title={`Shortcut: ${SHORTCUTS.GLOBAL_CONTEXT_TOGGLE.keys}`}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? "Show Context" : "Hide Context"}
        </button>
      </div>
      {!collapsed ? (
        <div id={GLOBAL_CONTEXT_PANEL_ID}>
          <ActorContextBanner
            size="compact"
            role={role}
            actorWallet={address}
            scope={scope}
            executionPaused={settings.emergencyPaused}
          />
        </div>
      ) : null}
    </div>
  );
}
