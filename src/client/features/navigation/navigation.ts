/**
 * Where you are, and every rule for moving: one pure transition from the current screen and an event to the next
 * screen and the preference it changes, and the place (what an address names) each screen shows. app-navigation.ts
 * applies the result to the store, the ui machine and the router; nothing here touches the browser, so tests run it directly.
 */
import { defaultPreferences, type Display, type FilterGroup, type Preferences, type Scope } from "@/shared/view-model";
import { decodeOverlay, emptyOverlay, encodeOverlay, type SavedView, type ViewDraft } from "@/shared/saved-view-model";
import type { View } from "@/client/state/store";
import type { PersonTab } from "@/shared/people";
import { keptFavorite } from "./sidebar-active";
import { nextTrail, type Trail, type TrailStep } from "./issue-trail";
import { boardFor } from "@/shared/board-membership";
import { boardPage, personPage, viewPage, withPageFilter, type PageFilters } from "@/shared/page-filters";

export type Screen = {
  board: number;
  /** Open issues in a side panel or as a full page. */
  view: View;
  selected: string | null;
  /** The selected issue is open, beside the board or as a page. */
  panel: boolean;
  document: string | null;
  inbox: boolean;
  mine: boolean;
  /** On the personal page: whose issues (null is me, Linear's My issues; else Open user's profile) and which tab. */
  person: string | null;
  personTab: PersonTab;
  activeViewId: string | null;
  /** The temporary filter of the page on screen (`pageKey`), on top of a saved view's own filters: always
   *  `pageFilters[pageKey(screen)]`, which `transition` derives after every step. */
  overlayFilters: FilterGroup;
  editorDraft: ViewDraft | null;
  /** The open issue shows another way than this list opens issues (a link, a reload, the Inbox, Enter's page): it reverts when
   *  the issue closes and never becomes a preference (R2-D4). */
  linkView: boolean;
  /** The sidebar favorite this screen was opened from (Linear's `location.state.favoriteId`); see sidebar-active.ts. */
  favorite: string | null;
  /** How the open issue page was reached, for its breadcrumb and counter (issue-trail.ts); null off a page or when reached directly. */
  trail: Trail | null;
};
/** The fields the ui machine also holds, for Escape and the toolbar. */
export const MACHINE_FIELDS = ["board", "view", "selected", "panel", "document", "inbox", "mine"] as const;
export type Destination = {
  board?: number;
  view?: View;
  selected?: string | null;
  panel?: boolean;
  document?: string | null;
  inbox?: boolean;
  /** The standalone My issues destination, not a board filter. */
  mine?: boolean;
  /** Another user's issues (with `mine`), or null for mine; a new person opens on Assigned. */
  person?: string | null;
  personTab?: PersonTab;
  /** The board's Issues tab (all, active or backlog), part of its address. */
  scope?: Scope;
  /** Opened from this sidebar favorite, or (null) from a sidebar row that is none; omitted, the screen keeps the
   *  favorite while it still shows it. */
  favorite?: string | null;
  /** How an issue page opens: from a parent's Sub-issues section (`{ parent }`), with a given trail, or (null) afresh, as Linear's
   *  `resetBreadcrumb` link state. Omitted: issue-trail.ts `nextTrail` decides. */
  trail?: TrailStep;
};
export type NavigationEvent =
  /** Go somewhere: a new list leaves the open view or editor, and opens issues its own way. A destination's `view` shows its issue
   *  that way once and is never saved. */
  | { type: "go"; to: Destination }
  /** The user switched the open issue between the side panel and the full page: the open view, the editor draft or the board
   *  remembers it, as the Display menu's "Open issues in" does. Never saved from the Inbox, whose pane is no board's. */
  | { type: "open-in"; view: View }
  /** The ui machine moved on its own (Escape, My issues, editing a description). */
  | { type: "moved"; screen: Partial<Screen> }
  | { type: "open-view"; view: SavedView; favorite?: string }
  | { type: "edit-view"; draft: ViewDraft }
  /** Cancel in the editor: back to the view it edits or duplicates, else its board. */
  | { type: "discard-editor" }
  | { type: "draft"; draft: ViewDraft }
  /** The page on screen's temporary filter changed. */
  | { type: "filters"; filters: FilterGroup }
  /** Show what an address names: a reload, a link, Back or Forward. `draft` is the editor draft saved for that address; `trail`
   *  the issue page's, kept only on Back and Forward (`restoredTrail`). */
  | { type: "restore"; place: Place; draft: ViewDraft | null; favorite?: string; trail?: Trail };
