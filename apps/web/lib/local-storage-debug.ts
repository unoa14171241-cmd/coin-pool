type LocalStorageJsonUpdateSource = "init" | "storage" | "reset-event" | "local-set";

export const LOCAL_STORAGE_DEBUG_ENABLED = process.env.NODE_ENV !== "production";

export function logLocalStorageDebugEvent(input: {
  event: string;
  source: LocalStorageJsonUpdateSource;
  key: string;
  payload?: Record<string, unknown>;
}) {
  if (!LOCAL_STORAGE_DEBUG_ENABLED) return;
  console.debug(
    JSON.stringify({
      event: input.event,
      source: input.source,
      key: input.key,
      ...(input.payload ?? {})
    })
  );
}
