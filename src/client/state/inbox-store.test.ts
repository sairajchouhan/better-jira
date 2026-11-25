import { expect, test } from "bun:test";
import { QueryClient, type InfiniteData } from "@tanstack/query-core";
import { createInboxStore, type Feed } from "./inbox-store";
import { Unreachable } from "./jira-media";
import type { InboxItem } from "@/shared/inbox-model";

const row = (n: number, unread: boolean): InboxItem => ({
  id: `group-${n}`,
  head: `head-${n}`,
  key: `TEST-${n}`,
  title: `Issue ${n}`,
  url: `https://example.atlassian.net/browse/TEST-${n}`,
  issueType: "Task",
  time: "2026-11-20T10:00:00.000Z",
  category: "direct",
  count: 1,
  others: [],
  actor: null,
  kind: "assigned",
  message: "assigned",
  preview: "",
  status: "To Do",
  link: "",
  commentId: "",
  unread,
});

function harness(opts: {
  send: (body: object) => Promise<{ groups?: string[] } | null>;
  fetchPage: () => Promise<Feed>;
}) {
  const storage = new Map<string, string>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initialFeed: Feed = {
    unseen: 0,
    items: [row(1, true), row(4, false)],
    more: false,
    unread: [{ id: "group-1", head: "head-1" }],
    writable: true,
  };
  storage.set("feed-all", JSON.stringify(initialFeed));
  queryClient.setQueryData<InfiniteData<Feed, string>>(["inbox", "all"], {
    pages: [initialFeed],
    pageParams: [""],
  });
  const store = createInboxStore({
    queryClient,
    get: () => ({ issues: new Map(), clock: Date.now() }),
    set: () => {},
    ui: { send: () => {} },
    statusOf: () => undefined,
    read: <T>(name: string, fallback: T): T => {
      const raw = storage.get(name);
      return raw ? (JSON.parse(raw) as T) : fallback;
    },
    save: (name, value) => void storage.set(name, JSON.stringify(value)),
    fetchPage: opts.fetchPage,
    send: opts.send,
    openRow: () => {},
    clearSelection: () => {},
    confirm: async () => true,
    shown: () => true,
    fullPage: () => false,
  });
  return { store, queryClient, storage };
}

test("confirmed read/unread mark survives a failed feed refetch without snapping back", async () => {
  const { store, queryClient, storage } = harness({
    send: async () => ({}),
    fetchPage: async () => {
      throw new Unreachable(new Error("offline"));
    },
  });
  // Keep query observed so invalidateQueries attempts a refetch that fails.
  const unsubscribe = store.feed("all").subscribe(() => {});
  try {
    await store.markRead([{ id: "group-4", head: "head-4" }], false);
    const data = queryClient.getQueryData<InfiniteData<Feed, string>>(["inbox", "all"])!;
    expect(data.pages[0]!.items.find((i) => i.id === "group-4")!.unread).toBe(true);
    expect(data.pages[0]!.unread).toContainEqual({ id: "group-4", head: "head-4" });
    expect(store.localState()["head-4"]).toBeUndefined();
    expect(store.pendingCount()).toBe(0);
    const saved = JSON.parse(storage.get("feed-all")!) as Feed;
    expect(saved.items.find((i) => i.id === "group-4")!.unread).toBe(true);
  } finally {
    unsubscribe();
  }
});

test("pendingCount tracks unconfirmed offline marks and retryNow wakes waiting retries immediately", async () => {
  let attempts = 0;
  const { store } = harness({
    send: async () => {
      attempts++;
      if (attempts === 1) throw new Unreachable(new Error("offline"));
      return {};
    },
    fetchPage: async () => ({
      unseen: 0,
      items: [row(1, true), row(4, true)],
      more: false,
      unread: [
        { id: "group-1", head: "head-1" },
        { id: "group-4", head: "head-4" },
      ],
      writable: true,
    }),
  });
  expect(store.pendingCount()).toBe(0);
  const promise = store.markRead([{ id: "group-4", head: "head-4" }], false);
  await Bun.sleep(10);
  expect(attempts).toBe(1);
  expect(store.pendingCount()).toBe(1);

  store.retryNow();
  await promise;
  expect(attempts).toBe(2);
  expect(store.pendingCount()).toBe(0);
});