/** A list screen: what a board, view, My issues or the inbox shows, with the issue open beside it. */
export type ListPlace =
  | { to: "board"; board: number; scope: Scope; issue?: string }
  | { to: "view"; id: string; filter?: string; issue?: string }
  | { to: "editor"; id?: string; issue?: string }
  | { to: "person"; person: string | null; tab: PersonTab; issue?: string }
  | { to: "inbox"; issue?: string };
/** What an address names (routes/tree.tsx maps each to its path). An issue page keeps the list it opened over, and how it was
 *  reached (its history entry's state, never its path). */
export type Place = ListPlace | { to: "issue"; key: string; document?: string; over?: ListPlace; trail?: Trail };
export type NavigationData = {
  savedViews: SavedView[];
  preferences: Record<number, Preferences>;
  /** Each page's temporary filter, by `pageKey`. */
  pageFilters: PageFilters;
  defaults: Record<number, Display>;
  boards: { id: number }[];
  /** The mirrored issue a key names, following Jira's renames. */
  issue: (key: string) => { key: string; boards: number[] } | undefined;
  currentKey: (key: string) => string;
  /** A fresh editor draft: editing that view, or a new one. */
  draftFor: (viewId?: string) => ViewDraft;
};
export type Transition = {
  screen: Screen;
  /** "push" a new history entry when the address changes; "none" when history already shows it. */
  history: "push" | "none";
  /** The board preferences, with how a board opens issues changed. */
  preferences?: Record<number, Preferences>;
  /** Every page's temporary filter, with one changed (by a filter edit, or a view address that names its filter). */
  pageFilters?: PageFilters;
  /** The open saved view's display, with how it opens issues changed; saved to the server. */
  viewDisplay?: { id: string; display: Display };
  /** Forget the editor draft saved for the address being left. */
  forgetDraft?: boolean;
};

/** The ui machine's part: where you are, and which document of the open issue shows. */
function move(s: Screen, to: Destination): Screen {
  const changed = to.board !== undefined && to.board !== s.board;
  const selected = to.selected !== undefined ? to.selected : s.selected,
    panel = to.panel ?? s.panel;
  return {
    ...s,
    ...(changed ? { board: to.board } : {}),
    mine: to.mine ?? (to.board !== undefined || to.inbox ? false : s.mine),
    person: to.person !== undefined ? to.person : to.mine ? null : s.person,
    personTab: to.personTab ?? (to.mine || to.person !== undefined ? "assigned" : s.personTab),
    ...(to.view ? { view: to.view } : {}),
    inbox: to.inbox ?? (to.board !== undefined || to.mine ? false : s.inbox),
    selected,
    panel,
    document:
      !panel || !selected
        ? null
        : to.document !== undefined
          ? to.document
          : changed || (to.selected !== undefined && to.selected !== s.selected)
            ? null
            : s.document,
  };
}

/** How a list opens issues: the editor's draft, else the open saved view, else the board (My issues' own key 0), else its default.
 *  The Inbox opens them as the board of its open issue does. */
function openInOf(s: Screen, data: NavigationData): View {
  const own = (s.editorDraft ?? data.savedViews.find((v) => v.id === s.activeViewId))?.display.openIn;
  if (own) return own;
  const board = isMyIssues(s) ? 0 : s.board;
  return data.preferences[board]?.display.openIn ?? data.defaults[board]?.openIn ?? "side";
}
/** The list a screen shows, as far as how it opens issues goes. */
const listKey = (s: Screen) =>
  s.editorDraft
    ? `editor:${s.editorDraft.id ?? ""}`
    : s.activeViewId
      ? `view:${s.activeViewId}`
      : s.inbox
        ? "inbox"
        : s.mine
          ? "mine"
          : `board:${s.board}`;

/**
 * After the machine moved. Only the user's own switch (`explicit`, the `open-in` event) is remembered, by the open view, the editor
 * draft or the board. Any other view (a link, a restore, the Inbox, Enter's page) shows the open issue that way once, and reverts to
 * how the list opens issues when it closes, as Linear's "Open in split view" and "Open in full view" open once and leave the view's
 * `openInSplitView` preference alone (startup-root `openSubmenu`, `openInPanel`/`openPage`).
 */
