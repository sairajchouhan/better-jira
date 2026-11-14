import { useState } from "react";

/**
 * Linear's session collapse memory (useCollapsedStateSessionBased.Dl6GGHul.js): a section's open or folded state, kept in memory by
 * key for 15 minutes (at most 2000 keys), so leaving an issue and coming back finds its "Show more" toggles as they were. A reload
 * forgets them.
 */
export function collapsedStateStore({ expiresAfter, maxSize, now = Date.now }: { expiresAfter: number; maxSize: number; now?: () => number }) {
  const entries = new Map<string, { value: boolean; at: number }>();
  const dropExpired = () => {
    for (const [key, entry] of entries) if (now() - entry.at > expiresAfter) entries.delete(key);
  };
  return {
    get(key: string): boolean | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.at > expiresAfter) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: boolean) {
      if (entries.size > maxSize) dropExpired();
      entries.set(key, { value, at: now() });
    },
  };
}

const store = collapsedStateStore({ expiresAfter: 15 * 60_000, maxSize: 2000 });

/** Linear's `useCollapsedStateSessionBased`: `initial` until the key was toggled in the last 15 minutes. Callers key the component by
 *  `key` when it can change, so the state starts again from the store. */
export function useCollapsedState(key: string, initial: boolean) {
  const [collapsed, setCollapsed] = useState(() => store.get(key) ?? initial);
  const toggle = () =>
    setCollapsed((was) => {
      store.set(key, !was);
      return !was;
    });
  return [collapsed, toggle] as const;
}
