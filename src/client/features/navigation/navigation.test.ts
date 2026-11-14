import { expect, test } from "bun:test";
import { createMemoryHistory } from "@tanstack/react-router";
import { placeOf, restoredTrail, transition, type NavigationData, type NavigationEvent, type Place, type Screen } from "./navigation";
import { emptyOverlay, viewForRoute, type SavedView, type ViewDraft } from "@/shared/saved-view-model";
import { defaultPreferences } from "@/shared/view-model";
import { createAppRouter, legacyPlace, locationOf, type RouteContext } from "@/client/routes/tree";

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
    hidden: {},
    collapsed: {},
    order: {},
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
  person: null,
  personTab: "assigned",
  activeViewId: null,
  overlayFilters: emptyOverlay(),
  editorDraft: null,
  linkView: false,
  favorite: null,
  trail: null,
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
const context: RouteContext = {
  show: () => {},
  preload: async () => {},
  issue: (key) => data().issue(key),
  currentKey: (key) => data().currentKey(key),
  view: (segment) => viewForRoute([view()], segment),
  hasBoard: (board) => board === 1 || board === 2,
  scope: () => "all",
  lastBoard: () => 1,
};
const router = createAppRouter(createMemoryHistory(), context);
/** The address the screen shows. */
const url = (s: Screen) => router.buildLocation(locationOf(placeOf(s, () => "all"), context) as never).href;
/** The place an old address names. */
const legacy = (href: string) => {
  const u = new URL(href, "http://x");
  return legacyPlace(u.pathname, Object.fromEntries(u.searchParams), context)!;
};
const restore = (place: Place, draft: ViewDraft | null = null) => ({ type: "restore", place, draft }) as const;
const board1 = { to: "board", board: 1, scope: "all" } as const;

test("an issue opens the way its board does; choosing page or side is remembered by the board", () => {
  const opened = run([{ type: "go", to: { selected: "OLD-1", panel: true } }]);
  expect(opened.screen).toMatchObject({ selected: "A-1", panel: true, view: "side" });
  expect(url(opened.screen)).toBe("/board/1/all?issue=A-1");
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
  expect(go({ board: 1 }, { ...start, mine: true }).mine).toBe(false);
});

test("a link's view shows that issue once, then reverts without becoming a preference", () => {
  const linked = run([restore({ to: "issue", key: "A-1", over: board1 })]);
  expect(url(linked.screen)).toBe("/issue/A-1");
  expect(linked).toMatchObject({ history: "none", screen: { view: "page", linkView: true, panel: true } });
  expect(linked.preferences).toBeUndefined();
  const closed = transition(linked.screen, { type: "moved", screen: { panel: false } }, data());
  expect(closed.screen).toMatchObject({ view: "side", linkView: false, panel: false });
  // Reverting rewrites the board's own choice, unchanged.
  expect(closed.preferences?.[1]!.display.openIn).toBe("side");
  const missing = run([restore({ ...board1, issue: "GONE-1" })]);
  expect(missing.screen).toMatchObject({ panel: false, selected: null });
});

test("inside a saved view, a new openIn is saved to the view; opening or restoring it never is (BJ-155)", () => {
  const opened = run([{ type: "open-view", view: view() }]);
  expect(opened.screen).toMatchObject({ activeViewId: "v1", view: "page", mine: true, linkView: false });
  expect([opened.viewDisplay, opened.preferences]).toEqual([undefined, undefined]);
  // A reload on the view's old address: the board opens issues beside it, the view as a page.
  const restored = run([restore({ to: "view", id: "v1" })]);
  expect(restored.screen).toMatchObject({ activeViewId: "v1", view: "page" });
  expect(url(restored.screen)).toBe("/view/triage-v1");
  expect([restored.viewDisplay, restored.preferences]).toEqual([undefined, undefined]);
  const linked = run([restore({ to: "view", id: "v1", issue: "A-1" })], data(), restored.screen);
  expect(linked.screen).toMatchObject({ view: "side", linkView: true });
  expect(url(linked.screen)).toBe("/view/triage-v1?issue=A-1");
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
  expect(url(left.screen)).toBe("/board/1/all");
});

