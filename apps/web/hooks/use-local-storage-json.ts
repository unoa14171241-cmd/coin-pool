"use client";

import { useEffect, useRef, useState } from "react";
import { LOCAL_STORAGE_KEYS_RESET_EVENT, resetLocalStorageKeys } from "@/lib/local-storage-reset";
import { logLocalStorageDebugEvent } from "@/lib/local-storage-debug";

export type LocalStorageJsonUpdateSource = "init" | "storage" | "reset-event" | "local-set";

export function useLocalStorageJson<T>(input: {
  key: string;
  defaultValue: T;
  deserialize?: (raw: string) => T;
  serialize?: (value: T) => string;
  onValueChange?: (value: T, source: LocalStorageJsonUpdateSource) => void;
  debugEventName?: string;
  debugPayload?: (value: T, source: LocalStorageJsonUpdateSource) => Record<string, unknown>;
}) {
  const [value, setValue] = useState<T>(input.defaultValue);
  const hydratedKeyRef = useRef<string | null>(null);
  const skipNextWriteRef = useRef(false);
  const defaultValueRef = useRef(input.defaultValue);
  const deserializeRef = useRef(input.deserialize);
  const serializeRef = useRef(input.serialize);
  const onValueChangeRef = useRef(input.onValueChange);
  const debugEventNameRef = useRef(input.debugEventName);
  const debugPayloadRef = useRef(input.debugPayload);

  useEffect(() => {
    defaultValueRef.current = input.defaultValue;
    deserializeRef.current = input.deserialize;
    serializeRef.current = input.serialize;
    onValueChangeRef.current = input.onValueChange;
    debugEventNameRef.current = input.debugEventName;
    debugPayloadRef.current = input.debugPayload;
  }, [input.debugEventName, input.debugPayload, input.defaultValue, input.deserialize, input.onValueChange, input.serialize]);

  function updateValue(next: T, source: LocalStorageJsonUpdateSource) {
    setValue(next);
    onValueChangeRef.current?.(next, source);
    if (debugEventNameRef.current) {
      const valueSummary = summarizeValue(next);
      logLocalStorageDebugEvent({
        event: debugEventNameRef.current,
        source,
        key: input.key,
        payload: {
          ...(valueSummary ?? {}),
          ...(debugPayloadRef.current?.(next, source) ?? {})
        }
      });
    }
  }

  useEffect(() => {
    hydratedKeyRef.current = null;
    try {
      const raw = localStorage.getItem(input.key);
      if (raw == null) return;
      const next = deserializeRef.current ? deserializeRef.current(raw) : (JSON.parse(raw) as T);
      updateValue(next, "init");
    } catch {
      // ignore malformed or inaccessible storage
    } finally {
      hydratedKeyRef.current = input.key;
    }
  }, [input.key]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== input.key) return;
      try {
        if (event.newValue == null) {
          skipNextWriteRef.current = true;
          updateValue(defaultValueRef.current, "storage");
          return;
        }
        const next = deserializeRef.current ? deserializeRef.current(event.newValue) : (JSON.parse(event.newValue) as T);
        skipNextWriteRef.current = true;
        updateValue(next, "storage");
      } catch {
        // ignore malformed synced value
      }
    }

    function onLocalStorageKeysReset(event: Event) {
      const custom = event as CustomEvent<{ keys?: string[]; resetState?: boolean }>;
      const keys = custom.detail?.keys;
      if (Array.isArray(keys) && !keys.includes(input.key)) return;
      if (custom.detail?.resetState === false) return;
      skipNextWriteRef.current = true;
      updateValue(defaultValueRef.current, "reset-event");
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(LOCAL_STORAGE_KEYS_RESET_EVENT, onLocalStorageKeysReset as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LOCAL_STORAGE_KEYS_RESET_EVENT, onLocalStorageKeysReset as EventListener);
    };
  }, [input.key]);

  useEffect(() => {
    if (hydratedKeyRef.current !== input.key) return;
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      return;
    }
    try {
      const raw = serializeRef.current ? serializeRef.current(value) : JSON.stringify(value);
      localStorage.setItem(input.key, raw);
    } catch {
      // ignore serialization/storage failure
    }
  }, [input.key, value]);

  function remove(options?: { resetValue?: boolean }) {
    resetLocalStorageKeys({
      keys: [input.key],
      resetState: options?.resetValue ?? false
    });
  }

  function setLocalValue(next: T | ((prev: T) => T)) {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
      onValueChangeRef.current?.(resolved, "local-set");
      return resolved;
    });
  }

  return [value, setLocalValue, { remove }] as const;
}

function summarizeValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === "boolean") return { value };
  if (typeof value === "number") return { value };
  if (typeof value === "string") return { value };
  if (Array.isArray(value)) return { count: value.length };
  if (value && typeof value === "object") return { kind: "object" };
  return null;
}
