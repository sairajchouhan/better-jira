import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";
import { createInboxStore, type InboxPorts, type Feed } from "./inbox-store";
import { DEFAULT_VIEW, type InboxItem } from "./inbox-model";

const row = (id: string, unread = true): InboxItem => ({
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
  unread,
  category: "direct",
  count: 1,
});
function setup(writable = true, send: InboxPorts["send"] = async () => null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const items = [row("1"), row("2"), row("3")];
  const page: Feed = { items, more: false, writable, unseen: 0 };
  queryClient.setQueryData(["inbox", "all"], {
    pages: [page],
    pageParams: [""],
  });
  const saved: Record<string, object> = {};
  const messages: string[] = [],
    opened: string[] = [];
  const state = { issues: new Map(), clock: Date.now() };
  const ports: InboxPorts = {
    queryClient,
    get: (() => state) as InboxPorts["get"],
    set: ((patch: { perf?: string }) => {
      if (patch.perf) messages.push(patch.perf);
    }) as InboxPorts["set"],
    ui: { send: () => {} },
    statusOf: () => undefined,
    read: <T>(name: string, fallback: T) => ({ ...fallback, ...saved[name] }),
    save: (name, value) => {
      saved[name] = structuredClone(value);
    },
    fetchPage: async () => page,
    send,
    openRow: (item) => {
      opened.push(item.id);
    },
    clearSelection: () => {
      opened.push("clear");
    },
    confirm: () => true,
  };
  return {
    store: createInboxStore(ports),
    items,
    saved,
    messages,
    opened,
    ports,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("read-only marks persist locally, and each store owns its selection and undo", async () => {
  const a = setup(false),
    b = setup(false);
  a.store.selectRow(a.items[0]);
  expect(a.store.localState()["head-1"]).toEqual({ read: true });
  expect(a.store.selected()).toBe("1");
  expect(b.store.selected()).toBeNull();
  a.store.deleteRow();
  expect(a.store.selected()).toBe("2");
  a.store.undoInbox();
  expect(a.store.selected()).toBe("1");
  expect(a.store.localState()["head-1"]?.deleted).toBeUndefined();
  expect(b.store.localState()).toEqual({});
});

test("rapid opposite read writes serialize and only the latest removes its optimistic override", async () => {
  const first = deferred(),
    second = deferred();
  const calls: object[] = [];
  const a = setup(true, async (body) => {
    calls.push(body);
    await (calls.length === 1 ? first.promise : second.promise);
    return null;
  });
  const read = a.store.markRead([a.items[0]!], true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const unread = a.store.markRead([a.items[0]!], false);
  expect(calls).toEqual([{ action: "read", groups: ["1"] }]);
  first.resolve();
  await read;
  expect(a.store.localState()["head-1"]?.read).toBe(false);
  second.resolve();
  await unread;
  expect(calls).toEqual([
    { action: "read", groups: ["1"] },
    { action: "unread", groups: ["1"] },
  ]);
  expect(a.store.localState()["head-1"]).toBeUndefined();
});

test("superseded queued writes are skipped, while other groups can write independently", async () => {
  const gate = deferred();
  const calls: { action?: string; groups?: string[] }[] = [];
  const a = setup(true, async (body) => {
    calls.push(body);
    if (calls.length === 1) await gate.promise;
    return null;
  });
  const one = a.store.markRead([a.items[0]!], true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const two = a.store.markRead([a.items[0]!], false);
  const three = a.store.markRead([a.items[0]!], true);
  await a.store.markRead([a.items[1]!], false);
  expect(calls[1]).toEqual({ action: "unread", groups: ["2"] });
  gate.resolve();
  await Promise.all([one, two, three]);
  expect(
    calls.some((c) => c.action === "unread" && c.groups?.includes("1")),
  ).toBe(false);
});

test("transport failure rolls back only read, preserving snooze and allowing the next write", async () => {
  let fail = true;
  const a = setup(true, async () => {
    if (fail) throw new Error("offline");
    return null;
  });
  a.store.snoozeRow(Date.now() + 60_000, a.items[0]);
  await a.store.markRead([a.items[0]!], true);
  expect(a.messages).toContain("Could not update Jira: offline");
  expect(a.store.localState()["head-1"]?.read).toBeUndefined();
  expect(a.store.localState()["head-1"]?.snoozed).toBeGreaterThan(Date.now());
  fail = false;
  await a.store.markRead([a.items[0]!], false);
  expect(a.store.localState()["head-1"]?.read).toBeUndefined();
});

test("read writes chunk at 50 groups", async () => {
  const calls: object[] = [];
  const a = setup(true, async (body) => {
    calls.push(body);
    return null;
  });
  const rows = Array.from({ length: 101 }, (_, i) => row(String(i)));
  await a.store.markRead(rows, true);
  expect(calls.map((c) => (c as { groups: string[] }).groups.length)).toEqual([
    50, 50, 1,
  ]);
});

test("read-all undo includes server-only groups", async () => {
  const calls: object[] = [];
  const a = setup(true, async (body) => {
    calls.push(body);
    return { groups: ["older"] };
  });
  await a.store.markAllRead();
  a.store.undoInbox();
  // Undo starts an async write; allow its dependency queue to run.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual([
    { action: "read-all" },
    { action: "unread", groups: ["1", "2", "3", "older"] },
  ]);
});

test("local patches merge another tab's heads and storage invalidation reloads view", () => {
  const a = setup(false);
  a.store.localState();
  a.saved.local = { other: { deleted: true } };
  a.store.toggleRead(a.items[0]);
  expect(a.store.localState().other).toEqual({ deleted: true });
  a.saved.view = { ...DEFAULT_VIEW, ordering: "oldest" };
  a.store.storageChanged("view");
  expect(a.store.viewState().ordering).toBe("oldest");
});
