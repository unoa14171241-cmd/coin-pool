import { resetLocalStorageKeys } from "@/lib/local-storage-reset";

export const LOCAL_DATA_KEYS = {
  AUTOMATION_SMOKE_HISTORY: "lp-manager:automation-smoke-history:v1"
} as const;

export const ALL_LOCAL_DATA_KEYS: string[] = Object.values(LOCAL_DATA_KEYS);

export function resetLocalData(keys: string[] = ALL_LOCAL_DATA_KEYS) {
  resetLocalStorageKeys({ keys, resetState: true });
}
