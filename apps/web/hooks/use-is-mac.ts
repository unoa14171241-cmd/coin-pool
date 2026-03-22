"use client";

import { useEffect, useState } from "react";

export function useIsMac() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    try {
      const platform = navigator.platform.toLowerCase();
      const ua = navigator.userAgent.toLowerCase();
      setIsMac(platform.includes("mac") || ua.includes("mac os"));
    } catch {
      setIsMac(false);
    }
  }, []);

  return isMac;
}
