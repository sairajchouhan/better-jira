/** Per-browser UI state kept in localStorage as JSON: display options, collapsed sections, drafts. Callers own the key
 *  (namespace and version included) so existing stored values keep working. */
import { useEffect, useEffectEvent, useState } from "react";
import { set } from "./store";

/** The stored value run through `parse`, or `fallback` when it is missing, unreadable or rejected by `parse`. */
export function readStored<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

/** Stores `value`, or removes the key for `undefined`. A failed write says `failure` in the status bar when given. */
export function writeStored(key: string, value: unknown, failure?: string): boolean {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    if (failure) set({ perf: failure });
    return false;
  }
}

/** Calls `fn` when another tab changes `key` (the browser's storage event); returns the unsubscribe. */
export function onStoredChange(key: string, fn: () => void) {
  if (typeof addEventListener !== "function") return () => {};
  const listener = (event: Event) => {
    if ((event as StorageEvent).key === key) fn();
  };
  addEventListener("storage", listener);
  return () => removeEventListener("storage", listener);
}

/** useState backed by `key`: reads it on mount, whenever `key` changes and whenever another tab writes it (Linear syncs
 *  these settings across clients), and writes every change. */
export function useStoredState<T>(
  key: string,
  parse: (raw: unknown) => T,
  fallback: T,
  failure?: string,
) {
  const [stored, setStored] = useState(() => ({ key, value: readStored(key, parse, fallback) }));
  // A new key (another issue, another account) reads its own value during render, not in an effect.
  const current = stored.key === key ? stored : { key, value: readStored(key, parse, fallback) };
  if (current !== stored) setStored(current);
  const reread = useEffectEvent(() => setStored({ key, value: readStored(key, parse, fallback) }));
  useEffect(() => onStoredChange(key, () => reread()), [key]);
  const setValue = (value: T) => {
    setStored({ key, value });
    writeStored(key, value, failure);
  };
  return [current.value, setValue] as const;
}