function settle(prev: Screen, next: Screen, data: NavigationData, explicit: boolean, out: Transition) {
  let screen = next;
  if (explicit && !next.inbox) {
    screen = { ...screen, linkView: false };
    if (next.view !== prev.view) {
      if (prev.activeViewId) {
        const v = data.savedViews.find((v) => v.id === prev.activeViewId);
        if (v && v.display.openIn !== next.view)
          out.viewDisplay = { id: v.id, display: { ...v.display, openIn: next.view } };
      } else if (prev.editorDraft)
        screen = {
          ...screen,
          editorDraft: { ...prev.editorDraft, display: { ...prev.editorDraft.display, openIn: next.view } },
        };
      else {
        const preferenceBoard = isMyIssues(next) ? 0 : next.board;
        const prefs = data.preferences[preferenceBoard] ?? defaultPreferences();
        out.preferences = {
          ...data.preferences,
          [preferenceBoard]: { ...prefs, display: { ...prefs.display, openIn: next.view } },
        };
      }
    }
  } else screen = { ...screen, linkView: next.view !== openInOf(next, data) };
  out.screen = screen;
  if (!screen.linkView || screen.panel) return;
  // Closed: back to how the list opens issues.
  const after = go({ ...screen, linkView: false }, { view: openInOf(screen, data) }, data);
  out.screen = after.screen;
  out.history = "push";
}

/** `navigate`: leaving the open view or editor, renamed keys, and how the list it lands on opens issues; `quiet` (a restore or a view
 *  being opened) skips the leaving. `from` is the screen before any view or draft the step installed, to tell a new list. */
function enter(screen: Screen, to: Destination, data: NavigationData, quiet: boolean, out: Transition, from = screen) {
  let s = screen;
  if (!quiet && (to.board !== undefined || to.inbox === true || to.mine === true) && (s.activeViewId || s.editorDraft))
    s = { ...s, activeViewId: null, editorDraft: null };
  if (to.selected) to = { ...to, selected: data.currentKey(to.selected) };
  const next = move(s, to);
  // A new list opens issues its own way, unless the destination shows its issue another way once.
  settle(s, to.view || listKey(next) === listKey(from) ? next : { ...next, view: openInOf(next, data) }, data, false, out);
}

const go = (screen: Screen, to: Destination, data: NavigationData) => {
  const out: Transition = { screen, history: "push" };
  enter(screen, to, data, false, out);
  if (to.scope) {
    const prefs = out.preferences ?? data.preferences,
      key = isMyIssues(out.screen) ? 0 : out.screen.board,
      current = prefs[key] ?? defaultPreferences();
    if (current.scope !== to.scope) out.preferences = { ...prefs, [key]: { ...current, scope: to.scope } };
  }
  return out;
};

export function transition(screen: Screen, event: NavigationEvent, data: NavigationData): Transition {
  const out = step(screen, event, data);
  const next = { ...out.screen, favorite: favoriteAfter(screen, event, out.screen), trail: trailAfter(screen, event, out.screen) };
  // The one place the screen's temporary filter is set: the stored filter of the page it now shows.
  const preferences = out.preferences ?? data.preferences,
    key = pageKey(next, (board) => preferences[board]?.scope ?? "all");
  const overlayFilters = (key && (out.pageFilters ?? data.pageFilters)[key]) || NO_FILTER;
  return { ...out, screen: { ...next, overlayFilters } };
}

/** One empty filter for every page without one, so a step that keeps the screen on such pages changes no reference. */
const NO_FILTER = emptyOverlay();
/**
 * The page a temporary filter belongs to, keyed by the page's address as Linear keys it (shared/page-filters.ts). The view
 * editor and the inbox keep no temporary filter.
 */
export function pageKey(s: Screen, scopeOf: (board: number) => Scope): string | null {
  const list = listOf(s, scopeOf, undefined);
  switch (list.to) {
    case "board":
      return boardPage(list.board, list.scope);
    case "view":
      return viewPage(list.id);
    case "person":
      return personPage(list.person, list.tab);
    default:
      return null;
  }
}
/** The next issue page's trail (issue-trail.ts `nextTrail`): a restore brings its entry's, a sidebar favorite starts afresh (Linear's
 *  `favoriteId` resets the stack), any other step names one or leaves it to `nextTrail`. */
