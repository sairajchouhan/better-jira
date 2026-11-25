import type { User, Issue, Board, Full, IssueDraft, JiraOptions } from "@/shared/issue-model";
import { issueStatus, knownPeople } from "@/shared/board-catalog";
import { boardFor } from "@/shared/board-membership";
import { useMemo, useSyncExternalStore } from "react";
import { defaultPreferences, type Display, type Preferences } from "@/shared/view-model";
import { type UiContext } from "./machines";
import type { Screen } from "@/client/features/navigation/navigation";
import type { Trail } from "@/client/features/navigation/issue-trail";


import type { PersonTab } from "@/shared/people";
import {
  persistPreferences,
  rememberViewDetails,
  savedBoard,
  savedFavorites,
  savedOpenIn,
  savedSidebarHidden,
  savedPageFilters,
  savedViewPreferences,
  viewDetailsOpen,
} from "./browser-preferences";
import type { PageFilters } from "@/shared/page-filters";
export type Overlay =
  | null
  | "palette"
  | "grouping"
  | "ordering"
  | "assign"
  | "status"
  | "create"
  | "priority"
  | "type"
  | "labels"
  | "project"
  | "milestone"
  | "due"
  | "options"
  | "relations"
  | "shortcuts"
  | "help"
  | "search"
  | "favorites"
  | "views"
  | "boards"
  | "issues"
  | "documents"
  | "users"
  | "add-board"
  | "customize-sidebar"
  | "preferences"
  | "subscribers"
  | "reminder"
  | "inbox-actions"
  | "inbox-filter"
  | "inbox-display"
  | "inbox-push"
  | "snooze";
export type View = "side" | "page";
export type { SavedView } from "@/shared/saved-view-model";
import {
  type SavedView,
  type ViewDraft,
  emptyOverlay,
  mergeFilters,
} from "@/shared/saved-view-model";

export const ME: User = { id: "", name: "Me" };

export type SetupPrompt = {
  site: string;
  email: string;
  hasToken: boolean;
  boards: number[];
  writes: boolean;
  tokenPage: string;
};

export type State = {
  boards: Board[];
  issues: Map<string, Issue>;
  full: Map<string, Full>;
  board: number;
  selected: string | null;
  columnSelection: ReadonlySet<string>;
  panel: boolean;
  document: string | null;
  /** Open issues in a side panel or as a full page. */
  view: View;
  mine: boolean;
  person: string | null;
  personTab: PersonTab;
  inbox: boolean;
  query: string;
  overlay: Overlay;
  perf: string;
  preferences: Record<number, Preferences>;
  defaults: Record<number, Display>;
  toolbar: "display" | "filter" | "add-filter" | "advanced" | null;
  propertySync: {
    total: number;
    pending: number;
    completed: number;
    errors: number;
  };
  clock: number;
  details: boolean;
  issuePropertiesHidden: boolean;
  findInView: boolean;
  sidebarHidden: boolean;
  /** Below 768px the sidebar is hidden; Menu or [ opens it over the page. */
  sidebarOpen: boolean;
  /** A wider window's hidden sidebar shows over the page while the pointer is on the header's Menu button or on it. */
  sidebarPeek: boolean;
  /** Where a right-click on a card or list row opened Issue options; null opens it under its button. */
  issueOptionsPoint: { x: number; y: number } | null;
  relation: string;
  /** The sub-issue row an issue shortcut opened the open menu for; null means the selected issue. */
  target: string | null;
  /** The issue waiting for the in-app delete confirmation. */
  deleting: string | null;
  draft: IssueDraft;
  undoCount: number;
  redoCount: number;
  fullErrors: Map<string, string>;
  savedViews: SavedView[];
  editorDraft: ViewDraft | null;
  activeViewId: string | null;
  /** A link's `view` shows the open issue that way once; see navigation.ts. */
  linkView: boolean;
  /** The sidebar favorite the screen was opened from; see navigation.ts. */
  favorite: string | null;
  /** How the open issue page was reached (navigation/issue-trail.ts). */
  trail: Trail | null;
  /** The open issue page was opened by its address alone; see navigation.ts. */
  direct: boolean;
  overlayFilters: import("@/shared/view-model").FilterGroup;
  /** Each page's temporary filter (shared/page-filters.ts); `overlayFilters` is the one on screen. */
  pageFilters: PageFilters;
  /** The page on screen's settings, its temporary filter included: the open view's or editor's, else its board's (or My
   *  issues'). Derived in `commit`; view-settings.ts and view-model.ts `boardView` both read it. */
  viewPreferences: Preferences | null;
  /** `viewPreferences` with a saved view's own filters added. */
  effectiveViewPreferences: Preferences | null;
  favorites: string[];
  site: string;
  namespace: string;
  /** The server writes edits to this Jira site; otherwise edits stay local. */
  writable: boolean;
  pendingWrites: number;
  /** The last write Jira refused, shown until dismissed or a later write to that issue lands. */
  /** `retrying`: the write is kept and sent again; shown even while writes are pending. */
  writeError: { key: string; text: string; retrying?: boolean } | null;
  /** Jira's own choices for property menus, when writes go to Jira. */
  options: JiraOptions;
  loadError: string;
  /** The load is waiting on the first sync, not failing: the boot screen shows progress, not an error. */
  loadWaiting: boolean;
  /** Non-null when the server booted unconfigured and needs the browser setup wizard first. */
  needsSetup: SetupPrompt | null;
  /** The footer's warning when the server or Jira can't be reached (sync-problem.ts); "" when all is well. */
  syncProblem: string;
  /** The footer's note while a board shown after its first page is still streaming in (sync-problem.ts `firstSyncNote`). */
  firstSync: string;
  /** Per-board initial background sync progress, so the board header can show Linear's hourglass loader while history streams. */
  syncingBoards: Record<number, { loaded: number; total: number }>;
  canEdit: boolean;
  storage: {
    status: "loading" | "saving" | "saved" | "error";
    message?: string;
    recovered?: boolean;
  };
};

