import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import type { HistoryEntry } from "@/shared/jira-history";
import { historyOptions, historyPending, historyView } from "./use-issue-history";

type Options = ReturnType<typeof historyOptions>;
const observe = (options: Options) =>
  new QueryObserver<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], Options["queryKey"]>(new QueryClient(), options);

const realFetch = globalThis.fetch;
afterEach(() => void (globalThis.fetch = realFetch));
/** Counts history reads; every one answers 404, as the server does for a key the mirror doesn't have. */
function failingFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return calls;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("R3 history storm: an issue made here (PREFIX-NEWn) never asks Jira for its history", async () => {
  const calls = failingFetch();
  const observer = observe(historyOptions("KAN-NEW12", undefined));
  for (let i = 0; i < 20; i++) observer.subscribe(() => {})();
  observer.subscribe(() => {});
  await settle();
  expect(calls).toEqual([]);
});

test("R3 history storm: a failed history read is not read again each time the view resubscribes", async () => {
  const calls = failingFetch();
  // Retries off so the failure lands at once; resubscribing must not start another read.
  const observer = observe({ ...historyOptions("KAN-278", "t1"), retry: 0 });
  const unsubscribe = observer.subscribe(() => {});
  await settle();
  await settle();
  expect(observer.getCurrentResult().status).toBe("error");
  unsubscribe();
  for (let i = 0; i < 20; i++) observer.subscribe(() => {})();
  await settle();
  expect(calls).toEqual(["/api/issues/KAN-278/history"]);
});

/** Answers every history read with `entries` once `release` is called, as a slow Jira does. */
function heldFetch(entries: unknown[] = []) {
  let release = () => {};
  globalThis.fetch = (() =>
    new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify(entries), { status: 200 }));
    })) as unknown as typeof fetch;
  return () => release();
}
const view = (client: QueryClient, observer: ReturnType<typeof observe>, key: string, stamp: string | undefined) =>
  historyView(observer, client, key, stamp);
const observeOn = (client: QueryClient, options: Options) =>
  new QueryObserver<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], Options["queryKey"]>(client, options);

test("activity loading: the first history read of an issue is pending from its first render, before the observer mounts", async () => {
  const release = heldFetch();
  const client = new QueryClient();
  const observer = observeOn(client, historyOptions("KAN-7", "t1"));
  // The render before the commit: nothing fetched yet, but it will be, so the Activity holds its fallback at once.
  expect(view(client, observer, "KAN-7", "t1").pending).toBe(true);
  const stop = observer.subscribe(() => {});
  expect(view(client, observer, "KAN-7", "t1").pending).toBe(true);
  release();
  await settle();
  await settle();
  expect(view(client, observer, "KAN-7", "t1").pending).toBe(false);
  stop();
});

test("activity loading: an issue made here is never pending, as it never reads Jira", () => {
  const client = new QueryClient();
  const observer = observeOn(client, historyOptions("KAN-NEW3", undefined));
  observer.subscribe(() => {});
  expect(view(client, observer, "KAN-NEW3", undefined).pending).toBe(false);
});

test("activity loading: a newer `updated` keeps the last history on screen, so the Activity never goes back to loading", async () => {
  const release = heldFetch();
  const client = new QueryClient();
  const observer = observeOn(client, historyOptions("KAN-8", "t1"));
  observer.subscribe(() => {});
  release();
  await settle();
  await settle();
  heldFetch();
  observer.setOptions(historyOptions("KAN-8", "t2"));
  expect(view(client, observer, "KAN-8", "t2").pending).toBe(false);
});

test("activity loading: a pane moving to another issue reads that issue's state in the same render, not the last issue's", async () => {
  const release = heldFetch();
  const client = new QueryClient();
  const observer = observeOn(client, historyOptions("KAN-9", "t1"));
  observer.subscribe(() => {});
  release();
  await settle();
  await settle();
  heldFetch();
  // The observer still holds KAN-9 (its options change after the commit); the render must already see KAN-10 loading.
  expect(observer.getCurrentResult().status).toBe("success");
  expect(view(client, observer, "KAN-10", "t1").pending).toBe(true);
});

test("activity loading: after a failed try the Activity shows what it has; the retries go on behind it", async () => {
  failingFetch();
  const client = new QueryClient();
  const observer = observeOn(client, Object.assign(historyOptions("KAN-11", "t1"), { retryDelay: 60_000 }));
  observer.subscribe(() => {});
  await settle();
  await settle();
  const result = observer.getCurrentResult();
  expect(result.status).toBe("pending");
  expect(result.failureCount).toBe(1);
  expect(historyPending(result)).toBe(false);
  observer.destroy();
});

test("activity loading: a read that waits (paused, not fetching) never holds the Activity", () => {
  expect(historyPending({ status: "pending", fetchStatus: "paused", failureCount: 0 })).toBe(false);
  expect(historyPending({ status: "pending", fetchStatus: "idle", failureCount: 0 })).toBe(false);
  expect(historyPending({ status: "error", fetchStatus: "idle", failureCount: 1 })).toBe(false);
  expect(historyPending({ status: "pending", fetchStatus: "fetching", failureCount: 0 })).toBe(true);
});
