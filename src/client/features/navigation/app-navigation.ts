/**
 * Navigation glue: the router (it owns the address bar, history and Back/Forward), the running screen machine, and
 * the steps that move between screens. navigation.ts decides what each step does (pure); this module applies it to the
 * store and the ui machine, then shows its place in the address. An address the router opens (a link, Back, Forward,
 * a reload) comes back through `show`, which restores the screen it names.
 */
import { createActor } from "xstate";
import { Debouncer } from "@tanstack/pacer";
import { createBrowserHistory, createMemoryHistory, redirect, type ParsedLocation } from "@tanstack/react-router";
import { uiMachine, inspector, type UiContext } from "@/client/state/machines";
import { MACHINE_FIELDS, placeOf, restoredTrail, transition, type Destination, type NavigationEvent, type Place, type Screen } from "./navigation";
import { commit, get, set, subscribe, type State, issueBoardId } from "@/client/state/store";
import { currentKey } from "@/client/state/jira-sync";
import { createViewDraft, editViewDraft, updateSavedView, viewError } from "@/client/features/views/saved-views";
import { emptyOverlay, viewForRoute, type SavedView, type ViewDraft } from "@/shared/saved-view-model";
import { defaultPreferences, type FilterGroup } from "@/shared/view-model";
import { onSidebarHiddenChange, savedBoard, savedOpenIn, savedSidebarHidden } from "@/client/state/browser-preferences";
import { keptIssue, loadFull } from "@/client/state/server-data";
import { smartLink } from "@/shared/smart-link";
import { createAppRouter, locationOf, preloadIssueScreens, routeURL } from "@/client/routes/tree";

type UiKey = keyof UiContext;

/** The screen machine (machines.ts). It mirrors its context onto the store, so components read it with useStore. It
 *  starts from the same saved preferences as the store's state. */
export const ui = createActor(uiMachine, {
  input: { board: savedBoard() || 0, view: savedOpenIn(), sidebarHidden: savedSidebarHidden() },
  inspect: inspector("ui"),
}).start();
ui.subscribe(({ context }) => {
  const patch: Partial<State> = {};
  for (const key of Object.keys(context) as UiKey[])
    if (context[key] !== get()[key]) Object.assign(patch, { [key]: context[key] });
  if (!Object.keys(patch).length) return;
  // Escape, My issues or editing a description moved the screen; navigation settles it and shows the address.
  const moved = MACHINE_FIELDS.filter((key) => key in patch);
  if (moved.length) go({ type: "moved", screen: Object.fromEntries(moved.map((key) => [key, patch[key]])) });
  for (const key of moved) delete patch[key];
  commit(patch);
});

// Hiding or showing the sidebar in one tab does the same in the others (R3-chrome-D6).
onSidebarHiddenChange((hidden) => {
  if (hidden !== ui.getSnapshot().context.sidebarHidden) ui.send({ type: "sidebar.toggle" });
});

const scopeOf = (board: number) => (get().preferences[board] ?? defaultPreferences()).scope;
const findView = (segment: string) => viewForRoute(get().savedViews, segment);
/** The router. Tests (no DOM) run it on a memory history. */
export const router = createAppRouter(typeof document === "undefined" ? createMemoryHistory() : createBrowserHistory(), {
  show,
  preload: (key) => Promise.all([loadFull(key), preloadIssueScreens()]),
  issue: (key) => get().issues.get(currentKey(key)),
  keep: async (key) => !!(await keptIssue(key)),
  // Wrapped: jira-sync can still be loading when this module runs (app-notifications imports both).
  currentKey: (key) => currentKey(key),
  view: findView,
  hasBoard: (board) => get().boards.some((b) => b.id === board),
  scope: scopeOf,
  lastBoard: () => get().board,
});
/** Where a destination is, as a link: its route, params, search and state, for `<Link>` and preloading. */
export function linkTo(to: Destination) {
  const t = transition(screen(), { type: "go", to }, data()),
    preferences = t.preferences ?? get().preferences;
  return withFavorite(
    locationOf(placeOf(t.screen, (board) => (preferences[board] ?? defaultPreferences()).scope), { view: findView }),
    t.screen.favorite,
  );
}
/** A destination's address, as a plain link's `href`. */
export const linkHref = (to: Destination) => router.buildLocation(linkTo(to) as never).href;
/** A route location carrying the favorite its screen was opened from in history state, as Linear's `favoriteId`. */
export function withFavorite<T extends object>(target: T, favorite: string | null | undefined): T {
  if (!favorite) return target;
  const state = (target as { state?: object }).state;
  return { ...target, state: { ...state, favorite } };
}
/** Loads a destination's route ahead of time (its issue's details and screen), as hovering its link would. */
export function preload(to: Destination) {
  void router.preloadRoute(linkTo(to) as never).catch(() => {});
}
// Linear's intent delay: a pointer resting on an issue for a moment loads it; one passing over doesn't.
const intent = new Debouncer(preload, { wait: 50 });
/** Preloads where an issue under the pointer opens, after the pointer rests on it; `null` when it leaves. */
export const preloadOnHover = (to: Destination | null) => (to ? intent.maybeExecute(to) : intent.cancel());