test("the view editor takes display changes into its draft, keeps the board's preference, and returns on cancel", () => {
  const draft: ViewDraft = { ...view(), id: undefined, sourceId: "v1", name: "" };
  const editing = run([{ type: "edit-view", draft }]);
  expect(editing.screen).toMatchObject({ editorDraft: { name: "" }, activeViewId: null, mine: true });
  expect(url(editing.screen)).toBe("/view/new");
  const toggled = run([{ type: "go", to: { selected: "A-1", panel: true } }, { type: "go", to: { view: "page" } }], data(), editing.screen);
  expect(toggled.screen.editorDraft?.display.openIn).toBe("page");
  expect(toggled.preferences).toBeUndefined();
  const cancelled = transition(editing.screen, { type: "discard-editor" }, data());
  expect(cancelled).toMatchObject({ forgetDraft: true, screen: { editorDraft: null, activeViewId: "v1" } });
  // BJ-158: leaving pushes only the destination so Back returns to the editor.
  const left = transition(editing.screen, { type: "go", to: { board: 2 } }, data());
  expect(left.history).toBe("push");
  expect(url(left.screen)).toBe("/board/2/all");
  // A reload of the editor's address uses the draft kept for it, else starts a fresh one.
  const kept = run([restore({ to: "editor" }, { ...draft, name: "Kept" })]);
  expect(kept.screen.editorDraft?.name).toBe("Kept");
  const fresh = run([restore({ to: "editor", id: "v1" })]);
  expect(url(fresh.screen)).toBe("/view/triage-v1/edit");
  expect(fresh.screen.editorDraft).toMatchObject({ id: "v1", name: "Triage" });
});

test("My issues is one destination; opening either board leaves it and restore never pushes", () => {
  const mine = transition(start, { type: "go", to: { mine: true } }, data());
  expect(url(mine.screen)).toBe("/my-issues");
  expect(mine.history).toBe("push");
  for (const board of [1, 2]) {
    const opened = transition(mine.screen, { type: "go", to: { board } }, data());
    expect(opened.screen.mine).toBe(false);
    expect(url(opened.screen)).toBe(`/board/${board}/all`);
    const back = transition(opened.screen, restore({ to: "person", person: null, tab: "assigned" }), data());
    expect(url(back.screen)).toBe("/my-issues");
    expect(back.history).toBe("none");
    expect(back.screen.mine).toBe(true);
  }
});

test("legacy mine links restore My issues independently of their board", () => {
  for (const board of [1, 2]) {
    const restored = transition(start, restore(legacy(`/?board=${board}&mine=1`)), data());
    expect(url(restored.screen)).toBe("/my-issues");
    expect(restored.screen.mine).toBe(true);
    expect(restored.history).toBe("none");
  }
});

test("BJ-28 / BJ-77: My issues tabs and a user's issues have their own addresses, and My issues starts on Assigned", () => {
  const go = (to: object, s = start) => transition(s, { type: "go", to }, data()).screen;
  const created = go({ mine: true, personTab: "created" });
  expect(url(created)).toBe("/my-issues/created");
  const alex = go({ mine: true, person: "alex", selected: null, panel: false }, created);
  expect(alex).toMatchObject({ person: "alex", personTab: "assigned" });
  expect(url(alex)).toBe("/profiles/alex");
  expect(url(go({ personTab: "activity" }, alex))).toBe("/profiles/alex/activity");
  expect(go({ mine: true }, alex)).toMatchObject({ person: null, personTab: "assigned" });
  const restored = transition(start, restore(legacy("/user/alex/subscribed")), data()).screen;
  expect(restored).toMatchObject({ mine: true, person: "alex", personTab: "subscribed" });
});

test("D7: every old address names the place it showed", () => {
  const cases: [string, Place | undefined][] = [
    ["/?board=2", { to: "board", board: 2, scope: "all" }],
    ["/?board=9", board1],
    ["/?board=1&issue=OLD-1", { ...board1, issue: "A-1" }],
    ["/?board=1&issue=A-1&view=side", { ...board1, issue: "A-1" }],
    ["/?board=2&issue=A-1&view=page", { to: "issue", key: "A-1", over: board1 }],
    ["/?board=1&issue=A-1&document=d1", { to: "issue", key: "A-1", document: "d1", over: board1 }],
    ["/?board=1&inbox=1", { to: "inbox" }],
    ["/?board=1&inbox=1&issue=A-1", { to: "inbox", issue: "A-1" }],
    ["/?board=1&mine=1", { to: "person", person: null, tab: "assigned" }],
    ["/my-issues/created?board=1&mine=1", { to: "person", person: null, tab: "created" }],
    ["/user/alex", { to: "person", person: "alex", tab: "assigned" }],
    ["/user/alex/activity?issue=A-1", { to: "person", person: "alex", tab: "activity", issue: "A-1" }],
    ["/view/v1?board=1", { to: "view", id: "v1" }],
    ["/view/old-name-v1?board=1&issue=A-1&view=page", { to: "issue", key: "A-1", over: { to: "view", id: "v1" } }],
    ["/view/triage-v1/edit?board=1", { to: "editor", id: "v1" }],
    ["/view/new?board=1&mine=1", { to: "editor" }],
    ["/board/1/all?issue=A-1", undefined],
    ["/view/triage-v1", undefined],
  ];
  for (const [href, place] of cases) expect([href, legacy(href)]).toEqual([href, place as Place]);
});

