/**
 * Navigation glue: the running screen machine, the address bar and history, and the steps that move between screens.
 * navigation.ts decides what each step does (pure); this module applies it to the store, the ui machine and the address.
 */
import { createActor } from "xstate";
import { uiMachine, inspector, type UiContext } from "@/client/state/machines";
import { MACHINE_FIELDS, screenUrl, transition, type Destination, type NavigationEvent, type Screen } from "./navigation";
import { commit, get, set, subscribe, type State } from "@/client/state/store";
import { currentKey } from "@/client/state/jira-sync";
import { createViewDraft, editViewDraft, updateSavedView, viewError } from "@/client/features/views/saved-views";
import { emptyOverlay, type SavedView, type ViewDraft } from "@/shared/saved-view-model";
import type { FilterGroup } from "@/shared/view-model";
import { savedBoard, savedOpenIn, savedSidebarHidden } from "@/client/state/browser-preferences";
import { showNotification } from "@/client/state/app-notifications";
import { setScope } from "@/client/features/views/view-settings";

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
/** Goes somewhere: see navigation.ts for leaving views, how issues open and what the address shows. */
export function navigate(to: Destination) {
  go({ type: "go", to });
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
  viewsPage: s.viewsPage,
  activeViewId: s.activeViewId,
  overlayFilters: s.overlayFilters,
  editorDraft: s.editorDraft,
  linkView: s.linkView,
});
/** Applies one navigation step: the screen (state, then the ui machine), the preference it changed, then the address. */
function go(event: NavigationEvent) {
  const t = transition(screen(), event, {
    savedViews: get().savedViews,
    preferences: get().preferences,
    defaults: get().defaults,
    boards: get().boards,
    issue: (key) => get().issues.get(currentKey(key)),
    currentKey,
    draftFor: (id) => (id ? editViewDraft(id) : createViewDraft()),
  });
  if (t.forgetDraft) address.forgetDraft();
  if (t.path) address.replacePath(t.path);
  if (t.via && navigationReady) address.show(screenUrl(t.via, location.href, get().savedViews), false);
  const patch: Partial<State> = t.preferences ? { preferences: t.preferences } : {};
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
  if (t.missing) showNotification({ text: `Issue ${t.missing} not found` });
}
/** The address bar, history, and the view editor's draft kept per address (sessionStorage is per tab). */
const address = {
  draftKey: (path: string) => `view-editor:${get().namespace}:${path}`,
  show(href: string, replace: boolean) {
    if (href !== location.href) history[replace ? "replaceState" : "pushState"]({}, "", href);
  },
  replacePath(path: string) {
    const url = new URL(location.href);
    url.pathname = path;
    history.replaceState(history.state, "", url);
  },
  draft(): ViewDraft | null {
    try {
      return JSON.parse(sessionStorage.getItem(address.draftKey(location.pathname)) ?? "null");
    } catch {
      return null; // Start a fresh draft.
    }
  },
  keepDraft(href: string, draft: ViewDraft) {
    try {
      sessionStorage.setItem(address.draftKey(new URL(href).pathname), JSON.stringify(draft));
    } catch {
      /* Draft remains available until navigation. */
    }
  },
  forgetDraft() {
    try {
      sessionStorage.removeItem(address.draftKey(location.pathname));
    } catch {
      /* Best effort. */
    }
  },
};
function showAddress(replace = false) {
  const { savedViews, editorDraft } = get(),
    href = screenUrl(screen(), location.href, savedViews);
  if (editorDraft) address.keepDraft(href, editorDraft);
  address.show(href, replace);
}
const restoreNavigation = () => go({ type: "restore", href: location.href, draft: address.draft() });
/** Set once load has restored the address; before that nothing is written to history. */
let navigationReady = false;
/** Shows the screen the address names, then keeps the address and Back/Forward in step with the screen. Once. */
export function startNavigation() {
  if (navigationReady) return;
  restoreNavigation();
  navigationReady = true;
  showAddress(true);
  window.addEventListener("popstate", restoreNavigation);
  window.addEventListener("click", openIssueLink);
  // A rename (here or in another tab) moves the slug; the id suffix keeps the entry.
  let shown = get().savedViews;
  subscribe(() => {
    if (get().savedViews === shown) return;
    shown = get().savedViews;
    if (get().activeViewId) showAddress(true);
  });
}
/**
 * A link to an issue this app has, in rendered Jira content (a description before the editor loads, a comment),
 * opens it here, like Linear's document-wide `handleDocumentClick`. The editor handles its own links first.
 */
function openIssueLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(".rich-doc a[href]") : null,
    browse = `${get().site}/browse/`;
  if (!link || link.hasAttribute("download") || !link.href.startsWith(browse)) return;
  const issue = get().issues.get(currentKey(decodeURIComponent(link.href.slice(browse.length).split(/[?#/]/)[0]!)));
  if (!issue) return;
  event.preventDefault();
  navigate({ board: issue.board, selected: issue.key, panel: true, view: get().view });
}
/** The board's Issues › All. Leaves any view first, so its scope and details stay untouched. */
export function openAllIssues(board: number) {
  navigate({ board, selected: null, panel: false });
  ui.send({ type: "mine.set", mine: false });
  ui.send({ type: "query.set", query: "" });
  set({ details: false, findInView: false });
  setScope(board, "all");
}
export function setOverlay(filters: FilterGroup) {
  go({ type: "filters", filters });
}
export const clearOverlay = () => setOverlay(emptyOverlay());
export function openSavedView(view: SavedView | string) {
  const v = typeof view === "string" ? get().savedViews.find((v) => v.id === view) : view;
  if (!v) return;
  go({ type: "open-view", view: v });
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
