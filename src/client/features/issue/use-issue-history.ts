import { QueryObserver, type Query } from "@tanstack/query-core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { queryClient } from "@/client/state/server-data";
import type { HistoryEntry } from "@/shared/jira-history";

const NONE: readonly HistoryEntry[] = [];
type Key = readonly ["history", string, string];
const options = (key: string, stamp: string | undefined) => ({
  queryKey: ["history", key, stamp ?? ""] as Key,
  queryFn: async (): Promise<HistoryEntry[]> => {
    const response = await fetch(`/api/issues/${encodeURIComponent(key)}/history`);
    if (!response.ok) throw new Error("Could not load the issue's Jira history");
    return response.json();
  },
  // Jira's record moved (a new `updated`): read again, keeping this issue's old history on screen meanwhile; never another issue's.
  placeholderData: (previous: HistoryEntry[] | undefined, query?: Query<HistoryEntry[], Error, HistoryEntry[], Key>) =>
    query?.queryKey[1] === key ? previous : undefined,
  staleTime: Infinity,
});

/** The issue's whole Jira changelog, loaded after the details so it never holds up their first paint (BJ-13). Empty until it
 *  arrives, or if Jira refuses it; `stamp` is Jira's `updated`, so a change in Jira reads it again. */
export function useIssueHistory(key: string, stamp: string | undefined): readonly HistoryEntry[] {
  const [observer] = useState(
    () => new QueryObserver<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], Key>(queryClient, options(key, stamp)),
  );
  useEffect(() => observer.setOptions(options(key, stamp)), [observer, key, stamp]);
  const result = useSyncExternalStore(
    (changed) => observer.subscribe(changed),
    () => observer.getCurrentResult(),
  );
  return result.data ?? NONE;
}
