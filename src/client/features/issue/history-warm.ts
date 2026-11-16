import { AsyncQueuer, Debouncer } from "@tanstack/pacer";
import type { QueryClient } from "@tanstack/query-core";
import { isAppKey } from "@/shared/jira-ops";
import { get } from "@/client/state/store";
import { loadFull, queryClient } from "@/client/state/server-data";
import { historyOptions } from "./use-issue-history";

/**
 * Reads an issue's Jira history before it opens, so its Activity shows at once instead of under the loading fallback
 * (activity-loading.tsx). Linear never waits here: its route loader runs on hover (`sst` → the issue route's loader with
 * `type: "hover"`, startup-root) and hydrates from data already in the client. Jira's changelog is one request per issue, so a
 * warm goes into the same Query entry the open reads (`historyOptions`), behind a small queue: at most `concurrency` reads at
 * once, newest intent first, never one already held, in flight or failed.
 */
export type HistoryWarmer = {
  /** Reads `key`'s history now (through the queue) unless it is held, reading, or failed before. */
  warm: (key: string) => Promise<void>;
  /** `warm` once the selection has rested (j/k held down never fires on every step). */
  warmSoon: (key: string) => void;
};

type Deps = {
  client: QueryClient;
  /** Loads the issue's details; the history's cache key is their Jira `updated`, as the open reads it. */
  loadDetails: (key: string) => Promise<unknown>;
  /** The details' Jira `updated`, once they are here. */
  stampOf: (key: string) => string | undefined;
  /** Reads at once. Two leave the browser's other connections to the open's own reads. */
  concurrency?: number;
  /** Intents waiting beyond this are dropped oldest first: a long sweep never queues ahead of where the pointer rests. */
  maxPending?: number;
  /** How long the selection rests before `warmSoon` reads (Linear's hover sample, `tst.interval`). */
  selectionWait?: number;
};

type Target = { key: string; stamp: string };
const id = (t: Target) => `${t.key}\n${t.stamp}`;

export function createHistoryWarmer({ client, loadDetails, stampOf, concurrency = 2, maxPending = 4, selectionWait = 100 }: Deps): HistoryWarmer {
  // A warm that failed is never tried again this session: the open does its own read, with its own retries.
  const failed = new Set<string>();
  const queryOf = (t: Target) => client.getQueryCache().find({ queryKey: historyOptions(t.key, t.stamp).queryKey, exact: true });
  /** Held, reading, or once failed: nothing to warm. An entry with an error has no data and counts as stale, so prefetching it
   *  would read it again on every hover. */
  const settled = (t: Target) => {
    if (failed.has(id(t))) return true;
    const state = queryOf(t)?.state;
    return !!state && (state.data !== undefined || state.fetchStatus !== "idle" || state.status === "error");
  };
  const queue = new AsyncQueuer<Target>(
    async (t) => {
      if (settled(t)) return;
      // The open's own options, so an open that joins this read gets the same retries and the same entry.
      await client.prefetchQuery(historyOptions(t.key, t.stamp));
      const query = queryOf(t);
      if (query?.state.status !== "error") return;
      failed.add(id(t));
      // An errored entry stays errored for the open (`retryOnMount: false`): with nobody showing it, drop it so the open reads.
      if (!query.getObserversCount()) client.removeQueries({ queryKey: query.queryKey, exact: true });
    },
    { concurrency, getItemsFrom: "back", throwOnError: false },
  );
  async function warm(key: string) {
    if (isAppKey(key)) return;
    await loadDetails(key);
    const stamp = stampOf(key);
    // No details (Jira refused them): the open shows no Activity to wait for.
    if (stamp === undefined) return;
    const target = { key, stamp };
    if (settled(target) || queue.peekAllItems().some((t) => id(t) === id(target))) return;
    while (queue.peekPendingItems().length >= maxPending) queue.getNextItem("front");
    queue.addItem(target);
    // Pacer's queue fills free slots only on its own tick, which stays pending while any read runs: without this, a second
    // warm waits for the first to finish. `stop` clears the pending tick and `start` fills the free slots now.
    if (queue.peekActiveItems().length < concurrency) {
      queue.stop();
      queue.start();
    }
  }
  const soon = new Debouncer((key: string) => void warm(key), { wait: selectionWait });
  return { warm, warmSoon: (key) => soon.maybeExecute(key) };
}

/** The issue after the selected row, when the mirror holds it: j opens it next. One the mirror doesn't hold is left alone, since
 *  reading it makes the server keep it (`keptIssue`). */
export function nextIssue(rows: readonly { id: string; key: string }[], selected: string | null | undefined, held: (key: string) => boolean) {
  const at = rows.findIndex((row) => row.id === selected);
  const key = at >= 0 ? rows[at + 1]?.key : undefined;
  return key && held(key) ? key : undefined;
}

/** The app's warmer: every surface that knows an issue is about to open (a resting pointer through the route preload, a j/k
 *  selection, the inbox's next row) calls this one. Details Jira refused aren't asked for again here: the issue shows that
 *  error, and asking again on each selection change would loop. */
export const historyWarmer = createHistoryWarmer({
  client: queryClient,
  loadDetails: async (key) => (get().fullErrors.get(key) ? undefined : loadFull(key)),
  stampOf: (key) => get().full.get(key)?.fields?.updated,
});
