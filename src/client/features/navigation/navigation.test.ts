import { expect, test } from "bun:test";
import { createMemoryHistory } from "@tanstack/react-router";
import { inboxShown, placeOf, restoredTrail, transition, type NavigationData, type NavigationEvent, type Place, type Screen } from "./navigation";
import { emptyOverlay, encodeOverlay, viewForRoute, type SavedView, type ViewDraft } from "@/shared/saved-view-model";
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
  direct: false,
};
const data = (patch: Partial<NavigationData> = {}): NavigationData => ({
  savedViews: [view()],
  preferences: { 1: prefs("side"), 2: prefs("page") },
  defaults: {},
  boards: [{ id: 1 }, { id: 2 }],
  issue: (key) => ({ "A-1": { key: "A-1", boards: [1] }, "B-1": { key: "B-1", boards: [2] } })[key],
  currentKey: (key) => (key === "OLD-1" ? "A-1" : key),
  draftFor: (id) => ({ ...view(), id, name: id ? "Triage" : "" }),
  pageFilters: {},
  ...patch,
});
/** Runs events in order, each from the screen the last one left; `walk` also from the preferences and page filters it left. */
const run = (events: NavigationEvent[], d = data(), screen = start) =>
  events.reduce((t, e) => transition(t.screen, e, d), { screen, history: "none" } as ReturnType<typeof transition>);
const walk = (events: NavigationEvent[], d = data(), screen = start) =>
  events.reduce(
    ({ screen, d }, e) => {
      const t = transition(screen, e, d);
      return { screen: t.screen, d: { ...d, preferences: t.preferences ?? d.preferences, pageFilters: t.pageFilters ?? d.pageFilters } };
    },
    { screen, d },
  );
const context: RouteContext = {
  show: () => {},
  preload: async () => {},
  issue: (key) => data().issue(key),
  keep: async () => false,
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
  const page = transition(opened.screen, { type: "open-in", view: "page" }, data());
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
  expect(closed.preferences).toBeUndefined();
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
  const toggled = run([{ type: "go", to: { selected: "A-1", panel: true } }, { type: "open-in", view: "side" }], data(), opened.screen);
  expect(toggled.viewDisplay?.display.openIn).toBe("side");
  expect(toggled.preferences).toBeUndefined();
});

// The user's bug: a board set to open issues as a page went back to the side panel after the Inbox or a link opened an issue.
// Linear's "Open in split view" / "Open in full view" open once (ListCell `openInPanel`/`openPage`) and never write the view's
// `openInSplitView` preference (startup-root `opensInSplitView`).
const inboxOpen = (selected: string, board: number, view: "side" | "page" = "side") =>
  ({ type: "go", to: { board, selected, panel: true, view, inbox: true } }) as const;
const toInbox = { type: "go", to: { inbox: true, selected: null, panel: false } } as const;

test("opening an issue from the Inbox never changes how any board opens issues, and the board opens its own way after", () => {
  const d = data({ preferences: { 1: prefs("page"), 2: prefs("page") } });
  const pageBoard = { ...start, view: "page" } as Screen;
  // Click (side), Enter (page), then another row on another board: nothing is saved.
  const visit = walk([toInbox, inboxOpen("A-1", 1), inboxOpen("A-1", 1, "page"), { type: "go", to: { view: "side" } }, inboxOpen("B-1", 2)], d, pageBoard);
  expect(visit.d.preferences).toEqual(d.preferences);
  expect(visit.screen).toMatchObject({ inbox: true, selected: "B-1", view: "side", linkView: true });
  // Back on board 1 (the sidebar), its issues open as a page.
  const back = walk([{ type: "go", to: { board: 1, selected: null, panel: false } }], visit.d, visit.screen);
  expect(back.screen).toMatchObject({ inbox: false, board: 1, view: "page", linkView: false });
  expect(transition(back.screen, { type: "go", to: { selected: "A-1", panel: true } }, back.d).screen.view).toBe("page");
  expect(back.d.preferences).toEqual(d.preferences);
});

