"use client";

import { useEffect, useState } from "react";

export type ViewMode = "cards" | "table";

/**
 * Per-list card/table preference, persisted independently per `key` (each
 * report list remembers its own choice, not one app-wide switch). Starts
 * at `default` on every render - server and first client paint always
 * agree, so there's no hydration mismatch - then a post-mount effect
 * reads the stored value and updates if one exists.
 */
export function useViewMode(key: string, defaultMode: ViewMode = "cards"): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(defaultMode);
  const storageKey = `kickbase:view-mode:${key}`;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "cards" || stored === "table") setModeState(stored);
    } catch {
      // Private-browsing/storage-disabled - fall back silently to defaultMode.
    }
  }, [storageKey]);

  function setMode(next: ViewMode) {
    setModeState(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Ignore - the in-memory state still updates for this session.
    }
  }

  return [mode, setMode];
}
