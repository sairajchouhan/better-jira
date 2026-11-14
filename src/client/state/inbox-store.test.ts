import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";
import { createInboxStore, deleteQuestion, type InboxPorts, type Feed, type DeleteConfirmation } from "./inbox-store";
import { unreadCount } from "@/shared/inbox-model";
import { DEFAULT_VIEW, type InboxItem } from "@/shared/inbox-model";

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
  link: "",
  commentId: "",
  issueType: "",
  others: [],
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
    get: () => state,
    set: (patch: { perf: string }) => {
      if (patch.perf) messages.push(patch.perf);
    },
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
    confirm: async () => true,
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

test("keyboard movement follows filtered display order and keeps the newly read selection visible", () => {
  const a = setup(false);
  a.items[0]!.time = "2026-11-12T00:00:00Z";
  a.items[1]!.time = "2026-11-11T00:00:00Z";
  a.store.changeView({ ordering: "oldest", unreadOnly: true });
  a.store.moveRow(1);
  expect(a.store.selected()).toBe("3");
  expect(a.store.selectedRow()?.unread).toBe(false);
  a.store.moveRow(1);
  expect(a.store.selected()).toBe("2");
  a.store.moveRow(1);
  expect(a.store.selected()).toBe("1");
  a.store.moveRow(1);
  expect(a.store.selected()).toBe("1");
});

test("snooze removal advances selection and undo restores prior local state and selection", () => {
  const a = setup(false);
  a.store.selectRow(a.items[0]);
  const until = Date.now() + 3_600_000;
  a.store.snoozeRow(until);
  expect(a.store.selected()).toBe("2");
  expect(a.store.localState()["head-1"]).toEqual({
    read: true,
    snoozed: until,
  });
  a.store.undoInboxToast();
  expect(a.store.selected()).toBe("1");
  expect(a.store.localState()["head-1"]).toEqual({ read: true });
});

test("stale feed consumers share one observer and remounting a pane does not refetch loaded pages", async () => {
  const a = setup(false);
  let fetches = 0;
  a.ports.fetchPage = async () => {
    fetches++;
    return { unseen: 0, items: a.items, more: false, writable: false };
  };
  a.ports.queryClient.setQueryDefaults(["inbox"], { staleTime: 0 });
  const observer = a.store.feed("all");
  const stopBadge = observer.subscribe(() => {});
  await observer.refetch();
  // Keep the badge mounted, as in the application, then make every page stale.
  a.ports.queryClient.setQueryData(["inbox", "all"], observer.getCurrentResult().data, { updatedAt: 1 });
  const before = fetches;
  for (let i = 0; i < 3; i++) {
    const pane = a.store.feed("all");
    expect(pane).toBe(observer);
    const stopPane = pane.subscribe(() => {});
    a.store.moveRow(1);
    stopPane();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetches).toBe(before);
  stopBadge();
  a.ports.queryClient.clear();
});

