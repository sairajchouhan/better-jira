import { expect, test } from "bun:test";
import { screenUrl, transition, type NavigationData, type NavigationEvent, type Screen } from "./navigation";
import { emptyOverlay, type SavedView, type ViewDraft } from "./saved-view-model";
import { defaultPreferences } from "./view-model";

const prefs = (openIn: "side" | "page") => {
  const p = defaultPreferences();
  return { ...p, display: { ...p.display, openIn } };
};
const view = (patch: Partial<SavedView> = {}): SavedView => {
  const p = defaultPreferences();
  return {
    id: "v1",
    board: 1,
    kind: "custom",
    name: "Triage",
    description: "",
    icon: "filter",
    color: "gray",
    filters: p.filters,
    display: { ...p.display, openIn: "page" },
    scope: p.scope,
    mine: true,
    createdAt: "",
    updatedAt: "",
    ...patch,
  };
};
const start: Screen = {
  board: 1,
  view: "side",
  selected: null,
  panel: false,
  document: null,
  inbox: false,
  mine: false,
  viewsPage: false,
  activeViewId: null,
  overlayFilters: emptyOverlay(),
  editorDraft: null,
  linkView: false,
};
const data = (patch: Partial<NavigationData> = {}): NavigationData => ({
  savedViews: [view()],
  preferences: { 1: prefs("side"), 2: prefs("page") },
  defaults: {},
  boards: [{ id: 1 }, { id: 2 }],
  issue: (key) => ({ "A-1": { key: "A-1", board: 1 }, "B-1": { key: "B-1", board: 2 } })[key],
  currentKey: (key) => (key === "OLD-1" ? "A-1" : key),
  draftFor: (id) => ({ ...view(), id, name: id ? "Triage" : "" }),
  ...patch,
});
/** Runs events in order, each from the screen the last one left. */
const run = (events: NavigationEvent[], d = data(), screen = start) =>
  events.reduce((t, e) => transition(t.screen, e, d), { screen, history: "none" } as ReturnType<typeof transition>);
const url = (s: Screen, href = "http://x/", views = [view()]) => {
  const u = new URL(screenUrl(s, href, views));
  return u.pathname + u.search + u.hash;
};

test("an issue opens the way its board does; choosing page or side is remembered by the board", () => {
  const opened = run([{ type: "go", to: { selected: "OLD-1", panel: true } }]);
  expect(opened.screen).toMatchObject({ selected: "A-1", panel: true, view: "side" });
  expect(url(opened.screen)).toBe("/?board=1&issue=A-1&view=side");
  const page = transition(opened.screen, { type: "go", to: { view: "page" } }, data());
  expect(page.preferences?.[1]!.display.openIn).toBe("page");
  expect(page.history).toBe("push");
  // A new board opens issues its own way, from its preferences, then its saved default.
  expect(transition(start, { type: "go", to: { board: 2 } }, data()).screen.view).toBe("page");
  const d = data({ preferences: {}, defaults: { 2: { ...prefs("page").display } } });
  expect(transition(start, { type: "go", to: { board: 2 } }, d).screen.view).toBe("page");
});

test("a document needs an open issue and closes with it; a new board resets My issues and leaves the Inbox", () => {
  const go = (to: object, s = start) => transition(s, { type: "go", to }, data()).screen;
  expect(go({ document: "orphan" }).document).toBeNull();
  const doc = go({ selected: "A-1", panel: true, document: "doc" });
  expect(doc.document).toBe("doc");
  expect(go({ panel: false, document: "doc" }, doc).document).toBeNull();
  expect(go({ selected: "B-1" }, doc).document).toBeNull();
  expect(go({ selected: null, panel: true, document: "doc" }).document).toBeNull();
  const elsewhere = go({ board: 2 }, { ...start, mine: true, inbox: true });
  expect([elsewhere.mine, elsewhere.inbox]).toEqual([false, false]);
  expect(go({ board: 1 }, { ...start, mine: true }).mine).toBe(true);
});

test("a link's view shows that issue once, then reverts without becoming a preference", () => {
  const linked = run([{ type: "restore", href: "http://x/?board=1&issue=A-1&view=page", draft: null }]);
  expect(linked).toMatchObject({ history: "none", screen: { view: "page", linkView: true, panel: true } });
  expect(linked.preferences).toBeUndefined();
  const closed = transition(linked.screen, { type: "moved", screen: { panel: false } }, data());
  expect(closed.screen).toMatchObject({ view: "side", linkView: false, panel: false });
  // Reverting rewrites the board's own choice, unchanged.
  expect(closed.preferences?.[1]!.display.openIn).toBe("side");
  const missing = run([{ type: "restore", href: "http://x/?board=1&issue=GONE-1", draft: null }]);
  expect(missing).toMatchObject({ missing: "GONE-1", screen: { panel: false, selected: null } });
});

