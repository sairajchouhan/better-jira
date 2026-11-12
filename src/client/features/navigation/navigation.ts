/**
 * Where you are, and every rule for moving: one pure transition from the current screen and an event to the next
 * screen and the preference it changes, and the place (what an address names) each screen shows. app-navigation.ts
 * applies the result to the store, the ui machine and the router; nothing here touches the browser, so tests run it directly.
 */
import { defaultPreferences, type Display, type FilterGroup, type Preferences, type Scope } from "@/shared/view-model";
import { decodeOverlay, emptyOverlay, encodeOverlay, type SavedView, type ViewDraft } from "@/shared/saved-view-model";
import type { View } from "@/client/state/store";
import type { PersonTab } from "@/shared/people";

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
  viewsPage: boolean;
  activeViewId: string | null;
  /** Filters added on top of the open saved view, until it is left or saved into. */
  overlayFilters: FilterGroup;
  editorDraft: ViewDraft | null;
  /** A link's or reload's `view` shows the open issue that way once: it reverts when the issue closes and never becomes a preference (R2-D4). */
  linkView: boolean;
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
  viewsPage?: boolean;
  /** The standalone My issues destination, not a board filter. */
  mine?: boolean;
  /** Another user's issues (with `mine`), or null for mine; a new person opens on Assigned. */
  person?: string | null;
  personTab?: PersonTab;
  /** The board's Issues tab (all, active or backlog), part of its address. */
  scope?: Scope;
};
export type NavigationEvent =
  /** Go somewhere: a new board leaves the open view or editor, and fills in how that board opens issues. */
  | { type: "go"; to: Destination }
  /** The ui machine moved on its own (Escape, My issues, editing a description). */
  | { type: "moved"; screen: Partial<Screen> }
  | { type: "open-view"; view: SavedView }
  | { type: "edit-view"; draft: ViewDraft }
  /** Cancel in the editor: back to the view it edits or duplicates, else its board. */
  | { type: "discard-editor" }
  | { type: "draft"; draft: ViewDraft }
  | { type: "filters"; filters: FilterGroup }
  /** Show what an address names: a reload, a link, Back or Forward. `draft` is the editor draft saved for that address. */
  | { type: "restore"; place: Place; draft: ViewDraft | null };
/** A list screen: what a board, view, My issues or the inbox shows, with the issue open beside it. */
export type ListPlace =
  | { to: "board"; board: number; scope: Scope; issue?: string }
  | { to: "views"; board: number }
  | { to: "view"; id: string; filter?: string; issue?: string }
  | { to: "editor"; id?: string; issue?: string }
  | { to: "person"; person: string | null; tab: PersonTab; issue?: string }
  | { to: "inbox"; issue?: string };
