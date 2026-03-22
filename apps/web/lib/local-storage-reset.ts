export const LOCAL_STORAGE_KEYS_RESET_EVENT = "lp-manager:local-storage-keys-reset";

export function resetLocalStorageKeys(input: { keys: string[]; resetState?: boolean }) {
  const keys = input.keys;
  const resetState = input.resetState ?? true;
  try {
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage failures
  }
  try {
    window.dispatchEvent(
      new CustomEvent<{ keys: string[]; resetState: boolean }>(LOCAL_STORAGE_KEYS_RESET_EVENT, {
        detail: { keys, resetState }
      })
    );
  } catch {
    // ignore event dispatch failures
  }
}
