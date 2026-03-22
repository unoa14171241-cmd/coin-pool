"use client";

import { useEffect, useRef } from "react";
import { isEditableElement } from "@/lib/dom/is-editable-element";

export function useKeySequenceShortcut(input: {
  firstKey: string;
  secondKey: string;
  onMatch: () => void;
  maxIntervalMs?: number;
  enabled?: boolean;
}) {
  const firstPressedAtRef = useRef(0);

  useEffect(() => {
    if (input.enabled === false) return;
    const firstKey = input.firstKey.toLowerCase();
    const secondKey = input.secondKey.toLowerCase();
    const maxIntervalMs = input.maxIntervalMs ?? 1200;

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (isEditableElement(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const now = Date.now();
      if (key === firstKey) {
        firstPressedAtRef.current = now;
        return;
      }
      if (key === secondKey && now - firstPressedAtRef.current <= maxIntervalMs) {
        event.preventDefault();
        firstPressedAtRef.current = 0;
        input.onMatch();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [input.enabled, input.firstKey, input.maxIntervalMs, input.onMatch, input.secondKey]);
}
