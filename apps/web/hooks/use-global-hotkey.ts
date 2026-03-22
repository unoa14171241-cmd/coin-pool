"use client";

import { useEffect } from "react";
import { isEditableElement } from "@/lib/dom/is-editable-element";

export function useGlobalHotkey(input: {
  key: string;
  onTrigger: () => void;
  enabled?: boolean;
  preventDefault?: boolean;
  allowInEditable?: boolean;
  ignoreRepeat?: boolean;
  requireNoUnspecifiedModifiers?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}) {
  useEffect(() => {
    if (input.enabled === false) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (!input.allowInEditable && isEditableElement(event.target)) return;
      if ((input.ignoreRepeat ?? true) && event.repeat) return;
      if (!matchesHotkey(event, input, input.requireNoUnspecifiedModifiers ?? true)) return;
      if (input.preventDefault) event.preventDefault();
      input.onTrigger();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    input.allowInEditable,
    input.altKey,
    input.ctrlKey,
    input.enabled,
    input.key,
    input.ignoreRepeat,
    input.metaKey,
    input.onTrigger,
    input.preventDefault,
    input.requireNoUnspecifiedModifiers,
    input.shiftKey
  ]);
}

function matchesHotkey(
  event: KeyboardEvent,
  input: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  requireNoUnspecifiedModifiers: boolean
): boolean {
  if (event.key.toLowerCase() !== input.key.toLowerCase()) return false;
  if (requireNoUnspecifiedModifiers) {
    if (input.ctrlKey == null && event.ctrlKey) return false;
    if (input.metaKey == null && event.metaKey) return false;
    if (input.altKey == null && event.altKey) return false;
    if (input.shiftKey == null && event.shiftKey) return false;
  }
  if (input.ctrlKey != null && event.ctrlKey !== input.ctrlKey) return false;
  if (input.metaKey != null && event.metaKey !== input.metaKey) return false;
  if (input.altKey != null && event.altKey !== input.altKey) return false;
  if (input.shiftKey != null && event.shiftKey !== input.shiftKey) return false;
  return true;
}