/** What an address names (routes/tree.tsx maps each to its path). An issue page keeps the list it opened over. */
export type Place = ListPlace | { to: "issue"; key: string; document?: string; over?: ListPlace };
export type NavigationData = {
  savedViews: SavedView[];
  preferences: Record<number, Preferences>;
  defaults: Record<number, Display>;
  boards: { id: number }[];
  /** The mirrored issue a key names, following Jira's renames. */
  issue: (key: string) => { key: string; board: number } | undefined;
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
    mine: to.mine ?? (to.board !== undefined || to.inbox || to.viewsPage ? false : s.mine),
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

/**
 * After the machine moved: a changed `view` is remembered by the open view, the editor draft or the board, unless a
 * link or restore chose it (`quiet`). A link's view reverts once its issue closes.
 */
function settle(prev: Screen, next: Screen, data: NavigationData, quiet: boolean, out: Transition) {
  let screen = next;
  if (next.view !== prev.view) {
    if (quiet) screen = { ...screen, linkView: true };
    else if (prev.activeViewId) {
      const v = data.savedViews.find((v) => v.id === prev.activeViewId);
      if (v && v.display.openIn !== next.view)
        out.viewDisplay = { id: v.id, display: { ...v.display, openIn: next.view } };
    } else if (prev.editorDraft)
      screen = {
        ...screen,
        editorDraft: { ...prev.editorDraft, display: { ...prev.editorDraft.display, openIn: next.view } },
      };
    else {
      screen = { ...screen, linkView: false };
      const preferenceBoard = isMyIssues(next) ? 0 : next.board;
      const prefs = data.preferences[preferenceBoard] ?? defaultPreferences();
      out.preferences = {
        ...data.preferences,
        [preferenceBoard]: { ...prefs, display: { ...prefs.display, openIn: next.view } },
      };
    }
  }
  out.screen = screen;
  if (!screen.linkView || screen.panel) return;
  out.screen = { ...screen, linkView: false };
  // Back to how the open view (or else the board) opens issues; never the board's choice written into a view.
  const saved = out.viewDisplay;
  const savedViews = saved
    ? data.savedViews.map((v) => (v.id === saved.id ? { ...v, display: saved.display } : v))
    : data.savedViews;
  const openIn =
    (screen.editorDraft ?? savedViews.find((v) => v.id === screen.activeViewId))?.display.openIn ??
    data.preferences[isMyIssues(screen) ? 0 : screen.board]?.display.openIn ??
    "side";
  if (openIn === screen.view) return;
  const after = go(out.screen, { view: openIn }, { ...data, savedViews });
  out.screen = after.screen;
  out.history = "push";
  if (after.preferences) out.preferences = after.preferences;
  if (after.viewDisplay) out.viewDisplay = after.viewDisplay;
}

/** `navigate`: leaving the open view or editor, the views page, renamed keys and a new board's issue view; `quiet` (a restore or a view being opened) skips the leaving. */
function enter(screen: Screen, to: Destination, data: NavigationData, quiet: boolean, out: Transition) {
  let s = screen;
  if (!quiet && s.activeViewId && (to.board !== undefined || to.inbox === true || to.mine === true)) {
    s = { ...s, activeViewId: null, overlayFilters: emptyOverlay() };
    to = { ...to, view: to.view ?? data.preferences[to.mine ? 0 : to.board ?? s.board]?.display.openIn ?? "side" };
  }
  if (!quiet && s.editorDraft && (to.board !== undefined || to.inbox || to.mine)) {
    s = { ...s, editorDraft: null };
  }
  if (!quiet)
    s = {
      ...s,
      viewsPage: to.viewsPage ?? (to.board !== undefined || to.inbox === true || to.mine === true ? false : s.viewsPage),
    };
  if (to.selected) to = { ...to, selected: data.currentKey(to.selected) };
  const view =
    to.view ??
    (to.mine === true ? data.preferences[0]?.display.openIn ?? "side" : undefined) ??
    (to.board !== undefined && (to.board !== s.board || isMyIssues(s))
      ? (data.preferences[to.board]?.display.openIn ?? data.defaults[to.board]?.openIn ?? "side")
      : undefined);
  settle(s, move(s, { ...to, ...(view ? { view } : {}) }), data, quiet, out);
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
  const out: Transition = { screen, history: "push" };
  switch (event.type) {
    case "go":
      return go(screen, event.to, data);
    case "moved":
      if (event.screen.mine === true && !screen.mine && !screen.activeViewId && !screen.editorDraft)
        return go(screen, { mine: true, selected: null, panel: false }, data);
      settle(screen, { ...screen, ...event.screen }, data, false, out);
      return out;
    case "draft":
      return { screen: { ...screen, editorDraft: event.draft }, history: "push" };
    case "filters":
      return { screen: { ...screen, overlayFilters: event.filters }, history: "push" };
    // One history entry, with the view's identity installed first so its own `openIn` is never written back.
    case "open-view": {
      const v = event.view;
      const s = { ...screen, editorDraft: null, activeViewId: v.id, viewsPage: false, overlayFilters: emptyOverlay() };
      // The view's own board and openIn, as given: no renamed-key or board-default lookups.
      settle(s, move(s, { board: v.board, selected: null, panel: false, inbox: false, view: v.display.openIn }), data, true, out);
      out.screen = { ...out.screen, mine: v.mine, inbox: false };
      out.forgetDraft = !!screen.editorDraft;
      return out;
    }
    case "edit-view": {
      const draft = structuredClone(event.draft);
      const s = { ...screen, editorDraft: draft, viewsPage: false, activeViewId: null, overlayFilters: emptyOverlay() };
      enter(s, { board: draft.board, selected: null, panel: false, inbox: false }, data, true, out);
      out.screen = { ...out.screen, mine: draft.mine, inbox: false };
      return out;
    }
    case "discard-editor": {
      const draft = screen.editorDraft;
      if (!draft) return { screen, history: "none" };
      const s = { ...screen, editorDraft: null };
      // Edit and duplicate return to the view they came from, while it still exists.
      const back = data.savedViews.find((v) => v.id === (draft.id ?? draft.sourceId));
      const result = back ? transition(s, { type: "open-view", view: back }, data) : go(s, { board: draft.board }, data);
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
  const board =
    editorDraft?.board ?? active?.board ?? issue?.board ?? (list?.to === "board" || list?.to === "views" ? list.board : undefined);
  const s: Screen = {
    ...screen,
    editorDraft,
    viewsPage: list?.to === "views",
    activeViewId: active?.id ?? null,
    overlayFilters: active && list?.to === "view" ? decodeOverlay(list.filter ?? null) : emptyOverlay(),
  };
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
  );
  const mine = editorDraft?.mine ?? active?.mine ?? !!person;
  if (!inbox) out.screen = { ...out.screen, mine, inbox: false };
  out.history = "none"; // A restore must never push, including settle reverting a link view.
  // The board's Issues tab is part of its address (Linear's /team/KEY/all|active|backlog).
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
  return page ? { to: "issue", key: open!, ...(s.document ? { document: s.document } : {}), over: list } : list;
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
  if (s.viewsPage) return { to: "views", board: s.board };
  if (s.inbox) return { to: "inbox", ...issue };
  if (s.mine) return { to: "person", person: s.person, tab: s.personTab, ...issue };
  return { to: "board", board: s.board, scope: scopeOf(s.board), ...issue };
}

/** Saved views may also filter by assignee; only this screen is the sidebar destination. */
export const isMyIssues = (s: Pick<Screen, "mine" | "inbox" | "activeViewId" | "editorDraft" | "viewsPage">) =>
  s.mine && !s.inbox && !s.activeViewId && !s.editorDraft && !s.viewsPage;
