"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useIsMac } from "@/hooks/use-is-mac";
import { useGlobalHotkey } from "@/hooks/use-global-hotkey";
import { useLocalStorageBoolean } from "@/hooks/use-local-storage-boolean";
import { SHORTCUTS, getShortcutHelpItems } from "@/lib/keyboard-shortcuts";
import { UI_PREFERENCE_KEYS, resetUiPreferences } from "@/lib/ui-preference-keys";
import { resetLocalData } from "@/lib/local-data-keys";

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const [armedReset, setArmedReset] = useState<null | "ui" | "data">(null);
  const [hideHelpButton, setHideHelpButton] = useLocalStorageBoolean(
    UI_PREFERENCE_KEYS.KEYBOARD_HELP_BUTTON_HIDDEN,
    false,
    {
      debugEventName: "keyboard_help_button_hidden_changed"
    }
  );
  const isMac = useIsMac();
  const pathname = usePathname();
  const shortcutItems = getShortcutHelpItems(pathname, isMac);
  useEffect(() => {
    if (!open) setArmedReset(null);
  }, [open]);
  useGlobalHotkey({
    key: "/",
    shiftKey: true,
    preventDefault: true,
    requireNoUnspecifiedModifiers: true,
    onTrigger: () => setOpen((prev) => !prev)
  });
  useGlobalHotkey({
    key: SHORTCUTS.CLOSE_DIALOGS.eventKey,
    enabled: open,
    preventDefault: true,
    onTrigger: () => setOpen(false)
  });

  return (
    <>
      {!hideHelpButton ? (
        <button
          type="button"
          aria-label="Show keyboard shortcuts"
          className="fixed bottom-24 right-4 z-40 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-200 shadow hover:bg-slate-800 md:bottom-6"
          title="Keyboard shortcuts (?)"
          onClick={() => setOpen(true)}
        >
          ?
        </button>
      ) : null}
      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/55 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <div
            className="mx-auto mt-16 max-w-md rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-100 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Keyboard Shortcuts</p>
              <button
                type="button"
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-3 space-y-2 text-xs text-slate-300">
              {shortcutItems.map((item) => (
                <p key={`${item.keys}:${item.label}`}>
                  <KeyCombo keys={item.keys} /> {item.label}
                </p>
              ))}
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={hideHelpButton}
                onChange={(e) => setHideHelpButton(e.target.checked)}
              />
              Hide ? button (you can still open help with ?)
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded border px-3 py-1 text-xs ${
                  armedReset === "ui"
                    ? "border-red-500 bg-red-800/60 text-red-100"
                    : "border-red-700 bg-red-950/40 text-red-200 hover:bg-red-900/40"
                }`}
                onClick={() => {
                  if (armedReset === "ui") {
                    resetUiPreferences();
                    setArmedReset(null);
                    setOpen(false);
                    return;
                  }
                  setArmedReset("ui");
                }}
              >
                {armedReset === "ui" ? "Confirm reset UI preferences" : "Reset all UI preferences"}
              </button>
              <button
                type="button"
                className={`rounded border px-3 py-1 text-xs ${
                  armedReset === "data"
                    ? "border-amber-500 bg-amber-800/50 text-amber-100"
                    : "border-amber-700 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40"
                }`}
                onClick={() => {
                  if (armedReset === "data") {
                    resetLocalData();
                    setArmedReset(null);
                    setOpen(false);
                    return;
                  }
                  setArmedReset("data");
                }}
              >
                {armedReset === "data" ? "Confirm reset local cached data" : "Reset local cached data"}
              </button>
              {armedReset ? (
                <button
                  type="button"
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  onClick={() => setArmedReset(null)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function KeyCombo({ keys }: { keys: string }) {
  return (
    <>
      {keys.split(" ").map((token, index) => {
        if (token === "then") {
          return (
            <span key={`sep-${index}`} className="mx-1 text-slate-400">
              then
            </span>
          );
        }
        return (
          <kbd key={`k-${token}-${index}`} className="mr-1 rounded border border-slate-700 px-1 py-0.5">
            {token}
          </kbd>
        );
      })}
    </>
  );
}

