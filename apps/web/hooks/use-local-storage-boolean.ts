"use client";

import { LocalStorageJsonUpdateSource, useLocalStorageJson } from "@/hooks/use-local-storage-json";

export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
  options?: {
    onValueChange?: (value: boolean, source: LocalStorageJsonUpdateSource) => void;
    debugEventName?: string;
  }
) {
  return useLocalStorageJson<boolean>({
    key,
    defaultValue,
    deserialize: (raw) => {
      if (raw === "1") return true;
      if (raw === "0") return false;
      try {
        const parsed = JSON.parse(raw);
        return parsed === true;
      } catch {
        return defaultValue;
      }
    },
    serialize: (value) => (value ? "1" : "0"),
    onValueChange: options?.onValueChange,
    debugEventName: options?.debugEventName
  });
}