let state: State = {
  boards: [],
  issues: new Map(),
  full: new Map(),
  board: savedBoard() || 0,
  selected: null,
  columnSelection: new Set(),
  panel: false,
  document: null,
  view: savedOpenIn(),
  mine: false,
  person: null,
  personTab: "assigned",
  inbox: false,
  query: "",
  overlay: null,
  perf: "",
  preferences: savedViewPreferences(),
  defaults: {},
  toolbar: null,
  propertySync: { total: 0, pending: 0, completed: 0, errors: 0 },
  clock: Date.now(),
  details: false,
  issuePropertiesHidden: false,
  findInView: false,
  sidebarHidden: savedSidebarHidden(),
  sidebarOpen: false,
  sidebarPeek: false,
  issueOptionsPoint: null,
  relation: "related",
  target: null,
  deleting: null,
  draft: {},
  undoCount: 0,
  redoCount: 0,
  fullErrors: new Map(),
  savedViews: [],
  editorDraft: null,
  activeViewId: null,
  linkView: false,
  favorite: null,
  trail: null,
  direct: false,
  overlayFilters: emptyOverlay(),
  pageFilters: savedPageFilters(),
  viewPreferences: null,
  effectiveViewPreferences: null,
  favorites: savedFavorites(),
  site: "",
  namespace: "",
  writable: false,
  pendingWrites: 0,
  writeError: null,
  options: { priorities: [], users: [], labels: [], versions: {} },
  loadError: "",
  loadWaiting: false,
  needsSetup: null,
  syncProblem: "",
  firstSync: "",
  syncingBoards: {},
  canEdit: true,
  storage: { status: "loading" },
};

const listeners = new Set<() => void>();
export const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const get = () => state;
type UiKey = keyof UiContext;
/** Data changes. Screen state changes only through `navigate` and the view functions (navigation.ts), or `ui.send` (machines.ts). */
export function set(
  patch: Partial<Omit<State, UiKey | keyof Screen | "loadError" | "loadWaiting" | "storage" | "canEdit">>,
) {
  commit(patch);
}
/** Counts footer messages, so `timed` never covers one its action posted. */
let perfPosts = 0;
/** Details open on boards and tab views; a custom view keeps its own, as Linear does. */
let boardDetails = false;
const customViewId = () =>
  state.savedViews.find((v) => v.id === (state.editorDraft?.id ?? state.activeViewId) && v.kind === "custom")?.id;