/** Goes somewhere: see navigation.ts for leaving views, how issues open and what the address shows. An issue the mirror doesn't
 *  hold yet (a linked issue, a parent on no board, a link in Jira content) goes by its address: the route keeps it first and then
 *  shows it, or says Jira has no such issue (tree.tsx `whenKept`), as Linear opens any issue's path in the app and loads what its
 *  sync didn't bring (BJ-354). */
export function navigate(to: Destination) {
  if (to.selected && !get().issues.has(currentKey(to.selected))) return void router.navigate(linkTo(to) as never);
  go({ type: "go", to });
}
/** Where an issue opens from a link to it: beside the list or as a page, as the screen opens issues, on the board that holds it
 *  (the one on screen for an issue no board holds). */
export const issueAt = (key: string, s: State = get()): Destination => ({
  board: issueBoardId(s.issues.get(currentKey(key)), s),
  selected: key,
  panel: true,
  view: s.view,
});
/** Opens an issue by its key here, whether or not the mirror holds it yet (`navigate`). */
export const openIssueByKey = (key: string) => navigate(issueAt(key));
/** The issue a link names when it is an issue's page on this Jira site (`/browse/KEY`, a board's `selectedIssue`). */
export function linkedIssueKey(href: string) {
  const link = smartLink(href);
  return link?.kind === "issue" && link.site === get().site ? link.key : undefined;
}
const screen = (s = get()): Screen => ({
  board: s.board,
  view: s.view,
  selected: s.selected,
  panel: s.panel,
  document: s.document,
  inbox: s.inbox,
  mine: s.mine,
  person: s.person,
  personTab: s.personTab,
  activeViewId: s.activeViewId,
  overlayFilters: s.overlayFilters,
  editorDraft: s.editorDraft,
  linkView: s.linkView,
  favorite: s.favorite,
  trail: s.trail,
});
const data = () => ({
  savedViews: get().savedViews,
  preferences: get().preferences,
  pageFilters: get().pageFilters,
  defaults: get().defaults,
  boards: get().boards,
  issue: (key: string) => get().issues.get(currentKey(key)),
  currentKey,
  draftFor: (id?: string) => (id ? editViewDraft(id) : createViewDraft()),
});
/** Applies one navigation step: the screen (state, then the ui machine), the preference it changed, then the address. */
function go(event: NavigationEvent) {
  const t = transition(screen(), event, data());
  if (t.forgetDraft) drafts.forget(router.latestLocation.pathname);
  const patch: Partial<State> = {
    ...(t.preferences ? { preferences: t.preferences } : {}),
    ...(t.pageFilters ? { pageFilters: t.pageFilters } : {}),
  };
  for (const key of Object.keys(t.screen) as (keyof Screen)[])
    if (t.screen[key] !== get()[key]) Object.assign(patch, { [key]: t.screen[key] });
  commit(patch);
  const machine = ui.getSnapshot().context,
    moved = MACHINE_FIELDS.filter((key) => machine[key] !== t.screen[key]);
  if (moved.length)
    ui.send({ type: "navigate", ...Object.fromEntries(moved.map((key) => [key, t.screen[key]])) });
  if (navigationReady && t.history === "push") showAddress();
  // After the push: its optimistic write re-shows the address in place.
  if (t.viewDisplay)
    void updateSavedView(t.viewDisplay.id, { display: t.viewDisplay.display }).catch(viewError);
}
/** The view editor's draft, kept per address in sessionStorage (per tab), so history and reload keep it. */
const drafts = {
  key: (path: string) => `view-editor:${get().namespace}:${path}`,
  read(path: string): ViewDraft | null {
    try {
      return JSON.parse(sessionStorage.getItem(drafts.key(path)) ?? "null");
    } catch {
      return null; // Start a fresh draft.
    }
  },
  keep(path: string, draft: ViewDraft) {
    try {
      sessionStorage.setItem(drafts.key(path), JSON.stringify(draft));
    } catch {
      /* Draft remains available until navigation. */
    }
  },
  forget(path: string) {
    try {
      sessionStorage.removeItem(drafts.key(path));
    } catch {
      /* Best effort. */
    }
  },
};
/** The screen's place and the address the router shows for it. */
function current() {
  const place = placeOf(screen(), scopeOf),
    named = withFavorite(locationOf(place, { view: findView }), screen().favorite),
    // The inbox keeps a selected row whose issue isn't mirrored in its address; the screen doesn't model it.
    note = place.to === "inbox" && !place.issue ? (router.latestLocation.search as { notification?: string }).notification : undefined;
  const target = note ? { ...named, search: { ...named.search, notification: note } } : named;
  const location = router.buildLocation(target as never);
  return { place, target, location };
}
/** Same address, opened from the same favorite and, on an issue page, the same list under it, reached the same way. */
const sameAddress = (a: ParsedLocation, b: ParsedLocation) =>
  a.pathname === b.pathname &&
  a.searchStr === b.searchStr &&
  a.state.favorite === b.state.favorite &&
  JSON.stringify(a.state.over) === JSON.stringify(b.state.over) &&
  JSON.stringify(a.state.trail) === JSON.stringify(b.state.trail);