test("an Inbox issue on the same board as the list it leaves for still opens as that board does (side to side, page board)", () => {
  // Board 1 side, board 2 page: from board 1 to the Inbox, open a board-2 notification beside it, then go to board 2.
  const visit = walk([toInbox, inboxOpen("B-1", 2), { type: "go", to: { board: 2, selected: null, panel: false } }]);
  expect(visit.screen).toMatchObject({ board: 2, view: "page", linkView: false });
  expect(visit.d.preferences).toEqual(data().preferences);
});

test("the header's switch in the Inbox shows the issue that way there, and saves nothing", () => {
  const d = data({ preferences: { 1: prefs("page") } });
  const t = walk([toInbox, inboxOpen("A-1", 1), { type: "open-in", view: "page" }, { type: "open-in", view: "side" }], d, { ...start, view: "page" });
  expect(t.screen).toMatchObject({ inbox: true, view: "side" });
  expect(t.d.preferences).toEqual(d.preferences);
});

test("a link to an issue opens it as its board does, and saves nothing; a page link reverts once the issue closes", () => {
  const d = data({ preferences: { 1: prefs("side"), 2: prefs("page") } });
  // An issue link (issueAt: board, selected, panel) from board 1 to an issue on board 2.
  const linked = transition(start, { type: "go", to: { board: 2, selected: "B-1", panel: true } }, d);
  expect(linked.screen).toMatchObject({ board: 2, view: "page", linkView: false });
  expect(linked.preferences?.[2]?.display.openIn ?? "page").toBe("page");
  expect(linked.preferences?.[1]?.display.openIn ?? "side").toBe("side");
  // From the Inbox the link still opens as the issue's board does, not as the Inbox showed the last row.
  const inboxScreen = walk([toInbox, inboxOpen("A-1", 1)], d).screen;
  expect(transition(inboxScreen, { type: "go", to: { board: 2, selected: "B-1", panel: true } }, d).screen.view).toBe("page");
  // A `/issue/KEY` address and Enter's page on a side board: shown once, never saved.
  const pageLink = walk([restore({ to: "issue", key: "A-1", over: board1 }), { type: "moved", screen: { panel: false } }], d);
  expect(pageLink.screen).toMatchObject({ view: "side", linkView: false });
  const entered = walk([{ type: "go", to: { selected: "A-1", panel: true, view: "page" } }, { type: "moved", screen: { panel: false } }], d);
  expect(entered.screen).toMatchObject({ view: "side", linkView: false });
  expect([pageLink.d.preferences, entered.d.preferences]).toEqual([d.preferences, d.preferences]);
});

test("Back from a saved view to its board shows the board's own way, not the view's", () => {
  const opened = run([{ type: "open-view", view: view() }]);
  expect(opened.screen.view).toBe("page");
  const back = transition(opened.screen, restore(board1), data());
  expect(back.screen).toMatchObject({ activeViewId: null, view: "side", linkView: false });
  expect(back.preferences?.[1]?.display.openIn ?? "side").toBe("side");
});

test("only the switch saves: from a page link on a side board, choosing the page saves it to the board", () => {
  const linked = run([restore({ to: "issue", key: "A-1", over: board1 })]);
  const chosen = walk([{ type: "open-in", view: "side" }, { type: "open-in", view: "page" }], data(), linked.screen);
  expect(chosen.screen).toMatchObject({ view: "page", linkView: false });
  expect(chosen.d.preferences[1]!.display.openIn).toBe("page");
});

const labelFilter = (value: string) => ({
  id: `o-${value}`,
  join: "and" as const,
  children: [{ id: `r-${value}`, field: "labels" as const, op: "is" as const, values: [value] }],
});

test("another view or the board shows its own temporary filter, not the view's; going to a board picks how that board opens issues", () => {
  const filtered = walk([{ type: "open-view", view: view() }, { type: "filters", filters: labelFilter("x") }]);
  expect(url(filtered.screen)).toStartWith("/view/triage-v1?filter=");
  const other = transition(filtered.screen, { type: "open-view", view: view({ id: "v2", name: "Other" }) }, filtered.d);
  expect(other.screen.overlayFilters.children).toHaveLength(0);
  const left = transition(filtered.screen, { type: "go", to: { board: 1 } }, filtered.d);
  expect(left.screen).toMatchObject({ activeViewId: null, view: "side", overlayFilters: { children: [] } });
  expect(url(left.screen)).toBe("/board/1/all");
});