test("a favorite's origin follows the screen as Linear's favoriteId does: kept over its issues, dropped on leaving", () => {
  const fromIssue = run([{ type: "go", to: { board: 1, selected: "A-1", panel: true, favorite: "A-1" } }]);
  expect(fromIssue.screen).toMatchObject({ selected: "A-1", panel: true, favorite: "A-1" });
  // A sidebar row that is no favorite leaves the favorite's origin, even for the same board.
  expect(transition(fromIssue.screen, { type: "go", to: { board: 1, selected: null, panel: false, favorite: null } }, data()).screen.favorite).toBeNull();
  // Escape closing the issue drops it, so the board it shows lights again.
  expect(transition(fromIssue.screen, { type: "moved", screen: { panel: false } }, data()).screen.favorite).toBeNull();
  const fromBoard = run([{ type: "go", to: { board: 2, selected: null, panel: false, favorite: "board:2" } }]);
  const issueOver = transition(fromBoard.screen, { type: "go", to: { selected: "B-1", panel: true } }, data());
  expect(issueOver.screen.favorite).toBe("board:2");
  expect(transition(issueOver.screen, { type: "go", to: { scope: "active" } }, data()).screen.favorite).toBe("board:2");
  expect(transition(issueOver.screen, { type: "go", to: { board: 1 } }, data()).screen.favorite).toBeNull();
  expect(transition(issueOver.screen, { type: "go", to: { board: 2, selected: null, panel: false, favorite: null } }, data()).screen.favorite).toBeNull();
  // A saved view opened from its favorite keeps it; from the Views section, or by Back to an entry without it, none.
  expect(run([{ type: "open-view", view: view(), favorite: "view:v1" }]).screen.favorite).toBe("view:v1");
  expect(run([{ type: "open-view", view: view(), favorite: "view:v1" }, { type: "open-view", view: view() }]).screen.favorite).toBeNull();
  expect(run([{ type: "go", to: { favorite: "board:1" } }, restore(board1)]).screen.favorite).toBeNull();
  expect(run([{ type: "restore", place: board1, draft: null, favorite: "board:1" }]).screen.favorite).toBe("board:1");
});

test("an issue page's trail is kept by its steps and its history entry, and a reload starts afresh (Linear's breadcrumb stack)", () => {
  const d = data({ issue: (key) => ({ "A-1": { key: "A-1", board: 1 }, "A-2": { key: "A-2", board: 1 }, "A-3": { key: "A-3", board: 1 } })[key] });
  const epicPage = run([{ type: "go", to: { board: 1, selected: "A-1", panel: true, view: "page" } }], d);
  // Opened from the board, the page is over its list.
  expect(epicPage.screen.trail).toBe("list");
  // Opened from A-1's Sub-issues section, then from A-2's: the trail grows.
  const child = transition({ ...epicPage.screen, trail: null }, { type: "go", to: { selected: "A-2", panel: true, view: "page", trail: { parent: "A-1" } } }, d);
  expect(child.screen.trail).toEqual({ path: ["A-1"] });
  const grandchild = transition(child.screen, { type: "go", to: { selected: "A-3", panel: true, view: "page", trail: { parent: "A-2" } } }, d);
  expect(grandchild.screen.trail).toEqual({ path: ["A-1", "A-2"] });
  // ↑/↓ name the trail; a link opened unnamed, ⌘K (null) or a sidebar favorite reset it; closing the page drops it.
  expect(transition(child.screen, { type: "go", to: { selected: "A-3", trail: child.screen.trail } }, d).screen.trail).toEqual({ path: ["A-1"] });
  expect(transition(child.screen, { type: "go", to: { selected: "A-3", panel: true } }, d).screen.trail).toBeNull();
  expect(transition(child.screen, { type: "go", to: { selected: "A-3", panel: true, trail: null } }, d).screen.trail).toBeNull();
  expect(transition(child.screen, { type: "go", to: { selected: "A-3", panel: true, favorite: "A-3", trail: "list" } }, d).screen.trail).toBeNull();
  expect(transition(child.screen, { type: "moved", screen: { panel: false } }, d).screen.trail).toBeNull();
  // The history entry carries it; Back restores it, a reload (still loading) doesn't.
  const place = placeOf(grandchild.screen, () => "all");
  expect(place).toMatchObject({ to: "issue", key: "A-3", trail: { path: ["A-1", "A-2"] } });
  expect((locationOf(place, context) as { state?: { trail?: unknown } }).state?.trail).toEqual({ path: ["A-1", "A-2"] });
  const state = { trail: { path: ["A-1", "A-2"] } };
  expect(restoredTrail(state, false)).toEqual(state.trail);
  expect(restoredTrail(state, true)).toBeUndefined();
  const back = { type: "restore", place, draft: null, trail: restoredTrail(state, false) } as const;
  expect(run([back], d).screen.trail).toEqual({ path: ["A-1", "A-2"] });
  const reload = { type: "restore", place, draft: null, trail: restoredTrail(state, true) } as const;
  expect(run([reload], d).screen.trail).toBeNull();
});