/** Shows the screen's place in the address: a new history entry, or `replace` this one. */
function showAddress(replace = false) {
  const { target, location } = current(),
    shown = router.latestLocation;
  if (get().editorDraft) drafts.keep(location.pathname, get().editorDraft!);
  if (sameAddress(location, shown)) return;
  // The hash (a comment, an activity entry) stays while the address still shows the same issue and document.
  const sameIssue = issueOf(location) === issueOf(shown);
  void router.navigate({ ...(target as object), replace, ...(sameIssue ? { hash: true } : {}) } as never);
}
const issueOf = (l: ParsedLocation) =>
  /^\/issue\/([^/]+)(?:\/document\/([^/]+))?/.exec(l.pathname)?.slice(1).join("/") ??
  `${(l.search as { issue?: string }).issue}`;
/**
 * The router opened an address (a link, Back, Forward, a reload): show the place it names, with the editor draft kept
 * for it. Skipped when the screen already shows it (this app's own navigation) or a newer navigation took over.
 */
function show(place: Place, location: ParsedLocation) {
  if (location.href !== router.latestLocation.href) return;
  // oxlint-disable-next-line no-underscore-dangle -- TanStack History sets only `__TSR_key` on every entry (`key` is pushes only).
  const entry = location.state.__TSR_key,
    seen = !!entry && shownEntries.has(entry);
  if (entry) shownEntries.add(entry);
  if (navigationReady && sameAddress(current().location, location)) return;
  go({
    type: "restore",
    place,
    draft: drafts.read(location.pathname),
    favorite: location.state.favorite,
    // An entry this page load never showed (a reload, an entry from before it) starts its trail afresh.
    trail: restoredTrail(location.state, !seen),
  });
  // The address names the screen differently (an issue beside another board's list): show its own address, once.
  const { target, location: shown } = current();
  if (location.state.settled || sameAddress(shown, location)) return;
  // A comment or attachment anchor (a deep link, the page's own `#…` link) stays while the address names the same issue.
  const hash = issueOf(shown) === issueOf(location) ? location.hash : undefined;
  throw redirect({ ...(target as object), hash, replace: true, state: { ...(target as { state?: object }).state, settled: true } } as never);
}
/** The history entries (`__TSR_key`) this page load has shown, Back and Forward's own. A reload's entry isn't one: it was shown
 *  before the reload, so its trail is dropped, as Linear's breadcrumb store starts empty (`restoredTrail`). Checking that load
 *  hasn't finished can't say it: load starts navigation before the router shows the first address. */