// Linear keys each page's filter by its address (startup-root `E9`, `filter_2_${identifier ?? pathname}`).
test("a temporary filter belongs to the board tab it was set on: Active's never shows on All issues, and comes back on Active", () => {
  const active = labelFilter("active");
  const set = walk([{ type: "go", to: { board: 1, scope: "active" } }, { type: "filters", filters: active }]);
  expect(set.screen.overlayFilters).toEqual(active);
  const all = walk([{ type: "go", to: { board: 1, scope: "all" } }], set.d, set.screen);
  expect(url(all.screen)).toBe("/board/1/all");
  expect(all.screen.overlayFilters.children).toHaveLength(0);
  expect(walk([{ type: "go", to: { board: 1, scope: "active" } }], all.d, all.screen).screen.overlayFilters).toEqual(active);
  // My issues and another person's profile are pages of their own too.
  const mine = walk([{ type: "go", to: { mine: true } }], set.d, set.screen);
  expect(mine.screen.overlayFilters.children).toHaveLength(0);
  const mineFiltered = walk([{ type: "filters", filters: labelFilter("mine") }, { type: "go", to: { mine: true, person: "u2" } }], mine.d, mine.screen);
  expect(mineFiltered.screen.overlayFilters.children).toHaveLength(0);
});

test("a saved view's temporary filter survives leaving it, coming back and a reload", () => {
  const filters = labelFilter("x");
  const t = walk([
    { type: "open-view", view: view() },
    { type: "filters", filters },
    { type: "go", to: { board: 1 } },
    { type: "open-view", view: view() },
  ]);
  expect(t.screen.overlayFilters).toEqual(filters);
  expect(url(t.screen)).toStartWith("/view/triage-v1?filter=");
  // A reload keeps the address, which names the filter; an address naming another sets that one, and Back to an entry
  // naming none (before the filter was set) shows none, so the screen always agrees with its address.
  expect(transition(start, { type: "restore", place: { to: "view", id: "v1", filter: encodeOverlay(filters) }, draft: null }, t.d).screen.overlayFilters.children).toEqual(filters.children);
  const bare = transition(start, { type: "restore", place: { to: "view", id: "v1" }, draft: null }, t.d);
  expect([bare.screen.overlayFilters.children, bare.pageFilters]).toEqual([[], {}]);
  const named = labelFilter("y");
  const linked = transition(start, { type: "restore", place: { to: "view", id: "v1", filter: encodeOverlay(named) }, draft: null }, t.d);
  expect(linked.screen.overlayFilters.children).toEqual(named.children);
  expect(linked.pageFilters?.["view/v1"]?.children).toEqual(named.children);
  // Clearing it removes the page's entry, as Linear removes the stored key.
  expect(transition(t.screen, { type: "filters", filters: emptyOverlay() }, t.d).pageFilters).toEqual({});
});

test("saving a filter as a view leaves the tab it came from with its filter, as Linear's Create view (SV) does", () => {
  const filters = labelFilter("x");
  const saved = view({ id: "v9", name: "Saved", filters });
  const t = walk([
    { type: "go", to: { board: 1 } },
    { type: "filters", filters },
    { type: "edit-view", draft: { ...saved, id: undefined } },
  ]);
  expect(t.screen.overlayFilters.children).toHaveLength(0);
  const d = { ...t.d, savedViews: [view(), saved] };
  // The new view holds the filter as its own, with no temporary filter on top.
  const opened = walk([{ type: "open-view", view: saved }], d, t.screen);
  expect(opened.screen.overlayFilters.children).toHaveLength(0);
  expect(walk([{ type: "go", to: { board: 1 } }], opened.d, opened.screen).screen.overlayFilters).toEqual(filters);
});

