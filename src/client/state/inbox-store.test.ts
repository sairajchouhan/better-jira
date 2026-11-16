import { afterEach, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";
import type { ReactElement } from "react";
import { toasts } from "@/client/components/toast-queue";
import { INBOX_NOTIFICATION_ID } from "./app-notifications";
import { createInboxStore, deleteQuestion, READ_DELAY, type InboxPorts, type Feed, type DeleteConfirmation } from "./inbox-store";
import { unreadCount } from "@/shared/inbox-model";
import { DEFAULT_VIEW, type InboxItem } from "@/shared/inbox-model";

// A bulk delete's undo toast must not reach the next test file's toast queue.
afterEach(() => toasts.dismissAll());

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
  // A manual clock for the delayed read: `flush` runs what is due, `timers` shows what waits.
  const timers: { fn: () => void; ms: number }[] = [];
  const view = { inbox: true, page: false };
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
    shown: () => view.inbox,
    fullPage: () => view.page,
    later: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return () => void timers.splice(timers.indexOf(timer) >>> 0, 1);
    },
  };
  const flush = () => {
    for (const timer of timers.splice(0)) timer.fn();
  };
  return {
    store: createInboxStore(ports),
    timers,
    flush,
    view,
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
  a.flush();
  expect(a.store.localState()["head-1"]).toEqual({ read: true, group: "1" });
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
  a.flush();
  expect(a.store.selectedRow()?.unread).toBe(false);
  a.store.moveRow(1);
  expect(a.store.selected()).toBe("2");
  a.store.moveRow(1);
  expect(a.store.selected()).toBe("1");
  a.store.moveRow(1);
  expect(a.store.selected()).toBe("1");
});

const inboxToast = () => {
  const toast = toasts.all().find((t) => t.id === INBOX_NOTIFICATION_ID);
  return toast && (toast.content as ReactElement<{ notice: { text: string } }>).props.notice.text;
};

test("BEn: in the split view a snooze selects the next row without a toast; Z restores the snooze and the selection", () => {
  toasts.dismiss(INBOX_NOTIFICATION_ID);
  const a = setup(false);
  a.store.selectRow(a.items[0]);
  a.flush();
  const until = Date.now() + 3_600_000;
  a.store.snoozeRow(until);
  expect(a.store.selected()).toBe("2");
  expect(a.store.localState()["head-1"]).toEqual({
    read: true,
    group: "1",
    snoozed: until,
  });
  expect(inboxToast()).toBeUndefined();
  a.store.undoInbox();
  expect(a.store.selected()).toBe("1");
  expect(a.store.localState()["head-1"]).toEqual({ read: true, group: "1" });
});

test("BEn: with Show snoozed on, the snoozed row stays selected", () => {
  toasts.dismiss(INBOX_NOTIFICATION_ID);
  const a = setup(false);
  a.store.changeView({ showSnoozed: true });
  a.store.selectRow(a.items[0]);
  a.store.snoozeRow(Date.now() + 3_600_000);
  expect(a.store.selected()).toBe("1");
  expect(a.opened).toEqual(["1"]);
  expect(inboxToast()).toBeUndefined();
});

test("mEn: only the full-page view toasts 'Notification snoozed', and it goes back to the inbox's root", () => {
  toasts.dismiss(INBOX_NOTIFICATION_ID);
  const a = setup(false);
  a.store.selectRow(a.items[0], "page");
  a.view.page = true;
  a.store.snoozeRow(Date.now() + 3_600_000);
  expect(inboxToast()).toBe("Notification snoozed");
  expect(a.store.selected()).toBeNull();
  expect(a.opened.at(-1)).toBe("clear");
  a.view.page = false;
  a.store.undoInboxToast();
  expect(a.store.selected()).toBe("1");
  expect(a.store.localState()["head-1"]?.snoozed).toBeUndefined();
  toasts.dismiss(INBOX_NOTIFICATION_ID);
});

test("pEn: Unsnooze clears the snooze of the menu's row, and Z puts it back", () => {
  const a = setup(false);
  const until = Date.now() + 3_600_000;
  a.store.snoozeRow(until, a.items[1]);
  a.store.openSnooze({ item: a.items[1] });
  expect(a.store.snoozeMenu().item?.id).toBe("2");
  a.store.unsnoozeRow();
  expect(a.store.localState()["head-2"]).toBeUndefined();
  a.store.undoInbox();
  expect(a.store.localState()["head-2"]).toEqual({ snoozed: until });
  // A row that isn't snoozed has nothing to unsnooze, and no undo step.
  a.store.unsnoozeRow(a.items[0]);
  a.store.undoInbox();
  expect(a.store.localState()["head-2"]).toBeUndefined();
});

