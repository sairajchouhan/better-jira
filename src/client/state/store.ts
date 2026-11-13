import type { User, Issue, Board, Full, IssueDraft, JiraOptions } from "@/shared/issue-model";
import { assignableUsers, knownPeople, statusById } from "@/shared/board-catalog";
import { useMemo, useSyncExternalStore } from "react";
import { defaultPreferences, type Display, type Preferences } from "@/shared/view-model";
import { type UiContext } from "./machines";
import type { Screen } from "@/client/features/navigation/navigation";


import type { PersonTab } from "@/shared/people";
import {
  persistPreferences,
  rememberViewDetails,
  savedBoard,
  savedFavorites,
  savedOpenIn,
  savedSidebarHidden,
  savedViewPreferences,
  viewDetailsOpen,
} from "./browser-preferences";
export type Overlay =
  | null
  | "palette"
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
  | "subscribers"
  | "reminder"
  | "inbox-actions"
  | "inbox-filter"
  | "inbox-display"
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
  overlayFilters: import("@/shared/view-model").FilterGroup;
  viewPreferences: Preferences | null;
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
  overlayFilters: emptyOverlay(),
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
  canEdit: true,
  storage: { status: "loading" },
};

const listeners = new Set<() => void>();
export const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const get = () => state;
type UiKey = keyof UiContext;
/** Data changes. Screen state changes only through `navigate` and the view functions (navigation.ts), or `ui.send` (machines.ts). */
export function set(
  patch: Partial<Omit<State, UiKey | keyof Screen | "loadError" | "storage" | "canEdit">>,
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
  if (patch.savedViews || patch.activeViewId !== undefined || patch.overlayFilters || patch.editorDraft !== undefined) {
    const v = state.savedViews.find((v) => v.id === state.activeViewId);
    state.viewPreferences = state.editorDraft
      ? { ...defaultPreferences(), ...state.editorDraft }
      : v
      ? {
          ...defaultPreferences(),
          scope: v.scope,
          display: v.display,
          hidden: v.hidden,
          collapsed: v.collapsed,
          filters: state.overlayFilters,
        }
      : null;
    state.effectiveViewPreferences =
      state.editorDraft ? state.viewPreferences : v && state.viewPreferences
        ? {
            ...state.viewPreferences,
            filters: mergeFilters(v.filters, state.overlayFilters),
          }
        : null;
  }
  const refused = persistPreferences(patch);
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
/** The assignee choices every picker offers, Assign and Create alike. */
export function useAssignableUsers(): User[] {
  const issues = useStore((s) => s.issues);
  const jiraUsers = useStore((s) => s.options.users);
  return useMemo(() => assignableUsers(ME, jiraUsers, issues.values()), [issues, jiraUsers]);
}

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
export const boardOf = (key: string) =>
  state.boards.find((b) => b.id === state.issues.get(key)?.board);
/** The issue's status on its own board. */
export const statusOf = (i: Issue) => statusById(boardOf(i.key), i.status);
