import { QueryObserver, type Query, type QueryClient, type QueryObserverResult } from "@tanstack/query-core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { queryClient } from "@/client/state/server-data";
import type { HistoryEntry } from "@/shared/jira-history";
import { isAppKey } from "@/shared/jira-ops";

const NONE: readonly HistoryEntry[] = [];
type Key = readonly ["history", string, string];
type HistoryObserver = QueryObserver<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], Key>;
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

/** Jira's history is still on its first read for this issue: no entries yet, none from an earlier `updated`, and no failed try.
 *  Linear holds the Activity until its comments and history are there (`IssueCommentsAndHistoryShouldBeLazyLoaded` inside a
 *  SuspenseObserver); a read that failed once, an issue made here (never read) and a paused read show what the app has. */
export const historyPending = (result: Pick<QueryObserverResult, "status" | "fetchStatus" | "failureCount">) =>
  result.status === "pending" && result.fetchStatus === "fetching" && result.failureCount === 0;

/** The issue's whole Jira changelog, loaded after the details so it never holds up their first paint (BJ-13). Empty until it
 *  arrives, or if Jira refuses it; `stamp` is Jira's `updated`, so a change in Jira reads it again. `pending` is
 *  `historyPending` for this key in this render, so a pane that moves to another issue never reads the last issue's state. */
export function useIssueHistoryState(key: string, stamp: string | undefined): { entries: readonly HistoryEntry[]; pending: boolean } {
  const [observer] = useState(
    (): HistoryObserver => new QueryObserver<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], Key>(queryClient, historyOptions(key, stamp)),
  );
  useEffect(() => observer.setOptions(historyOptions(key, stamp)), [observer, key, stamp]);
  // Stable: a new subscribe each render would resubscribe the observer on every render, and each subscribe of a failed
  // read fetched it again (hundreds of 404s a second for an unsaved issue).
  const subscribe = useCallback((changed: () => void) => observer.subscribe(changed), [observer]);
  useSyncExternalStore(subscribe, () => observer.getCurrentResult());
  return historyView(observer, queryClient, key, stamp);
}

/** As TanStack's own useBaseQuery: a render reads the result for its own key and stamp, which the effect hands the observer
 *  only after the commit. */
export function historyView(observer: HistoryObserver, client: QueryClient, key: string, stamp: string | undefined) {
  const result = observer.getOptimisticResult({
    ...client.defaultQueryOptions<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], Key>(historyOptions(key, stamp)),
    _optimisticResults: "optimistic",
  });
  return { entries: result.data ?? NONE, pending: historyPending(result) };
}

export const useIssueHistory = (key: string, stamp: string | undefined): readonly HistoryEntry[] =>
  useIssueHistoryState(key, stamp).entries;
