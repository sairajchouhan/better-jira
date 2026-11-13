import { QueryObserver, type Query } from "@tanstack/query-core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { queryClient } from "@/client/state/server-data";
import type { HistoryEntry } from "@/shared/jira-history";
import { isAppKey } from "@/shared/jira-ops";

const NONE: readonly HistoryEntry[] = [];
type Key = readonly ["history", string, string];
export const historyOptions = (key: string, stamp: string | undefined) => ({
  queryKey: ["history", key, stamp ?? ""] as Key,
  queryFn: async (): Promise<HistoryEntry[]> => {
    const response = await fetch(`/api/issues/${encodeURIComponent(key)}/history`);
    if (!response.ok) throw new Error("Could not load the issue's Jira history");
    return response.json();
  },
  // An issue made here (PREFIX-NEWn) has no Jira changelog until Jira keys it: nothing to ask for (R3 history storm).
  enabled: !isAppKey(key),
  // A key Jira has just given can reach the mirror a moment later: ask a few more times, backing off, then stop. A failed
  // read is not asked again by the next subscriber; only a new `updated` (a new query) reads again.
  retry: 3,
  retryOnMount: false,
  // Jira's record moved (a new `updated`): read again, keeping this issue's old history on screen meanwhile; never another issue's.
  placeholderData: (previous: HistoryEntry[] | undefined, query?: Query<HistoryEntry[], Error, HistoryEntry[], Key>) =>
    query?.queryKey[1] === key ? previous : undefined,
  staleTime: Infinity,
});

/** The issue's whole Jira changelog, loaded after the details so it never holds up their first paint (BJ-13). Empty until it
 *  arrives, or if Jira refuses it; `stamp` is Jira's `updated`, so a change in Jira reads it again. */
export function useIssueHistory(key: string, stamp: string | undefined): readonly HistoryEntry[] {
  const [observer] = useState(
    () => new QueryObserver<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], Key>(queryClient, historyOptions(key, stamp)),
  );
  useEffect(() => observer.setOptions(historyOptions(key, stamp)), [observer, key, stamp]);
  // Stable: a new subscribe each render would resubscribe the observer on every render, and each subscribe of a failed
  // read fetched it again (hundreds of 404s a second for an unsaved issue).
  const subscribe = useCallback((changed: () => void) => observer.subscribe(changed), [observer]);
  const result = useSyncExternalStore(subscribe, () => observer.getCurrentResult());
  return result.data ?? NONE;
}