test("the snooze menu knows how it was opened: by key, on a right-clicked row, at Custom…", () => {
  const a = setup(false);
  a.store.selectRow(a.items[2]);
  a.store.openSnooze({ invoked: "keyboard" });
  expect(a.store.snoozeMenu()).toEqual({ invoked: "keyboard", item: a.items[2] });
  a.store.openSnooze({ item: a.items[0], step: "custom" });
  expect(a.store.snoozeMenu()).toEqual({ item: a.items[0], step: "custom" });
  // The snooze applies to that row, and the next menu starts afresh.
  a.store.snoozeRow(Date.now() + 60_000);
  expect(a.store.localState()["head-1"]?.snoozed).toBeGreaterThan(Date.now());
  expect(a.store.snoozeMenu()).toEqual({ item: a.items[2] });
});

test("unsnoozedAt: a snooze that ran out brings the row back unread and remembers when", async () => {
  const a = setup(false);
  const until = Date.now() - 1000;
  a.store.snoozeRow(until, a.items[0]);
  a.store.snoozeRow(Date.now() + 60_000, a.items[1]);
  a.store.wakeSnoozed(a.items, Date.now());
  await Promise.resolve();
  expect(a.store.localState()["head-1"]).toEqual({ read: false, group: "1", unsnoozed: until });
  expect(a.store.localState()["head-2"]?.snoozed).toBeGreaterThan(Date.now());
  expect(a.store.localState()["head-2"]?.unsnoozed).toBeUndefined();
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
  a.store.deleteRow(); // Linear activates the next row: a visit, so it is read once it has shown 300 ms
  a.flush();
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
  gone.flush();
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

test("B1: a selected row is read only after it has shown for Linear's 300 ms, by key or click alike", async () => {
  const a = recording();
  a.store.selectRow(a.items[0]); // a click
  expect(a.timers.map((t) => t.ms)).toEqual([READ_DELAY]);
  expect(READ_DELAY).toBe(300);
  expect(a.store.localState()["head-1"]).toBeUndefined();
  await tick();
  expect(a.calls).toEqual([]);
  a.flush();
  await tick();
  expect(a.calls).toEqual([{ action: "read", groups: ["1"] }]);
});

test("B1: J/K through rows marks none of the rows passed, only the one that stays", async () => {
  const a = recording();
  a.store.moveRow(1); // 1
  a.store.moveRow(1); // 2
  a.store.moveRow(1); // 3
  expect(a.store.selected()).toBe("3");
  expect(a.timers).toHaveLength(1); // each move cancels the last row's read
  a.flush();
  await tick();
  expect(a.calls).toEqual([{ action: "read", groups: ["3"] }]);
  expect(a.store.localState()["head-1"]).toBeUndefined();
  expect(a.store.localState()["head-2"]).toBeUndefined();
});

test("B1: leaving the inbox, an undo that moves the selection back, or U on the row cancels its pending read", async () => {
  const left = recording();
  left.store.selectRow(left.items[0]);
  left.view.inbox = false; // the notification no longer shows
  left.flush();
  await tick();
  expect(left.calls).toEqual([]);

  const undone = recording();
  undone.store.restoreSelection("1");
  undone.store.deleteRow(); // selects row 2, a visit
  undone.store.undoInbox(); // back to row 1 within 300 ms: row 2 never showed long enough
  undone.flush();
  await tick();
  expect(undone.calls).toEqual([]);
  expect(undone.store.selected()).toBe("1");

  const toggled = recording();
  toggled.store.selectRow(toggled.items[0]);
  toggled.store.toggleRead(); // U reads it now
  expect(toggled.timers).toHaveLength(0);
  await tick();
  expect(toggled.calls).toEqual([{ action: "read", groups: ["1"] }]);
});

test("B1: an already read row starts no timer", () => {
  const a = recording();
  a.items[0]!.unread = false;
  a.store.selectRow(a.items[0]);
  expect(a.timers).toHaveLength(0);
});

test("D3: Z after a delete or snooze made during a read write never brings back that write's local read mark", async () => {
  for (const act of ["delete", "snooze", "unsnooze"] as const) {
    const gate = deferred();
    const a = setup(true, async () => (await gate.promise, null));
    a.items[0]!.unread = false;
    if (act === "unsnooze") a.store.snoozeRow(Date.now() + 60_000, a.items[0]);
    const write = a.store.markRead([a.items[0]!], false); // U: mark as unread, Jira still answering
    if (act === "delete") a.store.deleteRow(a.items[0]);
    else if (act === "snooze") a.store.snoozeRow(Date.now() + 60_000, a.items[0]);
    else a.store.unsnoozeRow(a.items[0]);
    gate.resolve();
    await write;
    a.store.undoInbox();
    expect(a.store.localState()["head-1"]?.read).toBeUndefined();
    // The row's head goes; Jira's count is what the badge shows.
    expect(unreadCount([], [], a.store.localState())).toBe(0);
  }
});

test("D3: on a writable site a read mark with no write behind it is dropped at load; a cut-off write's mark is kept", async () => {
  const a = setup(true, () => new Promise(() => {}));
  a.saved.local = { "head-old": { read: false }, "head-del": { read: false, deleted: true }, "head-1": { read: true } };
  a.saved.pending = { "head-1": { group: "1", read: true } };
  a.store.resumeWrites();
  await tick();
  expect(a.store.localState()).toEqual({ "head-del": { deleted: true }, "head-1": { read: true } });
  expect(unreadCount([], [], a.store.localState())).toBe(0);
});

test("D3: a read-only site's mark goes once Jira's feed shows its group under a newer head", () => {
  const a = setup(false);
  a.store.markRead([a.items[0]!, a.items[1]!], false);
  expect(a.store.localState()["head-1"]).toEqual({ read: false, group: "1" });
  const data = a.ports.queryClient.getQueryData<{ pages: Feed[] }>(["inbox", "all"])!;
  // New activity on issue 1: Jira's group 1 now leads with another notification.
  a.store.tidyLocal([{ ...a.items[0]!, head: "head-1b" }, a.items[1]!, ...(data.pages[0]!.unread ?? [])]);
  expect(a.store.localState()["head-1"]).toBeUndefined();
  expect(a.store.localState()["head-2"]).toEqual({ read: false, group: "2" });
});

test("D11: a snooze wakes at its own time, not at the next minute; a month-long one waits in steps setTimeout can keep", () => {
  const a = setup(false);
  const woke: number[] = [];
  expect(a.store.wakeAt({}, () => woke.push(1))).toBeUndefined();
  const soon = Date.now() + 5_000;
  a.store.wakeAt({ "head-1": { snoozed: soon }, "head-2": { snoozed: soon + 60_000 } }, () => woke.push(1));
  expect(a.timers).toHaveLength(1);
  expect(a.timers[0]!.ms).toBeGreaterThan(4_000);
  expect(a.timers[0]!.ms).toBeLessThanOrEqual(5_000);
  a.timers.splice(0);
  const cancel = a.store.wakeAt({ "head-1": { snoozed: Date.now() + 31 * 86_400_000 } }, () => woke.push(2));
  expect(a.timers[0]!.ms).toBe(2 ** 31 - 1);
  a.flush(); // the first step ends early: not due yet, so it waits again
  expect(woke).toEqual([]);
  expect(a.timers).toHaveLength(1);
  cancel!();
  expect(a.timers).toHaveLength(0);
});

test("D6: a row shows its mirrored issue's title as it is now, and a rename re-orders nothing but still renders", () => {
  const a = setup(false);
  const data = a.store.feed("all").getCurrentResult().data;
  const own = a.store.localState(), view = a.store.viewState(), now = Date.now();
  const before = a.store.orderOf(data, own, view, now, null, new Map());
  expect(before.rows[0]!.title).toBe("1");
  const renamed = a.store.orderOf(data, own, view, now, null, new Map([["TEST-1", { summary: "Renamed" } as never]]));
  expect(renamed).not.toBe(before);
  expect(renamed.rows[0]!.title).toBe("Renamed");
  // Find reads the live title too.
  const found = a.store.orderOf(data, own, { ...view, find: "renamed" }, now, null, new Map([["TEST-1", { summary: "Renamed" } as never]]));
  expect(found.rows.map((r) => r.id)).toEqual(["1"]);
  a.ports.queryClient.clear();
});

test("D13: Delete all takes the whole inbox whatever the filters, find or unread-only show, but not snoozed rows (Linear zEn)", async () => {
  const a = recording(false);
  a.items[1]!.unread = false;
  a.store.snoozeRow(Date.now() + 60_000, a.items[2]);
  a.store.changeView({ unreadOnly: true, filters: { from: ["Nobody"] } });
  a.store.setFind("1");
  const asked: DeleteConfirmation[] = [];
  a.ports.confirm = async (q) => (asked.push(q), true);
  await a.store.deleteAll("all");
  expect(asked[0]!.description).toBe("This will delete all notifications in your inbox.");
  expect(a.store.localState()["head-1"]?.deleted).toBe(true);
  expect(a.store.localState()["head-2"]?.deleted).toBe(true);
  expect(a.store.localState()["head-3"]?.deleted).toBeUndefined();
  a.store.undoInbox();
  // With Show snoozed on, the snoozed row goes too.
  a.store.changeView({ showSnoozed: true });
  await a.store.deleteAll("all");
  expect(a.store.localState()["head-3"]?.deleted).toBe(true);
});

test("D13: in the priority inbox, Delete all read takes the open tab's read rows only", async () => {
  const a = recording(false);
  a.items[0]!.unread = false;
  a.items[1]!.unread = false;
  a.items[1]!.category = "watching";
  const page = { items: a.items, more: false, writable: false, unseen: 0 };
  a.ports.queryClient.setQueryData(["inbox", "direct"], { pages: [{ ...page, items: a.items.filter((i) => i.category === "direct") }], pageParams: [""] });
  a.store.changeView({ priorityInbox: true, tab: "direct" });
  const asked: DeleteConfirmation[] = [];
  a.ports.confirm = async (q) => (asked.push(q), true);
  await a.store.deleteAll("read");
  expect(asked[0]!.description).toBe("This will delete all read notifications in the Priority inbox.");
  expect(Object.keys(a.store.localState())).toEqual(["head-1"]);
});
