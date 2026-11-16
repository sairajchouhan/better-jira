import { expect, test } from "bun:test";
import { QueryClient, type InfiniteData } from "@tanstack/query-core";
import { createInboxStore, type Feed, type InboxPorts } from "./inbox-store";
import type { InboxItem } from "@/shared/inbox-model";

const row = (id: string): InboxItem => ({
  id,
  head: `head-${id}`,
  key: `TEST-${id}`,
  title: id,
  status: "",
  url: "",
  actor: null,
  kind: "updated",
  message: "",
  preview: "",
  time: "2026-11-10T00:00:00Z",
  unread: true,
  category: "direct",
  count: 1,
  link: "",
  commentId: "",
  issueType: "",
  others: [],
});
const page = (...ids: string[]): Feed => ({ items: ids.map(row), more: false, writable: true, unseen: 0 });

/** A store whose Jira read (`fetchPage`) and kept read (`fetchKept`) answer when the test says. */
function setup(stored?: Feed) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls: string[] = [];
  let jira!: (feed: Feed) => void, kept!: (feed: Feed | undefined) => void;
  const ports = {
    queryClient,
    get: () => ({ issues: new Map(), clock: Date.now() }),
    set: () => {},
    ui: { send: () => {} },
    statusOf: () => undefined,
    read: <T>(name: string, fallback: T) => (name === "feed-all" && stored ? (stored as T) : fallback),
    save: () => {},
    fetchPage: () => {
      calls.push("jira");
      return new Promise<Feed>((done) => (jira = done));
    },
    fetchKept: (query: URLSearchParams) => {
      calls.push(`kept:${query}`);
      return new Promise<Feed | undefined>((done) => (kept = done));
    },
    send: async () => null,
    openRow: () => {},
    clearSelection: () => {},
    confirm: async () => true,
    shown: () => true,
    fullPage: () => false,
    later: () => () => {},
  } as unknown as InboxPorts;
  const store = createInboxStore(ports);
  const data = () => queryClient.getQueryState<InfiniteData<Feed, string>>(["inbox", "all"]);
  return { store, calls, data, jira: (f: Feed) => jira(f), kept: (f?: Feed) => kept(f), queryClient };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("R4-inbox-D5: with no stored page, the server's kept page shows at once, as not fetched yet, until Jira's arrives", async () => {
  const s = setup();
  const stop = s.store.feed("all").subscribe(() => {});
  await tick();
  expect(s.calls).toEqual(["kept:", "jira"]);
  s.kept(page("1", "2"));
  await tick();
  expect(s.data()?.data?.pages[0]?.items.map((i) => i.id)).toEqual(["1", "2"]);
  // Like a stored page (`initialDataUpdatedAt: 0`): push delivery and visit marks wait for Jira's own.
  expect(s.data()?.dataUpdatedAt).toBe(0);
  s.jira(page("3", "1", "2"));
  await tick();
  expect(s.data()?.data?.pages[0]?.items.map((i) => i.id)).toEqual(["3", "1", "2"]);
  expect(s.data()?.dataUpdatedAt).toBeGreaterThan(0);
  stop();
  s.queryClient.clear();
});

test("R4-inbox-D5: the kept page never replaces Jira's, and a browser with a stored page doesn't ask for it", async () => {
  const late = setup();
  const stop = late.store.feed("all").subscribe(() => {});
  await tick();
  late.jira(page("3"));
  await tick();
  late.kept(page("old"));
  await tick();
  expect(late.data()?.data?.pages[0]?.items.map((i) => i.id)).toEqual(["3"]);
  stop();
  late.queryClient.clear();

  const warm = setup(page("1"));
  const stopWarm = warm.store.feed("all").subscribe(() => {});
  await tick();
  expect(warm.calls).toEqual(["jira"]);
  stopWarm();
  warm.queryClient.clear();
});