test("a mirror poll with unchanged inbox facets preserves the order selector's identity", () => {
  const a = setup(false);
  const data = a.store.feed("all").getCurrentResult().data;
  const own = a.store.localState(), view = a.store.viewState(), now = Date.now();
  const first = a.store.orderOf(data, own, view, now, null, new Map());
  const polled = a.store.orderOf(data, own, view, now, null, new Map());
  expect(polled).toBe(first);
  a.ports.queryClient.clear();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function recording(writable = true) {
  const calls: object[] = [];
  const a = setup(writable, async (body) => {
    calls.push(body);
    return null;
  });
  return { ...a, calls };
}

test("undoing a delete puts the selection back without marking the row read in Jira (R3-inbox-D1)", async () => {
  const a = recording();
  a.store.restoreSelection("1");
  a.store.deleteRow(); // Linear activates the next row: a visit, so it is read
  a.store.undoInbox();
  await tick();
  expect(a.store.selected()).toBe("1");
  expect(a.calls).toEqual([{ action: "read", groups: ["2"] }]);
  expect(a.store.selectedRow()?.unread).toBe(true);
});

test("a bulk delete that removes the selected row moves on without marking the next one read (R3-inbox-D1)", async () => {
  const a = recording();
  a.items[0]!.unread = false;
  a.store.restoreSelection("1");
  await a.store.deleteAll("read");
  await tick();
  expect(a.store.selected()).toBe("2");
  expect(a.calls).toEqual([]);
  expect(a.store.localState()["head-1"]).toEqual({ deleted: true });
});

test("a read cut off by a reload is sent again on the next load (R3-inbox-D2)", async () => {
  const gone = setup(true, () => new Promise(() => {})); // the page goes away mid-write
  gone.store.selectRow(gone.items[0]);
  await tick();
  const next = recording();
  Object.assign(next.saved, gone.saved);
  expect(next.store.localState()["head-1"]).toEqual({ read: true });
  next.store.resumeWrites();
  next.store.resumeWrites(); // once per load
  await tick();
  await tick();
  expect(next.calls).toEqual([{ action: "read", groups: ["1"] }]);
  expect(next.saved.pending).toEqual({});
  expect(next.store.localState()["head-1"]).toBeUndefined();
});

test("⌥U leaves snoozed rows unread in Jira and marks unloaded unread rows at once (R3-inbox-D3, D5)", async () => {
  const gate = deferred();
  const calls: object[] = [];
  const a = setup(true, async (body) => {
    calls.push(body);
    await gate.promise;
    return { groups: [] };
  });
  const data = a.ports.queryClient.getQueryData<{ pages: Feed[] }>(["inbox", "all"])!;
  data.pages[0]!.unread = [
    { id: "1", head: "head-1" },
    { id: "2", head: "head-2" },
    { id: "far", head: "head-far" },
  ];
  a.store.snoozeRow(Date.now() + 3_600_000, a.items[0]);
  const done = a.store.markAllRead();
  await tick();
  expect(calls).toEqual([{ action: "read-all", except: ["head-1"] }]);
  const own = a.store.localState();
  expect(own["head-far"]).toEqual({ read: true });
  expect(own["head-1"]?.read).toBeUndefined();
  expect(unreadCount(data.pages[0]!.unread, a.items, own)).toBe(0);
  gate.resolve();
  await done;
});

test("⌥U leaves deleted (hidden) unread rows unread in Jira, as Linear's list never shows them (R3 G10)", async () => {
  const calls: object[] = [];
  const a = setup(true, async (body) => (calls.push(body), { groups: [] }));
  const data = a.ports.queryClient.getQueryData<{ pages: Feed[] }>(["inbox", "all"])!;
  data.pages[0]!.unread = [
    { id: "2", head: "head-2" },
    { id: "far", head: "head-far" },
  ];
  a.store.deleteRow(a.items[1]);
  await a.store.markAllRead();
  expect(calls).toEqual([{ action: "read-all", except: ["head-2"] }]);
  expect(a.store.localState()["head-2"]?.read).toBeUndefined();
});

test("Delete all completed takes only read rows of completed issues, after Linear's confirmation (R3-inbox-D4, D6)", async () => {
  const a = recording(false);
  const asked: DeleteConfirmation[] = [];
  let answer = false;
  a.ports.confirm = async (question) => (asked.push(question), answer);
  a.items[0]!.status = "Done";
  a.items[0]!.unread = false;
  a.items[1]!.status = "Done";
  await a.store.deleteAll("completed");
  expect(a.store.localState()).toEqual({});
  answer = true;
  await a.store.deleteAll("completed");
  expect(asked[0]).toEqual({
    title: "Delete all read notifications for completed issues?",
    description: "This will delete all read notifications about issues that were marked as done or canceled.",
  });
  expect(a.store.localState()).toEqual({ "head-1": { deleted: true } });
});

test("bulk delete confirmations use Linear's wording, naming the priority inbox's tab", () => {
  expect(deleteQuestion("all", DEFAULT_VIEW)).toEqual({
    title: "Delete all notifications?",
    description: "This will delete all notifications in your inbox.",
  });
  expect(deleteQuestion("read", { priorityInbox: true, tab: "watching" })).toEqual({
    title: "Delete all read notifications?",
    description: "This will delete all read notifications in the Other inbox.",
  });
  expect(deleteQuestion("completed", { priorityInbox: true, tab: "direct" }).title).toBe(
    "Delete all read notifications for completed issues in the Priority inbox?",
  );
});
