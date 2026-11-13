import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import type { HistoryEntry } from "@/shared/jira-history";
import { historyOptions } from "./use-issue-history";

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