test("the view editor takes display changes into its draft, keeps the board's preference, and returns on cancel", () => {
  const draft: ViewDraft = { ...view(), id: undefined, sourceId: "v1", name: "" };
  const editing = run([{ type: "edit-view", draft }]);
  expect(editing.screen).toMatchObject({ editorDraft: { name: "" }, activeViewId: null, mine: true });
  expect(url(editing.screen)).toBe("/view/new");
  const toggled = run([{ type: "go", to: { selected: "A-1", panel: true } }, { type: "open-in", view: "side" }], data(), editing.screen);
  expect(toggled.screen.editorDraft?.display.openIn).toBe("side");
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
  const d = data({ issue: (key) => ({ "A-1": { key: "A-1", boards: [1] }, "A-2": { key: "A-2", boards: [1] }, "A-3": { key: "A-3", boards: [1] } })[key] });
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

test("an issue on two boards opens on the board its address names; one only on another board opens there; one on none stays", () => {
  const d = data({
    issue: (key) =>
      ({ "S-1": { key: "S-1", boards: [1, 2] }, "B-1": { key: "B-1", boards: [2] }, "L-1": { key: "L-1", boards: [] } })[key],
  });
  const at = (board: number, issue: string) => run([restore({ to: "board", board, scope: "all", issue })], d).screen;
  expect(at(2, "S-1")).toMatchObject({ board: 2, selected: "S-1", panel: true });
  expect(at(1, "S-1")).toMatchObject({ board: 1, selected: "S-1" });
  expect(at(1, "B-1")).toMatchObject({ board: 2, selected: "B-1" });
  // Linked from a board issue, on no board: it opens over the board the address names.
  expect(at(2, "L-1")).toMatchObject({ board: 2, selected: "L-1" });
});

test("item 5: the inbox's pane shows at its issue's address; its title opens the page over the inbox; neither saves Open issues in", () => {
  const d = data({ preferences: { 1: prefs("page"), 2: prefs("side") } });
  const scopeOf = () => "all" as const;
  // A reload or Back to the pane's entry (`issueOrigin: inbox`) restores the pane, not the page.
  const pane = walk([restore({ to: "inbox", issue: "A-1" })], d);
  expect(pane.screen).toMatchObject({ inbox: true, selected: "A-1", panel: true, view: "side", direct: false });
  expect(placeOf(pane.screen, scopeOf)).toEqual({ to: "inbox", issue: "A-1" });
  expect(inboxShown(pane.screen)).toBe(true);
  // J/K: the next notification's issue is the address.
  const next = walk([inboxOpen("B-1", 2)], pane.d, pane.screen);
  expect(placeOf(next.screen, scopeOf)).toEqual({ to: "inbox", issue: "B-1" });
  // The header's "KEY Title": the page, over the inbox, so Escape and a reload come back to it; the notification's controls go.
  const page = walk([{ type: "go", to: { view: "page" } }], next.d, next.screen);
  expect(placeOf(page.screen, scopeOf)).toEqual({ to: "issue", key: "B-1", over: { to: "inbox" }, trail: "list" });
  expect(inboxShown(page.screen)).toBe(false);
  expect(page.d.preferences).toEqual(d.preferences);
  const back = walk([{ type: "go", to: { view: "side" } }], page.d, page.screen);
  expect(placeOf(back.screen, scopeOf)).toEqual({ to: "inbox", issue: "B-1" });
  expect(back.d.preferences).toEqual(d.preferences);
  // Restoring the page's own entry (a reload) keeps it over the inbox.
  expect(walk([restore({ to: "issue", key: "B-1", over: { to: "inbox" } })], d).screen).toMatchObject({ inbox: true, view: "page", direct: false });
});

test("item 9: an issue page opened by its address alone is direct: its entry names no list, and only that page stays direct", () => {
  const scopeOf = () => "all" as const;
  const direct = walk([restore({ to: "issue", key: "A-1" })]);
  expect(direct.screen).toMatchObject({ selected: "A-1", panel: true, view: "page", direct: true });
  // No `over` in its entry, so a reload is still direct (show() would otherwise write the board under it).
  expect(placeOf(direct.screen, scopeOf)).toEqual({ to: "issue", key: "A-1" });
  // Its document opening and closing keep it; another issue, a list or a page over a list don't.
  const doc = walk([{ type: "go", to: { document: "d1" } }, { type: "go", to: { document: null } }], direct.d, direct.screen);
  expect(doc.screen.direct).toBe(true);
  expect(walk([{ type: "go", to: { selected: "B-1", panel: true, view: "page" } }], direct.d, direct.screen).screen.direct).toBe(false);
  expect(walk([{ type: "go", to: { board: 1, selected: null, panel: false } }], direct.d, direct.screen).screen.direct).toBe(false);
  expect(walk([restore({ to: "issue", key: "A-1", over: board1 })]).screen.direct).toBe(false);
});
