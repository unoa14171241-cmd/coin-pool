import { resetLocalStorageKeys } from "@/lib/local-storage-reset";

export const UI_PREFERENCE_KEYS = {
  GLOBAL_ACTOR_BANNER_COLLAPSED: "lp-manager:global-actor-banner-collapsed:v1",
  AUTOMATION_TARGET_CONTEXT_COLLAPSED: "lp-manager:automation-target-context-collapsed:v1",
  KEYBOARD_HELP_BUTTON_HIDDEN: "lp-manager:keyboard-help-button-hidden:v1"
} as const;

export const ALL_UI_PREFERENCE_KEYS: string[] = Object.values(UI_PREFERENCE_KEYS);

export function resetUiPreferences(keys: string[] = ALL_UI_PREFERENCE_KEYS) {
  resetLocalStorageKeys({ keys, resetState: true });
}