test("inside a saved view, a new openIn is saved to the view; opening or restoring it never is (BJ-155)", () => {
  const opened = run([{ type: "open-view", view: view() }]);
  expect(opened.screen).toMatchObject({ activeViewId: "v1", view: "page", mine: true, linkView: false });
  expect([opened.viewDisplay, opened.preferences]).toEqual([undefined, undefined]);
  // A reload on the view's old address: the board opens issues beside it, the view as a page.
  const restored = run([{ type: "restore", href: "http://x/view/v1?board=1", draft: null }]);
  expect(restored).toMatchObject({ path: "/view/triage-v1", screen: { activeViewId: "v1", view: "page" } });
  expect([restored.viewDisplay, restored.preferences]).toEqual([undefined, undefined]);
  const linked = run([{ type: "restore", href: "http://x/view/triage-v1?board=1&issue=A-1&view=side", draft: null }], data(), restored.screen);
  expect(linked.path).toBeUndefined();
  expect(linked.screen).toMatchObject({ view: "side", linkView: true });
  expect([linked.viewDisplay, linked.preferences]).toEqual([undefined, undefined]);
  const toggled = run([{ type: "go", to: { selected: "A-1", panel: true } }, { type: "go", to: { view: "side" } }], data(), opened.screen);
  expect(toggled.viewDisplay?.display.openIn).toBe("side");
  expect(toggled.preferences).toBeUndefined();
});

test("leaving or switching a view drops its filter overlay; going to a board picks how that board opens issues", () => {
  const filters = { id: "o", join: "and" as const, children: [{ id: "r", field: "labels" as const, op: "is" as const, values: ["x"] }] };
  const filtered = run([{ type: "open-view", view: view() }, { type: "filters", filters }]);
  expect(url(filtered.screen)).toStartWith("/view/triage-v1?filter=");
  const other = transition(filtered.screen, { type: "open-view", view: view({ id: "v2", name: "Other" }) }, data());
  expect(other.screen.overlayFilters.children).toHaveLength(0);
  const left = transition(filtered.screen, { type: "go", to: { board: 1 } }, data());
  expect(left.screen).toMatchObject({ activeViewId: null, view: "side", overlayFilters: { children: [] } });
  expect(url(left.screen)).toBe("/?board=1&mine=1");
});

test("the view editor takes display changes into its draft, keeps the board's preference, and returns on cancel", () => {
  const draft: ViewDraft = { ...view(), id: undefined, sourceId: "v1", name: "" };
  const editing = run([{ type: "edit-view", draft }]);
  expect(editing.screen).toMatchObject({ editorDraft: { name: "" }, activeViewId: null, mine: true });
  expect(url(editing.screen)).toBe("/view/new?board=1&mine=1");
  const toggled = run([{ type: "go", to: { selected: "A-1", panel: true } }, { type: "go", to: { view: "page" } }], data(), editing.screen);
  expect(toggled.screen.editorDraft?.display.openIn).toBe("page");
  expect(toggled.preferences).toBeUndefined();
  const cancelled = transition(editing.screen, { type: "discard-editor" }, data());
  expect(cancelled).toMatchObject({ forgetDraft: true, screen: { editorDraft: null, activeViewId: "v1" } });
  // Leaving through another board first adds the editor's board, as it always has.
  const left = transition(editing.screen, { type: "go", to: { board: 2 } }, data());
  expect(left.via && url(left.via)).toBe("/?board=1&mine=1");
  expect(url(left.screen)).toBe("/?board=2");
  // A reload of the editor's address uses the draft kept for it, else starts a fresh one.
  const kept = run([{ type: "restore", href: "http://x/view/new?board=1", draft: { ...draft, name: "Kept" } }]);
  expect(kept.screen.editorDraft?.name).toBe("Kept");
  const fresh = run([{ type: "restore", href: "http://x/view/triage-v1/edit", draft: null }]);
  expect(fresh.screen.editorDraft).toMatchObject({ id: "v1", name: "Triage" });
});

test("the address keeps a hash only while it still points at the same issue and document", () => {
  const open = { ...start, selected: "A-1", panel: true };
  expect(url(open, "http://x/?board=1&issue=A-1&view=side#comment-1")).toBe("/?board=1&issue=A-1&view=side#comment-1");
  expect(url({ ...open, selected: "B-1" }, "http://x/?board=1&issue=A-1&view=side#comment-1")).toBe(
    "/?board=1&issue=B-1&view=side",
  );
  expect(url({ ...start, viewsPage: true, inbox: true }, "http://x/?notification=9")).toBe("/views?notification=9&board=1&inbox=1");
});
