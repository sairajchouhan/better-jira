import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterContextProvider } from "@tanstack/react-router";
import type { Issue } from "@/shared/issue-model";
import type { InboxItem } from "@/shared/inbox-model";
import { commit, get, type State } from "@/client/state/store";
import { createInboxStore, type InboxPorts, type Feed } from "@/client/state/inbox-store";
import { QueryClient } from "@tanstack/query-core";
import { escapeStep, shortcutApplies, shortcuts } from "@/client/features/navigation/shortcuts";
import { router } from "@/client/features/navigation/app-navigation";
import { followPane } from "./inbox";

// Made-up issues and notifications only.
const before = get();
afterEach(() =>
  commit({ issues: before.issues, inbox: before.inbox, selected: before.selected, panel: before.panel, view: before.view, document: before.document, direct: before.direct }),
);
const issue = (key: string): Issue => ({
  key, boards: [7], summary: `${key} made-up title`, status: "todo", type: "Task", assignee: null, labels: [], comments: 0,
  updated: "2026-11-01T10:00:00Z", resolved: null,
});
const screen = (patch: Partial<State>): State => ({
  ...get(), columnSelection: new Set(), sidebarOpen: false, document: null, direct: false, inbox: false, selected: null, panel: false,
  view: "side", ...patch,
});
const pane = screen({ inbox: true, selected: "A-1", panel: true, view: "side" });
const pageFromInbox = screen({ inbox: true, selected: "A-1", panel: true, view: "page" });
const directPage = screen({ selected: "A-1", panel: true, view: "page", direct: true });
const shortcut = (id: string) => shortcuts.find((s) => s.id === id)!;

test("item 9: Escape on an issue page opened by its address alone does nothing, as Linear's (no backOnEsc)", () => {
  expect(escapeStep(directPage, false)).toBe("stay");
  // The same page reached from a board still goes back.
  expect(escapeStep({ ...directPage, direct: false }, false)).toBe("escape");
});

test("item 1: Escape on the full page opened from the inbox's pane goes back to that notification (Linear's backOnEsc → co)", () => {
  expect(escapeStep(pageFromInbox, false)).toBe("inbox");
});

test("item 10: Escape in the inbox's pane leaves the inbox's root, not the row as a notification on its own (D1)", () => {
  expect(escapeStep(pane, true)).toBe("inbox-root");
  // An unmirrored row shown as a notification closes the same way.
  expect(escapeStep(screen({ inbox: true }), true)).toBe("inbox-root");
  expect(escapeStep(screen({ inbox: true }), false)).toBe("escape");
});

test("item 17: ] does nothing in the inbox's pane, as Linear's IssueInboxView has no details panel; it still applies on a board's issue", () => {
  expect(shortcutApplies(shortcut("details"), pane)).toBe(false);
  expect(shortcutApplies(shortcut("details"), screen({ selected: "A-1", panel: true }))).toBe(true);
});

test("item 4: the full page reached from the inbox drops the notification's keys (U, E, H, ⌫); the pane keeps them", () => {
  for (const id of ["inbox-read", "inbox-delete", "inbox-snooze", "inbox-backspace"]) {
    expect(shortcutApplies(shortcut(id), pane)).toBe(true);
    expect(shortcutApplies(shortcut(id), pageFromInbox)).toBe(false);
  }
});

test("item 3: ⌘K offers Linear's Open full issue view only on the inbox's pane, with no key of its own", () => {
  const open = shortcut("inbox-open-page");
  expect(open.name).toBe("Open full issue view");
  expect(open.hotkey).toBeUndefined();
  expect(shortcutApplies(open, pane)).toBe(true);
  expect(shortcutApplies(open, pageFromInbox)).toBe(false);
  expect(shortcutApplies(open, screen({ inbox: true }))).toBe(false);
});

const row = (id: string, key: string): InboxItem =>
  ({ id, head: `head-${id}`, key, title: id, status: "", url: "", actor: null, kind: "updated", message: "", preview: "",
    time: "2026-11-10T00:00:00Z", unread: false, category: "direct", count: 1, link: "", commentId: "", issueType: "", others: [] }) as InboxItem;
