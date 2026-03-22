export const KEY_SEQUENCE_INTERVAL_MS = 1200;
export type ShortcutHelpItem = { keys: string; label: string };

export const SHORTCUTS = {
  HELP_TOGGLE: { keys: "?", eventKey: "?", label: "Toggle this help" },
  CLOSE_DIALOGS: { keys: "Esc", eventKey: "Escape", label: "Close dialogs/help" },
  GLOBAL_CONTEXT_TOGGLE: {
    firstKey: "g",
    secondKey: "c",
    keys: "g then c",
    label: "Toggle global context"
  },
  AUTOMATION_TARGET_CONTEXT_TOGGLE: {
    firstKey: "g",
    secondKey: "t",
    keys: "g then t",
    label: "Toggle automation target context"
  },
  ACTIVITY_SEARCH_SLASH: {
    keys: "/",
    label: "Focus search input"
  }
} as const;

export function getActivitySearchQuickKey(isMac: boolean): { keys: string; label: string } {
  return {
    keys: isMac ? "Cmd+K" : "Ctrl+K",
    label: "Focus search input"
  };
}

const PAGE_SHORTCUT_REGISTRY: Array<{
  pathPrefix: string;
  getItems: (isMac: boolean) => ShortcutHelpItem[];
}> = [
  {
    pathPrefix: "/automation",
    getItems: () => [
      {
        keys: SHORTCUTS.AUTOMATION_TARGET_CONTEXT_TOGGLE.keys,
        label: SHORTCUTS.AUTOMATION_TARGET_CONTEXT_TOGGLE.label
      }
    ]
  },
  {
    pathPrefix: "/activity",
    getItems: (isMac) => [
      {
        keys: SHORTCUTS.ACTIVITY_SEARCH_SLASH.keys,
        label: SHORTCUTS.ACTIVITY_SEARCH_SLASH.label
      },
      getActivitySearchQuickKey(isMac)
    ]
  }
];

export function getShortcutHelpItems(pathname: string | null, isMac: boolean): ShortcutHelpItem[] {
  const items: ShortcutHelpItem[] = [
    { keys: SHORTCUTS.HELP_TOGGLE.keys, label: SHORTCUTS.HELP_TOGGLE.label },
    { keys: SHORTCUTS.GLOBAL_CONTEXT_TOGGLE.keys, label: SHORTCUTS.GLOBAL_CONTEXT_TOGGLE.label },
    { keys: SHORTCUTS.CLOSE_DIALOGS.keys, label: SHORTCUTS.CLOSE_DIALOGS.label }
  ];
  if (!pathname) return items;
  for (const entry of PAGE_SHORTCUT_REGISTRY) {
    if (!pathname.startsWith(entry.pathPrefix)) continue;
    items.push(...entry.getItems(isMac));
  }
  return items;
}