function trailAfter(prev: Screen, event: NavigationEvent, next: Screen): Trail | null {
  switch (event.type) {
    case "restore":
      return nextTrail(prev, next, event.trail ?? null);
    case "go":
      return nextTrail(prev, next, event.to.favorite ? null : event.to.trail);
    default:
      return nextTrail(prev, next);
  }
}
/**
 * The trail a history entry's issue page restores: none for an entry this page load hasn't shown (`fresh`: a reload or a pasted
 * link starts afresh, as Linear's breadcrumb store starts empty: its constructor finds no items for the location and calls
 * `resetItems`), its own on Back and Forward (`handleGoBackAndForward` reads the entry's saved items).
 */
export const restoredTrail = (state: { trail?: Trail }, fresh: boolean): Trail | undefined => (fresh ? undefined : state.trail);
/** The favorite the next screen comes from: the one a step names, else the one it still keeps (sidebar-active.ts). */
function favoriteAfter(prev: Screen, event: NavigationEvent, next: Screen): string | null {
  switch (event.type) {
    case "go":
      return event.to.favorite !== undefined ? event.to.favorite : keptFavorite(prev, next);
    case "open-view":
    case "restore":
      return event.favorite ?? null;
    case "edit-view":
    case "discard-editor":
      return null;
    default:
      return keptFavorite(prev, next);
  }
}
function step(screen: Screen, event: NavigationEvent, data: NavigationData): Transition {
  const out: Transition = { screen, history: "push" };
  switch (event.type) {
    case "go":
      return go(screen, event.to, data);
    case "open-in":
      settle(screen, { ...screen, view: event.view }, data, true, out);
      return out;
    case "moved":
      if (event.screen.mine === true && !screen.mine && !screen.activeViewId && !screen.editorDraft)
        return go(screen, { mine: true, selected: null, panel: false }, data);
      settle(screen, { ...screen, ...event.screen }, data, false, out);
      return out;
    case "draft":
      return { screen: { ...screen, editorDraft: event.draft }, history: "push" };
    case "filters": {
      const key = pageKey(screen, (board) => data.preferences[board]?.scope ?? "all");
      // A saved view's address names its filter, so the change is a history entry there; a board's address doesn't change.
      return key ? { screen, history: "push", pageFilters: withPageFilter(data.pageFilters, key, event.filters) } : { screen, history: "none" };
    }
    // One history entry, with the view's identity installed first so its own `openIn` is never written back.
    case "open-view": {
      const v = event.view;
      const s = { ...screen, editorDraft: null, activeViewId: v.id };
      // The view's own board and openIn, as given: no renamed-key or board-default lookups.
      settle(s, move(s, { board: v.board, selected: null, panel: false, inbox: false, view: v.display.openIn }), data, false, out);
      out.screen = { ...out.screen, mine: v.mine, inbox: false };
      out.forgetDraft = !!screen.editorDraft;
      return out;
    }
    case "edit-view": {
      const draft = structuredClone(event.draft);
      const s = { ...screen, editorDraft: draft, activeViewId: null };
      enter(s, { board: draft.board, selected: null, panel: false, inbox: false }, data, true, out, screen);
      out.screen = { ...out.screen, mine: draft.mine, inbox: false };
      return out;
    }
    case "discard-editor": {
      const draft = screen.editorDraft;
      if (!draft) return { screen, history: "none" };
      const s = { ...screen, editorDraft: null };
      // Edit and duplicate return to the view they came from, while it still exists.
      const back = data.savedViews.find((v) => v.id === (draft.id ?? draft.sourceId));
      const result = back ? step(s, { type: "open-view", view: back }, data) : go(s, { board: draft.board }, data);
      return { ...result, forgetDraft: true };
    }
    case "restore":
      return restore(screen, event.place, event.draft, data);
  }
}