function store() {
  const queryClient = new QueryClient();
  const page: Feed = { items: [row("1", "A-1"), row("2", "A-2")], more: false, writable: true, unseen: 0 };
  queryClient.setQueryData(["inbox", "all"], { pages: [page], pageParams: [""] });
  const calls: string[] = [];
  const ports = {
    queryClient, get: () => ({ issues: new Map(), clock: Date.now() }), set: () => {}, ui: { send: () => {} }, statusOf: () => undefined,
    read: <T,>(_: string, fallback: T) => fallback, save: () => {}, fetchPage: async () => page, send: async () => null,
    openRow: (item: InboxItem, open: string) => void calls.push(`${open} ${item.id}`),
    clearSelection: () => void calls.push("clear"), confirm: async () => true, shown: () => true, fullPage: () => false,
    later: () => () => {},
  } as unknown as InboxPorts;
  return { s: createInboxStore(ports), calls };
}

test("item 3: Enter opens the focused row in the pane, never the full page (Linear's ListCell Gt)", () => {
  const { s, calls } = store();
  s.moveRow(1);
  calls.length = 0;
  s.openRow();
  expect(calls).toEqual(["side 1"]);
});

test("item 10: Escape's leaveRow clears the selection and the address; forgetSelection only the selection", () => {
  const { s, calls } = store();
  s.moveRow(1);
  calls.length = 0;
  s.forgetSelection();
  expect([s.selected(), calls]).toEqual([null, []]);
  s.moveRow(1);
  calls.length = 0;
  s.leaveRow();
  expect([s.selected(), calls]).toEqual([null, ["clear"]]);
});

test("item 10: Back from the pane, or leaving the inbox, forgets the row, so the inbox shows its root (D1)", () => {
  const forget = (b: Partial<State>, a: Partial<State>, selectedKey = "A-1") => {
    let forgot = false;
    followPane(screen(b), screen(a), { selectedRow: () => row("1", selectedKey), forgetSelection: () => void (forgot = true) });
    return forgot;
  };
  const open = { inbox: true, selected: "A-1", panel: true };
  expect(forget(open, { inbox: true })).toBe(true); // Back to /inbox
  expect(forget(open, { selected: "B-1", panel: true })).toBe(true); // to a board's issue
  expect(forget(open, { inbox: true, selected: "A-2", panel: true }, "A-2")).toBe(false); // J/K
  expect(forget(open, { ...open, view: "page" })).toBe(false); // Open full issue view keeps the row
  expect(forget({ inbox: true }, { inbox: true })).toBe(false);
});

test("a comment notification's anchor lands on the entry it opened, never on one opened since (Escape back to the pane keeps its mark)", async () => {
  const { showAnchorSoon } = await import("@/client/features/navigation/app-navigation");
  const h = router.history;
  h.push("/issue/A-1", { issueOrigin: "inbox" } as never);
  let frame = () => {};
  showAnchorSoon("comment-1", (run) => (frame = run));
  h.push("/issue/A-1", { over: { to: "inbox" } } as never); // the title opened the full page before the frame came
  h.back();
  await new Promise((done) => setTimeout(done, 0));
  const pane = h.location.state.key;
  h.forward();
  await new Promise((done) => setTimeout(done, 0));
  frame();
  expect(h.location.hash).toBe("");
  expect((h.location.state as { over?: unknown }).over).toBeTruthy();
  h.back();
  await new Promise((done) => setTimeout(done, 0));
  expect([h.location.state.key, (h.location.state as { issueOrigin?: string }).issueOrigin]).toEqual([pane, "inbox"]);
  // On time, it points the pane's own entry at the comment, keeping its mark.
  showAnchorSoon("comment-1", (run) => run());
  expect([h.location.hash, (h.location.state as { issueOrigin?: string }).issueOrigin]).toEqual(["#comment-1", "inbox"]);
});
