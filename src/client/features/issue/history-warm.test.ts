import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import type { HistoryEntry } from "@/shared/jira-history";
import { createHoverIntent } from "@/client/features/navigation/hover-intent";
import { createHistoryWarmer, nextIssue } from "./history-warm";
import { historyOptions, historyView } from "./use-issue-history";

const realFetch = globalThis.fetch;
const clients: QueryClient[] = [];
afterEach(async () => {
  // A test's reads still retrying must not land in the next test's server.
  for (const client of clients.splice(0)) {
    await client.cancelQueries();
    client.clear();
  }
  globalThis.fetch = realFetch;
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Answers history reads; `hold` keeps each one open until `release`, to see how many run at once. */
function jira({ status = 200, hold = false } = {}) {
  const calls: string[] = [];
  const waiting: (() => void)[] = [];
  let open = 0,
    most = 0;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url).replace("/api/issues/", "").replace("/history", ""));
    open++;
    most = Math.max(most, open);
    if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
    open--;
    return new Response(status === 200 ? "[]" : "{}", { status });
  }) as unknown as typeof fetch;
  return {
    calls,
    most: () => most,
    release: () => waiting.splice(0).forEach((resolve) => resolve()),
  };
}

function warmer(options: { concurrency?: number; maxPending?: number } = {}) {
  // Retries without their backoff, so a failure lands at once (historyOptions still asks three more times).
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  clients.push(client);
  const details: string[] = [];
  const w = createHistoryWarmer({
    client,
    loadDetails: async (key) => void details.push(key),
    stampOf: (key) => (key.startsWith("GONE") ? undefined : "t1"),
    selectionWait: 60,
    ...options,
  });
  return { client, details, ...w };
}

const observe = (client: QueryClient, key: string) =>
  new QueryObserver<HistoryEntry[], Error, HistoryEntry[], HistoryEntry[], readonly ["history", string, string]>(
    client,
    historyOptions(key, "t1"),
  );

test("a pointer resting on a card reads its history before it opens, into the entry the open reads", async () => {
  const server = jira();
  const { client, warm } = warmer();
  const intent = createHoverIntent((key: string) => void warm(key), { interval: 80 });
  intent.over("KAN-1", { x: 10, y: 10 });
  intent.over("KAN-1", { x: 11, y: 10 }); // under Linear's 2px: still resting
  await sleep(200);
  expect(server.calls).toEqual(["KAN-1"]);
  // The open finds it there: no second read, and no wait screen.
  const observer = observe(client, "KAN-1");
  observer.subscribe(() => {});
  await sleep(5);
  expect(server.calls).toEqual(["KAN-1"]);
  expect(historyView(observer, client, "KAN-1", "t1").pending).toBe(false);
});

test("a quick sweep across 20 cards reads none of them", async () => {
  const server = jira();
  const { warm } = warmer();
  const intent = createHoverIntent((key: string) => void warm(key), { interval: 80 });
  for (let i = 0; i < 20; i++) {
    intent.over(`KAN-${i}`, { x: 10, y: 10 + i * 40 });
    await sleep(5);
  }
  intent.out();
  await sleep(200);
  expect(server.calls).toEqual([]);
});

test("a pointer still moving over one card does not read it until it rests", async () => {
  const server = jira();
  const { warm } = warmer();
  const intent = createHoverIntent((key: string) => void warm(key), { interval: 80 });
  for (let i = 0; i < 8; i++) {
    intent.over("KAN-1", { x: 10 + i * 5, y: 10 });
    await sleep(5);
  }
  expect(server.calls).toEqual([]);
  await sleep(200);
  expect(server.calls).toEqual(["KAN-1"]);
  // Once read, moving on within the card never reads it again.
  intent.over("KAN-1", { x: 200, y: 10 });
  await sleep(200);
  expect(server.calls).toEqual(["KAN-1"]);
});

test("a selection change reads the selected issue once the keys rest; held-down j/k reads only where it stops", async () => {
  const server = jira();
  const { warmSoon } = warmer();
  for (let i = 0; i < 10; i++) {
    warmSoon(`KAN-${i}`);
    await sleep(2);
  }
  await sleep(150);
  expect(server.calls).toEqual(["KAN-9"]);
});

test("an issue already held or still being read is not read again", async () => {
  const server = jira({ hold: true });
  const { warm } = warmer();
  await Promise.all([warm("KAN-1"), warm("KAN-1")]);
  await sleep(5);
  await warm("KAN-1"); // in flight
  expect(server.calls).toEqual(["KAN-1"]);
  server.release();
  await sleep(5);
  await warm("KAN-1"); // held
  await sleep(5);
  expect(server.calls).toEqual(["KAN-1"]);
});

test("no more than two reads run at once, and a long sweep keeps only the newest few waiting", async () => {
  const server = jira({ hold: true });
  const { warm } = warmer({ concurrency: 2, maxPending: 2 });
  for (let i = 1; i <= 8; i++) await warm(`KAN-${i}`);
  await sleep(5);
  expect(server.most()).toBe(2);
  expect(server.calls).toEqual(["KAN-1", "KAN-2"]);
  for (let round = 0; round < 3; round++) {
    server.release();
    await sleep(5);
  }
  expect(server.most()).toBe(2);
  // KAN-3 to KAN-6 were dropped; the newest intent goes first.
  expect(server.calls).toEqual(["KAN-1", "KAN-2", "KAN-8", "KAN-7"]);
});

test("a warm that fails is not tried again, and leaves the open its own read", async () => {
  const server = jira({ status: 500 });
  const { client, warm } = warmer();
  await warm("KAN-1");
  await sleep(20);
  const tries = server.calls.length;
  expect(tries).toBe(4); // historyOptions' bounded retries, never a loop
  await warm("KAN-1");
  await sleep(20);
  expect(server.calls.length).toBe(tries);
  // The failed entry is gone, so the open asks again instead of showing an error it never saw.
  expect(client.getQueryState(historyOptions("KAN-1", "t1").queryKey)).toBeUndefined();
  const observer = observe(client, "KAN-1");
  observer.subscribe(() => {});
  await sleep(5);
  expect(server.calls.length).toBeGreaterThan(tries);
});

test("an issue made here, or one whose details Jira refused, is never read", async () => {
  const server = jira();
  const { details, warm } = warmer();
  await warm("KAN-NEW3");
  await warm("GONE-1");
  await sleep(5);
  expect(details).toEqual(["GONE-1"]);
  expect(server.calls).toEqual([]);
});

test("the inbox warms the issue after the selected row, only when the mirror holds it", () => {
  const rows = [
    { id: "n1", key: "KAN-1" },
    { id: "n2", key: "KAN-2" },
    { id: "n3", key: "OUT-9" },
  ];
  const held = (key: string) => key.startsWith("KAN");
  expect(nextIssue(rows, "n1", held)).toBe("KAN-2");
  expect(nextIssue(rows, "n2", held)).toBeUndefined(); // outside the mirror: reading it would make the server keep it
  expect(nextIssue(rows, "n3", held)).toBeUndefined();
  expect(nextIssue(rows, null, held)).toBeUndefined();
});