const shownEntries = new Set<string>();
/** Set once load has restored the address; before that nothing is written to history. */
let navigationReady = false;
/** Keeps the address in step with the screen from now on. Once, after load (the router then shows the address). */
export function startNavigation() {
  if (navigationReady) return;
  navigationReady = true;
  window.addEventListener("click", openIssueLink);
  window.addEventListener("click", followHash);
  // The issue screens load with their route; fetch them once the board is idle so the first issue opens at once.
  const warm = () => void preloadIssueScreens();
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm);
  else setTimeout(warm, 1);
  // A rename (here or in another tab) moves the view's slug; the id suffix keeps the entry.
  let shown = get().savedViews;
  subscribe(() => {
    if (get().savedViews === shown) return;
    shown = get().savedViews;
    if (get().activeViewId && router.state.status === "idle") showAddress(true);
  });
}
/**
 * A link to an issue on this Jira site, in rendered Jira content (a description before the editor loads, a comment), opens it
 * here, held or not (BJ-354), like Linear's document-wide `handleDocumentClick` opening any app path in the app. The editor
 * handles its own links first.
 */
function openIssueLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(".rich-doc a[href]") : null;
  const key = link && !link.hasAttribute("download") ? linkedIssueKey(link.href) : undefined;
  if (!key) return;
  event.preventDefault();
  openIssueByKey(key);
}
/**
 * A link to a spot on this page (a comment's timestamp) moves the hash through the router, so the entry keeps the
 * list the page opened over; the browser's own fragment navigation would write an entry without it.
 */
function followHash(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href*='#']") : null;
  if (!link || link.target || link.origin !== location.origin || link.pathname !== location.pathname) return;
  if (link.search !== location.search || !link.hash || link.hash === location.hash) return;
  event.preventDefault();
  router.history.push(link.pathname + link.search + link.hash, router.state.location.state);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
/** Points the shown page's address at a spot on it (an issue's comment) in place, and lets the page follow it, as a
 *  click on a link to it does (`followHash`). */
export function showAnchor(anchor: string) {
  const shown = router.latestLocation;
  if (shown.hash === anchor) return;
  router.history.replace(`${shown.pathname}${shown.searchStr}#${anchor}`, shown.state);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
/** The board's Issues › All. Leaves any view first, so its scope and details stay untouched. */
export function openAllIssues(board: number) {
  navigate({ board, scope: "all", selected: null, panel: false });
  ui.send({ type: "mine.set", mine: false });
  ui.send({ type: "query.set", query: "" });
  set({ details: false, findInView: false });
}
/** Sets the temporary filter of the page on screen (navigation.ts `pageKey`). */
export function setOverlay(filters: FilterGroup) {
  go({ type: "filters", filters });
}
export const clearOverlay = () => setOverlay(emptyOverlay());
export function openSavedView(view: SavedView | string, favorite?: string) {
  const v = typeof view === "string" ? get().savedViews.find((v) => v.id === view) : view;
  if (!v) return;
  go({ type: "open-view", view: v, favorite });
  ui.send({ type: "toolbar.close" });
}

/** Editor routes keep a detached draft, including toolbar changes, across history and reload. */
export function beginViewEditor(draft: ViewDraft) {
  go({ type: "edit-view", draft });
}
export function setViewDraft(draft: ViewDraft) {
  go({ type: "draft", draft });
}
export function discardViewEditor() {
  go({ type: "discard-editor" });
  // Back on the view it edits or duplicates, as opening that view does.
  if (get().activeViewId) ui.send({ type: "toolbar.close" });
}

/** A shareable route address, independent of the browser's last committed history entry. */
export function placeURL(place: Place) {
  return routeURL(router, locationOf(place, { view: findView }), location.origin);
}
/** The screen's address, optionally pointing to one activity entry. */
export function pageURL(hash = router.latestLocation.hash) {
  return routeURL(router, current().target, location.origin, hash);
}