/** Any change, screen state included: for the machines' mirrors and navigation (app-navigation.ts) only. */
export function commit(patch: Partial<State>) {
  if (patch.perf !== undefined) perfPosts++;
  const was = customViewId(),
    wasDetails = state.details;
  state = { ...state, ...patch };
  const now = customViewId();
  if (was !== now) {
    if (!was) boardDetails = wasDetails;
    state.details = now ? viewDetailsOpen(now) : boardDetails;
  } else if (now && patch.details !== undefined && patch.details !== wasDetails)
    rememberViewDetails(now, patch.details);
  if (
    patch.savedViews ||
    patch.activeViewId !== undefined ||
    patch.overlayFilters ||
    patch.editorDraft !== undefined ||
    patch.preferences ||
    patch.board !== undefined ||
    patch.mine !== undefined ||
    patch.inbox !== undefined
  ) {
    const v = state.savedViews.find((v) => v.id === state.activeViewId);
    // A plain board's or My issues' settings are its preferences with the page's temporary filter.
    const board = state.preferences[state.mine && !state.inbox && !state.activeViewId && !state.editorDraft ? 0 : state.board];
    state.viewPreferences = state.editorDraft
      ? { ...defaultPreferences(), ...state.editorDraft }
      : v
      ? {
          ...defaultPreferences(),
          scope: v.scope,
          display: v.display,
          hidden: v.hidden,
          collapsed: v.collapsed,
          order: v.order,
          filters: state.overlayFilters,
        }
      : board
      ? { ...board, filters: state.overlayFilters }
      : null;
    state.effectiveViewPreferences =
      v && !state.editorDraft && state.viewPreferences
        ? { ...state.viewPreferences, filters: mergeFilters(v.filters, state.overlayFilters) }
        : state.viewPreferences;
  }
  // A one-off view (a link, the Inbox, Enter's page) is not how issues open: it must not seed a new board's "Open issues in" on load.
  const refused = persistPreferences(state.linkView && patch.view ? { ...patch, view: undefined } : patch);
  if (refused) {
    perfPosts++;
    state = { ...state, perf: refused };
  }
  listeners.forEach((l) => l());
}
/** Selector must return a stable reference (a state field or a Map entry), never a fresh object. */
export const useStore = <T>(sel: (s: State) => T) => {
  const read = () => sel(state);
  // The same snapshot for a static render, so a component reading the store renders in a unit test too.
  return useSyncExternalStore(subscribe, read, read);
};
/** All known people; unlike assignable users this includes creators and watchers. */
export function usePeople(extra?: readonly User[]): User[] {
  const issues = useStore((s) => s.issues);
  const jiraUsers = useStore((s) => s.options.users);
  return useMemo(() => knownPeople(ME, jiraUsers, issues.values(), extra), [issues, jiraUsers, extra]);
}

/** Time from the action to the next painted frame, shown in the header. */
export function timed(label: string, fn: () => void) {
  const t0 = performance.now(),
    posts = perfPosts;
  fn();
  // The action posted its own message, such as why it was refused; keep it.
  if (perfPosts !== posts) return;
  requestAnimationFrame(() =>
    setTimeout(() => set({ perf: `${label} · ${(performance.now() - t0).toFixed(1)}ms` })),
  );
}

export const isWatching = (issue: Issue) =>
  issue.watchers ? issue.watchers.some((u) => u.id === ME.id) : !!issue.watching;
/** The board an issue opens on and reads its statuses from: the one on screen when it holds the issue, else its first
 *  (board-membership.ts `boardFor`). Pass the selected state inside a `useStore` selector. */
export const issueBoardId = (issue: Pick<Issue, "boards"> | undefined, s: Pick<State, "board"> = state) =>
  boardFor(issue, s.board);
/** That board's configuration. */
export const issueBoard = (issue: Pick<Issue, "boards"> | undefined, s: Pick<State, "board" | "boards"> = state) =>
  s.boards.find((b) => b.id === issueBoardId(issue, s));
/** `issueBoard` for a mirrored issue. */
export const boardOf = (key: string) => {
  const issue = state.issues.get(key);
  return issue && issueBoard(issue);
};
/** The issue's status on its own board; one no configured board holds reads it from a board that knows it (`statusBoard`). */
export const statusOf = (i: Issue) => issueStatus(state.boards, i, boardOf(i.key));