function restore(screen: Screen, place: Place, saved: ViewDraft | null, data: NavigationData): Transition {
  const out: Transition = { screen, history: "none" };
  const list = place.to === "issue" ? place.over : place,
    key = place.to === "issue" ? place.key : list && "issue" in list ? list.issue : undefined,
    // A link to an issue's app key opens the issue Jira made for it, wherever it was created (sync check 7).
    issue = key ? data.issue(key) : undefined;
  const editorDraft = list?.to === "editor" ? (saved ?? data.draftFor(list.id)) : null;
  const active = list?.to === "view" ? data.savedViews.find((v) => v.id === list.id) : undefined;
  const listed = list?.to === "board" ? list.board : undefined;
  // An issue on several boards opens on the one the address names, else the one on screen, when it holds the issue.
  const board =
    editorDraft?.board ?? active?.board ?? (issue && issue.boards.length ? boardFor(issue, listed ?? screen.board) : listed);
  const s: Screen = { ...screen, editorDraft, activeViewId: active?.id ?? null };
  // A view's address names its temporary filter (`listOf` writes it there, each change a history entry), so the filter a
  // reload, link, Back or Forward shows is the address's, stored as the view's (Linear's `TW`: a filter read from the
  // address wins and is stored). Opening the view any other way shows its stored filter.
  if (active && list?.to === "view") {
    const key = viewPage(active.id),
      named = decodeOverlay(list.filter ?? null);
    if (named.children.length || data.pageFilters[key]) out.pageFilters = withPageFilter(data.pageFilters, key, named);
  }
  const person = list?.to === "person" ? list : undefined,
    inbox = list?.to === "inbox";
  enter(
    s,
    {
      ...(board !== undefined && data.boards.some((b) => b.id === board) ? { board } : {}),
      selected: issue?.key ?? null,
      panel: !!issue,
      document: issue && place.to === "issue" ? (place.document ?? null) : null,
      inbox,
      ...(person
        ? { mine: true, view: data.preferences[0]?.display.openIn ?? "side", person: person.person, personTab: person.tab }
        : {}),
      ...(active ? { view: active.display.openIn } : {}),
      ...(issue ? { view: place.to === "issue" ? "page" : "side" } : {}),
    },
    data,
    true,
    out,
    screen,
  );
  const mine = editorDraft?.mine ?? active?.mine ?? !!person;
  if (!inbox) out.screen = { ...out.screen, mine, inbox: false };
  out.history = "none"; // A restore must never push, including settle reverting a link view.
  // The board's Issues tab is part of its address (/board/<id>/all|active|backlog, as Linear's /team/KEY/…).
  if (list?.to === "board" && list.board === out.screen.board) {
    const prefs = out.preferences ?? data.preferences,
      current = prefs[list.board] ?? defaultPreferences();
    if (current.scope !== list.scope) out.preferences = { ...prefs, [list.board]: { ...current, scope: list.scope } };
  }
  return out;
}

/** The place a screen shows: an issue page over its list, or a list with the issue open beside it. */
export function placeOf(s: Screen, scopeOf: (board: number) => Scope): Place {
  const open = s.panel && s.selected ? s.selected : undefined,
    page = !!open && (s.view === "page" || !!s.document);
  const list = listOf(s, scopeOf, page ? undefined : open);
  return page
    ? { to: "issue", key: open!, ...(s.document ? { document: s.document } : {}), over: list, ...(s.trail ? { trail: s.trail } : {}) }
    : list;
}
function listOf(s: Screen, scopeOf: (board: number) => Scope, open: string | undefined): ListPlace {
  const issue = open ? { issue: open } : {};
  if (s.editorDraft) return { to: "editor", ...(s.editorDraft.id ? { id: s.editorDraft.id } : {}), ...issue };
  if (s.activeViewId)
    return {
      to: "view",
      id: s.activeViewId,
      ...(s.overlayFilters.children.length ? { filter: encodeOverlay(s.overlayFilters) } : {}),
      ...issue,
    };
  if (s.inbox) return { to: "inbox", ...issue };
  if (s.mine) return { to: "person", person: s.person, tab: s.personTab, ...issue };
  return { to: "board", board: s.board, scope: scopeOf(s.board), ...issue };
}

/** Saved views may also filter by assignee; only this screen is the sidebar destination. */
export const isMyIssues = (s: Pick<Screen, "mine" | "inbox" | "activeViewId" | "editorDraft">) =>
  s.mine && !s.inbox && !s.activeViewId && !s.editorDraft;
