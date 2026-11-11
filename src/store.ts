import { useSyncExternalStore } from "react";
import { adfToText } from "./adf";
import {
  defaultPreferences,
  parsePreferences,
  type Display,
  type Grouping,
  type Preferences,
} from "./view-model";
import { documentHasMedia, normalizeDocument, textToAdf, type AdfDocument } from "./document";
import {
  emptyLocalState,
  LocalDatabase,
  type LocalState,
  type Snapshot,
  type LocalEdit,
  type LocalChange,
} from "./local-data";
import { createActor, fromPromise, waitFor } from "xstate";
import { appMachine, inspector, storageMachine, uiMachine, type UiContext } from "./machines";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { asyncRetry } from "@tanstack/pacer";

import { reminderTime } from "./reminder-display";
import { typeChoices } from "./issue-properties";
import { replyParent, visibleCommentTotal, type CommentState } from "./comment-thread";
import { jiraCommentId, type ImageCrop, type MediaEdit } from "./media-edits";

import {
  resourceMediaIds,
  type DocumentProperties,
  type IssueResource,
  type LinkPreview,
} from "./issue-resource";
import {
  RELATION_ISSUE,
  recordActivity,
  recordRelation,
  rollbackActivity,
  type PropertyActivity,
} from "./issue-activity";
import {
  prepareOps,
  uploadedAttachments,
  aliasAttachments,
  settleUploads,
  uploadNow,
  withoutLocalMedia,
} from "./jira-media";
import {
  JIRA_ISSUE_FIELDS,
  mergeOps,
  opsFor,
  renameCommentIds,
  renameIds,
  type Op,
  type Side,
} from "./jira-ops";
export type User = { id: string; name: string; avatar?: string };
export type Issue = {
  key: string;
  board: number;
  summary: string;
  status: string;
  type?: string;
  priority?: string;
  assignee: User | null;
  labels: string[];
  parent?: string;
  rank?: string;
  comments: number;
  updated: string;
  resolved: string | null;
  created?: string;
  creator?: User | null;
  due?: string | null;
  project?: { key: string; name: string } | null;
  description?: string;
  links?: string[];
  resources?: IssueResource[];
  commentStates?: Record<string, CommentState>;
  reminder?: { at: string; delivered?: boolean } | null;
  activity?: PropertyActivity[];
  relations?: { key: string; kind: string }[];
  milestones?: { id: string; name: string }[];
  prCount?: number;
  statusSince?: string;
  started?: string;
  watchers?: User[];
  watchersComplete?: boolean;
  /** Whether this Jira user watches the issue, from the mirror list; `watchers` wins once loaded (R2-issue-fields-D9). */
  watching?: boolean;
  estimate?: number;
  projectLead?: User | null;
  attachments?: {
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
    missing?: boolean;
    mediaId?: string;
  }[];
  reactions?: string[];
  mediaEdits?: Record<string, MediaEdit>;
  descriptionHistory?: { text: string; document?: AdfDocument; at: string }[];
};
export type Status = { id: string; name: string; category: string };
export type Column = { name: string; statuses: Status[] };
export type Board = { id: number; name: string; columns: Column[] };
/** Raw Jira issue: { key, fields: { description, comment, reporter, created, ... } } */
export type Full = {
  key: string;
  fields: any;
  /** Jira remote links, read with the full record. */ remotelinks?: {
    url: string;
    title: string;
  }[];
  /** Jira's description the unsent local one started from, kept so a replay after reload can still refuse to overwrite a newer Jira text (R2-D2). */
  descriptionBase?: AdfDocument;
  /** A description Jira refused (someone else's newer text, or invalid content), with Jira's reason; kept until the person picks a version or edits again. */
  descriptionRejected?: AdfDocument;
  descriptionError?: string;
};
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
  | "add-board"
  | "subscribers"
  | "reminder"
  | "inbox-actions"
  | "inbox-filter"
  | "inbox-display"
  | "snooze";
export type IssueDraft = Partial<
  Pick<
    Issue,
    | "status"
    | "assignee"
    | "priority"
    | "labels"
    | "project"
    | "milestones"
    | "due"
    | "parent"
    | "type"
    | "rank"
    | "attachments"
  >
> & {
  description?: string;
  descriptionDoc?: AdfDocument;
  /** Make a copy: the composer starts with this title and saves with "Save copy". */
  title?: string;
  copy?: boolean;
  /** Linear "Create related": link the new issue to this one in the same undo step. */ related?: {
    key: string;
    kind: "related" | "blocked" | "blocking" | "parent";
  };
  /** Names one submit of a composer: a second call with it (a double click before React re-renders) creates nothing. */
  submission?: string;
};
export type View = "side" | "page";
export type JiraOptions = {
  priorities: { id: string; name: string }[];
  users: User[];
  labels: string[];
  versions: Record<string, { id: string; name: string }[]>;
  types?: Record<string, { name: string; hierarchyLevel: number }[]>;
};
export type { SavedView } from "./saved-view-model";
import {
  type SavedView,
  type ViewDraft,
  migrateLegacyViews,
  emptyOverlay,
  mergeFilters,
  encodeOverlay,
  decodeOverlay,
} from "./saved-view-model";

export const ME: User = { id: "", name: "Me" };

type State = {
  boards: Board[];
  issues: Map<string, Issue>;
  full: Map<string, Full>;
  board: number;
  selected: string | null;
  panel: boolean;
  document: string | null;
  /** Open issues in a side panel or as a full page. */
  view: View;
  mine: boolean;
  inbox: boolean;
  viewsPage: boolean;
  query: string;
  overlay: Overlay;
  editDesc: boolean;
  perf: string;
  /** A transient confirmation, e.g. after creating an issue. */
  toast: {
    text: string;
    key?: string;
    undo?: boolean | "inbox";
    detail?: string;
  } | null;
  preferences: Record<number, Preferences>;
  defaults: Record<number, Display>;
  toolbar: "display" | "filter" | "advanced" | null;
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
  relationKind: string;
  issueOptionsStart: "link" | "pull-request" | "history" | "reminder" | "due" | null;
  /** Where a right-click on a card or list row opened Issue options; null opens it under its button. */
  issueOptionsPoint: { x: number; y: number } | null;
  createExpanded: boolean;
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
  overlayFilters: import("./view-model").FilterGroup;
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

const PREF_KEY = "better-jira:views:v1";
const SIDEBAR_KEY = "better-jira:sidebar";
let preferenceNamespace = "";
const preferenceKey = (key: string) =>
  preferenceNamespace ? `${key}:${preferenceNamespace}` : key;
function savedValue(key: string): string | null {
  try {
    return localStorage.getItem(preferenceKey(key));
  } catch {
    return null;
  }
}
function readPreferences(): Record<number, Preferences> {
  try {
    const saved = JSON.parse(savedValue(PREF_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(saved).map(([id, p]) => [id, parsePreferences(p)]));
  } catch {
    return {};
  }
}

let state: State = {
  boards: [],
  issues: new Map(),
  full: new Map(),
  board: Number(savedValue("board")) || 0,
  selected: null,
  panel: false,
  document: null,
  view: savedValue("view") === "page" ? "page" : "side",
  mine: false,
  inbox: false,
  viewsPage: false,
  query: "",
  overlay: null,
  editDesc: false,
  perf: "",
  toast: null,
  preferences: readPreferences(),
  defaults: {},
  toolbar: null,
  propertySync: { total: 0, pending: 0, completed: 0, errors: 0 },
  clock: Date.now(),
  details: false,
  issuePropertiesHidden: false,
  findInView: false,
  sidebarHidden: savedValue(SIDEBAR_KEY) === "hidden", // the namespace is still empty here
  sidebarOpen: false,
  relationKind: "related",
  issueOptionsStart: null,
  issueOptionsPoint: null,
  createExpanded: false,
  target: null,
  deleting: null,
  draft: {},
  undoCount: 0,
  redoCount: 0,
  fullErrors: new Map(),
  savedViews: [],
  editorDraft: null,
  activeViewId: null,
  overlayFilters: emptyOverlay(),
  viewPreferences: null,
  effectiveViewPreferences: null,
  favorites: readFavorites(),
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
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const get = () => state;
type UiKey = keyof UiContext;
/** Data changes. Screen state (board, issue, overlay, toolbar…) changes only through `ui.send`; see machines.ts. */
export function set(patch: Partial<Omit<State, UiKey | "loadError" | "storage" | "canEdit">>) {
  commit(patch);
}
/** Counts footer messages, so `timed` never covers one its action posted. */
let perfPosts = 0;
function commit(patch: Partial<State>) {
  if (patch.perf !== undefined) perfPosts++;
  state = { ...state, ...patch };
  if (patch.savedViews || patch.activeViewId !== undefined || patch.overlayFilters || patch.editorDraft !== undefined) {
    const v = state.savedViews.find((v) => v.id === state.activeViewId);
    state.viewPreferences = state.editorDraft
      ? { ...defaultPreferences(), ...state.editorDraft }
      : v
      ? {
          ...defaultPreferences(),
          scope: v.scope,
          display: v.display,
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
  try {
    if (patch.board) localStorage.setItem(preferenceKey("board"), String(patch.board));
    if (patch.view) localStorage.setItem(preferenceKey("view"), patch.view);
    // Not per site: it is read before the site is known, so the first paint has the right layout.
    if (patch.sidebarHidden !== undefined)
      localStorage.setItem(SIDEBAR_KEY, patch.sidebarHidden ? "hidden" : "shown");
  } catch {
    /* Preference failure is separate from durable issue storage. */
  }
  if (patch.preferences) {
    try {
      localStorage.setItem(preferenceKey(PREF_KEY), JSON.stringify(patch.preferences));
    } catch {
      perfPosts++;
      state = { ...state, perf: "Could not save view preferences in this browser" };
    }
  }
  if (patch.favorites)
    try {
      localStorage.setItem(
        preferenceKey("better-jira:favorites:v1"),
        JSON.stringify(patch.favorites),
      );
    } catch {
      perfPosts++;
      state = { ...state, perf: "Could not save favorites in this browser" };
    }
  if (
    navigationReady &&
    !restoringNavigation &&
    (patch.editorDraft !== undefined ||
      patch.activeViewId !== undefined ||
      patch.overlayFilters !== undefined ||
      patch.board !== undefined ||
      patch.selected !== undefined ||
      patch.panel !== undefined ||
      patch.view !== undefined ||
      patch.inbox !== undefined ||
      patch.mine !== undefined ||
      patch.document !== undefined)
  )
    syncNavigation();
  listeners.forEach((l) => l());
}
/** Selector must return a stable reference (a state field or a Map entry), never a fresh object. */
export const useStore = <T>(sel: (s: State) => T) =>
  useSyncExternalStore(subscribe, () => sel(state));

// The running machines. Each mirrors its state onto `state` so components read it with useStore.
export const ui = createActor(uiMachine, {
  input: { board: state.board, view: state.view, sidebarHidden: state.sidebarHidden },
  inspect: inspector("ui"),
}).start();
ui.subscribe(({ context }) => {
  const patch: Partial<State> = {};
  for (const key of Object.keys(context) as UiKey[])
    if (context[key] !== state[key]) Object.assign(patch, { [key]: context[key] });
  if (!Object.keys(patch).length) return;
  if (patch.overlay === null) Object.assign(patch, { target: null, issueOptionsPoint: null });
  // A link's `view` opens that issue once; it lasts until the panel closes and never becomes the board's preference (R2-D4).
  if (patch.view && restoringNavigation) linkView = true;
  else if (patch.view && state.activeViewId) {
    const v = state.savedViews.find((v) => v.id === state.activeViewId);
    if (v && v.display.openIn !== patch.view)
      void updateSavedView(v.id, {
        display: { ...v.display, openIn: patch.view },
      }).catch(viewError);
  } else if (patch.view && state.editorDraft) {
    patch.editorDraft = { ...state.editorDraft, display: { ...state.editorDraft.display, openIn: patch.view } };
  } else if (patch.view) {
    linkView = false;
    // Each board remembers how its issues open.
    const id = context.board,
      prefs = state.preferences[id] ?? defaultPreferences();
    patch.preferences = {
      ...state.preferences,
      [id]: { ...prefs, display: { ...prefs.display, openIn: patch.view } },
    };
  }
  commit(patch);
  if (linkView && !context.panel) {
    linkView = false;
    const openIn = state.preferences[context.board]?.display.openIn ?? "side";
    if (openIn !== context.view) queueMicrotask(() => navigate({ view: openIn }));
  }
});
/** Sends `navigate`, filling in a new board's remembered issue view. */
export function navigate(to: {
  board?: number;
  view?: View;
  selected?: string | null;
  panel?: boolean;
  document?: string | null;
  inbox?: boolean;
  viewsPage?: boolean;
}) {
  if (
    !restoringNavigation &&
    state.activeViewId &&
    (to.board !== undefined || to.inbox === true)
  ) {
    restoringNavigation = true;
    commit({ activeViewId: null, overlayFilters: emptyOverlay() });
    restoringNavigation = false;
    to = {
      ...to,
      view: to.view ?? state.preferences[to.board ?? state.board]?.display.openIn ?? "side",
    };
  }
  if (!restoringNavigation && state.editorDraft && (to.board !== undefined || to.inbox))
    commit({ editorDraft: null });
  if (!restoringNavigation) commit({ viewsPage: to.viewsPage ?? (to.board !== undefined || to.inbox === true ? false : state.viewsPage) });
  if (to.selected) to = { ...to, selected: currentKey(to.selected) };
  const view =
    to.view ??
    (to.board !== undefined && to.board !== state.board
      ? (state.preferences[to.board]?.display.openIn ?? state.defaults[to.board]?.openIn ?? "side")
      : undefined);
  ui.send({ type: "navigate", ...to, ...(view ? { view } : {}) });
  if (navigationReady && !restoringNavigation) syncNavigation();
}
const app = createActor(appMachine.provide({ actors: { load: fromPromise(loadApplication) } }), {
  inspect: inspector("app"),
}).start();
app.subscribe(({ context }) => {
  if (context.error !== state.loadError) commit({ loadError: context.error });
});
const storage = createActor(
  storageMachine.provide({
    actors: {
      save: fromPromise(async () => {
        localSeq = Math.max(localSeq, await database!.save(localSnapshot()));
        learnKeys(database!.moved);
      }),
    },
  }),
  { inspect: inspector("storage") },
).start();
storage.subscribe((s) => {
  const status =
    s.matches("failed") || s.matches("blocked")
      ? "error"
      : (s.value as "loading" | "saving" | "saved");
  commit({
    canEdit: !s.matches("blocked"),
    storage: {
      status,
      ...(s.context.message ? { message: s.context.message } : {}),
      ...(s.context.recovered ? { recovered: true } : {}),
    },
  });
});
/** Server data goes through TanStack Query: it dedupes loads in flight, schedules the poll and refetches on focus. Invalidate a key to refetch it. */
export const queryClient = new QueryClient({
  // "always": a read made offline fails at once instead of pausing and running unseen when the network returns (sync check 6).
  defaultOptions: { queries: { retry: false, staleTime: 0, networkMode: "always" } },
});
/** Next property poll: soon while Jira is still syncing, every 30 s once settled, 10 s after a failure. */
export const pollDelay = (failed: boolean, pending = 0) =>
  failed ? 10000 : pending ? 3000 : 30000;
const poll = new QueryObserver(queryClient, {
  queryKey: ["properties"],
  queryFn: fetchProperties,
  refetchInterval: (q) => pollDelay(q.state.status === "error", q.state.data?.pending),
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: true,
});
let polling: (() => void) | undefined;
function startPoll() {
  if (polling) void poll.refetch();
  else {
    queryClient.mount();
    polling = poll.subscribe(() => {});
    listen();
    subscribe(listen);
    document.addEventListener("visibilitychange", listen);
  }
}
/** The server pushes "changed" when Jira did, so the poll runs at once; the timer is only a backstop. A visible tab stays connected, naming its open issue,
 * which the server then checks every few seconds; a hidden tab disconnects, letting the server poll Jira slowly. */
let events: EventSource | undefined, eventsFor: string | undefined;
function listen() {
  const wanted = document.visibilityState === "visible" ? (state.selected ?? "") : undefined;
  if (wanted === eventsFor) return;
  events?.close();
  events = undefined;
  eventsFor = wanted;
  if (wanted === undefined) return;
  events = new EventSource(`/api/events${wanted ? `?issue=${encodeURIComponent(wanted)}` : ""}`);
  // "inbox": Jira's bell count moved; anything else is a mirror change.
  events.onmessage = (e) =>
    void (e.data === "inbox"
      ? queryClient.invalidateQueries({ queryKey: ["inbox"] })
      : e.data === "boards"
        ? refreshBoards().catch(() => {})
        : poll.refetch());
}
/** Boards added on the server since load, by this tab or another: the list, the new boards' issues, and their default view. */
async function refreshBoards() {
  const [boards, remote] = await Promise.all([
    json<Board[]>("/api/boards"),
    json<Issue[]>("/api/issues"),
  ]);
  const known = new Set(state.boards.map((b) => b.id)),
    issues = new Map(state.issues),
    preferences = { ...state.preferences };
  for (const issue of remote)
    if (!known.has(issue.board) && !issues.has(issue.key)) issues.set(issue.key, issue);
  for (const b of boards)
    preferences[b.id] ??= {
      ...defaultPreferences(),
      display: parsePreferences({ display: state.defaults[b.id] }).display,
    };
  set({ boards, issues, preferences });
}
/** Adds a Jira board by link or ID; the server checks it with Jira and mirrors it. Throws Jira's refusal in words. */
export async function addBoard(input: string): Promise<{ id: number; message: string }> {
  const response = await fetch("/api/boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ board: input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Could not add the board. Retry in a moment.");
  await refreshBoards();
  return body;
}
/** A JSON endpoint as a query; `staleTime` lets a recent answer stand in for a new request. */
const fetchJson = <T>(path: string, staleTime = 0) =>
  queryClient.fetchQuery<T>({ queryKey: [path], queryFn: () => json<T>(path), staleTime });
if (typeof window !== "undefined")
  Object.assign(window, { machines: { ui, app, storage }, queryClient, loadFull });

const fallbackPreferences = defaultPreferences();
export const preferencesFor = (board: number) =>
  (board === state.board ? state.viewPreferences : null) ??
  state.preferences[board] ??
  fallbackPreferences;
export const usePreferences = (board: number) =>
  useStore(
    (s) =>
      (board === s.board ? s.viewPreferences : null) ??
      s.preferences[board] ??
      fallbackPreferences,
  );
export const effectivePreferencesFor = (board: number) =>
  (board === state.board ? state.effectiveViewPreferences : null) ?? preferencesFor(board);
export const useEffectivePreferences = (board: number) =>
  useStore(
    (s) =>
      (board === s.board ? s.effectiveViewPreferences : null) ??
      s.preferences[board] ??
      fallbackPreferences,
  );
export function changePreferences(board: number, patch: Partial<Preferences>) {
  if (state.editorDraft && board === state.board) {
    commit({ editorDraft: { ...state.editorDraft, ...patch } });
    return;
  }
  if (state.activeViewId && board === state.board) {
    if (patch.filters) commit({ overlayFilters: patch.filters });
    const { display, scope } = patch;
    if (display || scope)
      void updateSavedView(state.activeViewId, {
        ...(display ? { display } : {}),
        ...(scope ? { scope } : {}),
      }).catch(viewError);
    return;
  }
  const prefs = { ...preferencesFor(board), ...patch };
  set({ preferences: { ...state.preferences, [board]: prefs } });
  if (board === state.board) navigate({ view: prefs.display.openIn });
}
export function changeDisplay(board: number, patch: Partial<Display>) {
  const display = { ...preferencesFor(board).display, ...patch };
  if (display.layout === "board" && display.columns === "none") display.columns = "status";
  if (display.rows === display.columns) display.rows = "none";
  changePreferences(board, { display });
}
export async function saveDefault(board: number) {
  if (state.activeViewId) return;
  const display = preferencesFor(board).display;
  try {
    const defaults = { ...state.defaults, [board]: structuredClone(display) };
    localStorage.setItem(preferenceKey("better-jira:defaults:v1"), JSON.stringify(defaults));
    set({ defaults, perf: "Saved your default in this browser" });
  } catch {
    set({ perf: "Could not save your default in this browser" });
  }
}

const settled = (s: ReturnType<typeof app.getSnapshot>) =>
  s.matches("ready") || s.matches("failed");
export async function load() {
  app.send({ type: "load" });
  await waitFor(app, settled);
}
async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}
function migratePreferences(namespace: string) {
  preferenceNamespace = namespace;
  try {
    const owner = localStorage.getItem("better-jira:preferences-owner");
    if (!owner) localStorage.setItem("better-jira:preferences-owner", namespace);
    if (!owner || owner === namespace)
      for (const key of [
        PREF_KEY,
        "board",
        "view",
        "better-jira:saved-views:v1",
        "better-jira:favorites:v1",
        "better-jira:defaults:v1",
      ]) {
        const old = localStorage.getItem(key);
        if (old !== null && localStorage.getItem(preferenceKey(key)) === null)
          localStorage.setItem(preferenceKey(key), old);
      }
  } catch {
    /* The mirror can still load if browser preferences are unavailable. */
  }
}
async function loadApplication() {
  const client = await fetchJson<{
    site: string;
    user: User;
    writable?: boolean;
  }>("/api/client");
  if (!client.site || !client.user?.id || !client.user.name)
    throw new Error("Jira account setup is incomplete");
  Object.assign(ME, client.user);
  const namespace = `${client.site}/${client.user.id}`;
  migratePreferences(namespace);
  const [boards, remote] = await Promise.all([
    fetchJson<Board[]>("/api/boards"),
    fetchJson<Issue[]>("/api/issues"),
  ]);
  if (!boards.length)
    throw new Error("The Jira mirror is still syncing your boards. Retry in a moment.");
  let local = emptyLocalState(),
    opened:
      | { type: "opened"; message?: string; recovered?: boolean }
      | { type: "blocked"; message: string };
  try {
    database?.close();
    database = await LocalDatabase.open(namespace);
    const result = await database.load();
    local = result.state;
    opened = result.readOnly
      ? {
          type: "blocked",
          message:
            "Saved data uses an unsupported version. Local editing is paused; existing data has been preserved.",
        }
      : {
          type: "opened",
          recovered: result.recovered || result.missingFiles > 0,
          message: result.recovered
            ? "Some local records needed recovery. A copy of the original data was kept."
            : result.missingFiles
              ? "Some saved files could not be restored."
              : undefined,
        };
  } catch {
    opened = {
      type: "blocked",
      message:
        "Could not read saved local data. Local editing is paused. Retry local storage; existing data has not been deleted.",
    };
  }
  const defaults: Record<number, Display> = (() => {
    try {
      const saved = JSON.parse(savedValue("better-jira:defaults:v1") ?? "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved)
        ? Object.fromEntries(
            Object.entries(saved).map(([id, display]) => [
              id,
              parsePreferences({ display }).display,
            ]),
          )
        : {};
    } catch {
      return {};
    }
  })();
  const preferences = readPreferences();
  for (const b of boards)
    if (!preferences[b.id]) {
      const display = parsePreferences({ display: defaults[b.id] }).display;
      if (!defaults[b.id]) display.openIn = savedValue("view") === "page" ? "page" : "side";
      preferences[b.id] = { ...defaultPreferences(), display };
    }
  const savedBoard = Number(savedValue("board"));
  const board = boards.some((b) => b.id === savedBoard) ? savedBoard : boards[0]!.id;
  const issues = new Map(remote.map((i) => [i.key, i])),
    full = new Map<string, Full>();
  changedKeys.clear();
  createdKeys.clear();
  othersCreating.clear();
  owners.clear();
  localFields.clear();
  fullFields.clear();
  needsFullRefresh.clear();
  const inJira = new Map(remote.map((i) => [i.key, i]));
  /** Puts saved changes over Jira's copies, into `issues` and `full`. */
  const install = (changes: LocalChange[], issues: Map<string, Issue>, full: Map<string, Full>) => {
    for (const change of changes) {
      // With Jira writes, an override for an issue Jira no longer has is dropped: the issue was deleted there.
      if (client.writable === true && !change.created && !inJira.has(change.key)) continue;
      // Older builds saved a link's preview as a local edit, which replayed the link to Jira on every load (R1-D1).
      if (
        client.writable === true &&
        !change.created &&
        !change.fullFields.length &&
        change.issueFields.every((f) => f === "resources" || f === "updated") &&
        change.issue?.resources?.every((r) => r.kind === "link")
      )
        continue;
      changedKeys.add(change.key);
      owners.set(change.key, change.tab ?? "");
      if (change.created) {
        createdKeys.add(change.key);
        othersCreating.set(change.key, change.tab ?? "");
      }
      localFields.set(change.key, new Set(change.issueFields));
      fullFields.set(change.key, new Set(change.fullFields));
      if (change.issue === null) issues.delete(change.key);
      else if (change.created || !inJira.has(change.key)) issues.set(change.key, change.issue);
      else {
        const base = inJira.get(change.key)!;
        const patch = Object.fromEntries(
          change.issueFields.map((field) => [field, (change.issue as any)[field]]),
        );
        if (
          change.full?.fields.comment &&
          (change.fullFields.includes("comment") || change.issue.commentStates)
        )
          patch.comments = visibleCommentTotal(
            base.comments +
              (change.full?.fields.comment?.comments ?? []).filter((c: any) =>
                String(c.id).startsWith("local-"),
              ).length,
            change.full?.fields.comment?.comments ?? [],
            change.issue.commentStates,
          );
        issues.set(change.key, { ...base, ...patch });
      }
      if (change.full) {
        full.set(change.key, change.full);
        if (!change.created) needsFullRefresh.add(change.key);
      }
    }
  };
  install(local.changes, issues, full);
  // Undo covers this tab's own edits only, as Linear's per-client history does; a reload keeps them (R2-inbox-D3).
  undo.splice(0, undo.length, ...local.undo.filter((e) => e.tab === undoTab));
  redo.splice(0, redo.length, ...local.redo.filter((e) => e.tab === undoTab));
  localSeq = local.sequence;
  numbers = { next: 0, end: 0 };
  if (opened.type === "opened") await reserveNumbers();
  for (const [from, to] of Object.entries(local.keys ?? {})) jiraKeys.set(from, to);
  set({
    boards,
    site: client.site,
    namespace,
    writable: client.writable === true,
    issues,
    full,
    defaults,
    preferences,
    savedViews: [],
    favorites: readFavorites(),
    undoCount: undo.length,
    redoCount: redo.length,
  });
  navigate({ board, view: preferences[board]?.display.openIn ?? "side" });
  storage.send(opened);
  // Saved local overrides are the durable outbox: whatever Jira hasn't taken yet is sent again.
  // An override for an issue Jira no longer has is not re-created; only issues made here are. Deletes are never replayed.
  // Only changes of tabs that have closed are replayed, by one tab: an open tab is still sending its own (R1-D6, R1-D7).
  const replay = async (keys?: Set<string>, changes = local.changes) =>
    send(
      await Promise.all(
        changes
          .filter(
            (change) =>
              (!keys || keys.has(change.key)) &&
              change.issue &&
              (change.created || remote.some((i) => i.key === change.key)),
          )
          .map(async (change): Promise<[string, Side, Side]> => {
            const after = snapshot(change.key),
              known = remote.find((i) => i.key === change.key),
              f = after.full;
            const full = f && {
              ...f,
              fields: {
                ...f.fields,
                description: change.fullFields.includes("description")
                  ? f.descriptionBase
                  : f.fields.description,
                comment: {
                  ...f.fields.comment,
                  comments: (f.fields.comment?.comments ?? []).filter(
                    (c: any) => !String(c.id).startsWith("local-"),
                  ),
                },
              },
            };
            // The mirror has no remote links: only links Jira lacks are sent again, and none are removed (R1-D1).
            const links =
              !change.created &&
              change.issueFields.includes("resources") &&
              after.issue?.resources?.some((r) => r.kind !== "document")
                ? await jiraLinks(change.key)
                : undefined;
            // Only fields still owned locally differ from Jira; the rest already match, so they send nothing.
            const remoteFields = Object.fromEntries(
              change.issueFields.map((field) => [
                field,
                field === "attachments"
                  ? aliasAttachments(change.key, known?.attachments ?? [])
                  : field === "mediaEdits"
                    ? jiraImageComments(after.issue?.mediaEdits)
                    : field === "resources"
                      ? after.issue?.resources?.filter(
                          (r) => r.kind === "document" || !r.url || !links || links.has(r.url),
                        )
                      : (known as any)?.[field],
              ]),
            );
            return [
              change.key,
              change.created
                ? {}
                : { issue: after.issue ? { ...after.issue, ...remoteFields } : known, full },
              after,
            ];
          }),
      ),
    );
  if (state.writable)
    void (navigator.locks && database
      ? holdTabLock().then(() =>
          navigator.locks.request("better-jira-outbox", async () => {
            const held = (await navigator.locks.query()).held ?? [],
              live = new Set(
                held.flatMap((l) =>
                  l.name?.startsWith(TAB_LOCK) ? [l.name.slice(TAB_LOCK.length)] : [],
                ),
              ),
              claimed = await database!.claim(tabId, live);
            // A closed tab may have saved edits after this tab read the saved data: send and show the merged copy saved
            // now, as a takeover later on does (sync review 3-5).
            const saved = (await database!.stored()).changes.filter((c) => claimed.has(c.key)),
              issues = new Map(state.issues),
              full = new Map(state.full);
            install(saved, issues, full);
            set({ issues, full });
            for (const key of claimed) {
              owners.delete(key);
              othersCreating.delete(key);
            }
            await replay(claimed, saved);
          }),
        )
      : (othersCreating.clear(), replay()));
  await refreshSavedViews(true);
  if (!navigationReady) {
    window.addEventListener("focus", () => {
      void refreshSavedViews().catch(viewError);
    });
    restoreNavigation();
    navigationReady = true;
    syncNavigation(true);
    window.addEventListener("popstate", restoreNavigation);
    window.addEventListener("beforeunload", (event) => {
      const s = storage.getSnapshot();
      // Jobs waiting on another tab's create are saved, and replayed by whichever tab sends that create.
      if (
        s.matches("saving") ||
        s.matches("failed") ||
        outbox.some((job) => !waitsForCreate(job)) ||
        heldDeletes.size
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
  startPoll();
  if (state.writable)
    void import("./draft-uploads").then(({ keepDraftUploadsClean }) =>
      keepDraftUploadsClean(namespace, () => JSON.stringify(localSnapshot().changes), {
        full: async (key) => {
          const response = await fetch(`/api/issues/${encodeURIComponent(key)}`);
          if (response.status === 404) return null;
          if (!response.ok) throw new Error("Could not read the issue");
          return response.json();
        },
        uploaded: async (client) => {
          const response = await fetch(`/api/uploads/${encodeURIComponent(client)}`);
          if (response.status === 404) return undefined;
          if (!response.ok) throw new Error("Could not read the upload");
          return response.json();
        },
        remove: async (key, id) => {
          const response = await fetch(`/api/issues/${encodeURIComponent(key)}/ops`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ops: [{ op: "attachment.delete", id }],
              board: state.issues.get(key)?.board,
            }),
          });
          const result = await response.json().catch(() => ({ error: "No answer" }));
          if (!response.ok || result.error) throw new Error(result.error);
        },
      }),
    );
  if (state.writable)
    fetchJson<JiraOptions>("/api/options", 5 * 60_000).then(
      (options) => set({ options }),
      () => {},
    );
  clockTimer ??= setInterval(() => set({ clock: Date.now() }), 60000);
}

let clockTimer: ReturnType<typeof setInterval> | undefined;
const lastProperties = new Map<string, string>();
/** One property poll; the poll query schedules the next. */
async function fetchProperties(): Promise<{ pending: number }> {
  const res = await fetch("/api/properties");
  if (!res.ok) throw new Error("Properties unavailable");
  const data = await res.json();
  const issues = new Map(state.issues);
  let changed = false;
  const stale: string[] = [];
  for (const [key, entry] of Object.entries(data.entries) as [string, any][]) {
    const issue = issues.get(key);
    const signature = JSON.stringify(entry);
    if (lastProperties.get(key) === signature) continue;
    const { errors, ...extra } = entry;
    // Read-only sites keep their local attachments; only a writable site's list comes from Jira.
    if (state.writable && extra.attachments)
      extra.attachments = aliasAttachments(key, extra.attachments, issue?.attachments);
    else delete extra.attachments;
    if (!issue) {
      // A new Jira issue; with local-only editing, a missing key may be a local delete.
      // While a create is in flight its new key may arrive here first; the write's answer adds it with the local fields intact.
      if (
        state.writable &&
        !changedKeys.has(key) &&
        extra.key === key &&
        !outbox.some((job) => job.ops[0]?.op === "create")
      ) {
        issues.set(key, extra);
        changed = true;
        lastProperties.set(key, signature);
      }
      continue;
    }
    lastProperties.set(key, signature);
    // Edited in Jira: the cached description and comments are stale, so a later edit would overwrite Jira's newer text.
    if (state.writable && state.full.has(key) && extra.updated && extra.updated !== issue.updated) {
      // With a local edit still unsent, look again once its write lands (the write's refresh notifies), or the change is never read (R2-D1).
      if (fullFields.get(key)?.size) lastProperties.delete(key);
      else stale.push(key);
    }
    const local = localFields.get(key) ?? new Set();
    for (const field of local) delete extra[field];
    if (local.has("status")) {
      delete extra.statusSince;
      delete extra.started;
    }
    issues.set(key, { ...issue, ...extra });
    changed = true;
  }
  // Issues deleted in Jira, or moved off every board. Writes still in flight keep theirs.
  if (state.writable && Object.keys(data.entries).length)
    for (const key of issues.keys())
      if (
        !(key in data.entries) &&
        !createdKeys.has(key) &&
        !outbox.some((job) => job.key === key)
      ) {
        // Gone from Jira, so its local overrides go too; a saved tombstone would otherwise send a delete after reload.
        issues.delete(key);
        lastProperties.delete(key);
        changedKeys.delete(key);
        touch(key);
        localFields.delete(key);
        fullFields.delete(key);
        changed = true;
        if (state.selected === key) {
          navigate({ selected: null, panel: false });
          ui.send({
            type: "toast.show",
            text: `${key} was deleted in Jira`,
            detail: "It is no longer on your boards.",
          });
        }
      }
  set({ propertySync: data.progress, ...(changed ? { issues } : {}) });
  for (const key of stale) {
    needsFullRefresh.add(key);
    // The focused description takes Jira's newer text too: it asks before replacing what is being typed.
    if (
      key === state.selected &&
      (!document.activeElement?.closest?.(".rich-editor") ||
        document.activeElement.id === "description")
    )
      void loadFull(key);
  }
  return data.progress;
}

export async function loadFull(key: string, force = false) {
  if (createdKeys.has(key) || (state.full.has(key) && !needsFullRefresh.has(key) && !force)) return;
  const error = (text: string) => {
    if ((state.fullErrors.get(key) ?? "") !== text)
      set({ fullErrors: new Map(state.fullErrors).set(key, text) });
  };
  error("");
  // A load while one runs joins it.
  try {
    await queryClient.fetchQuery({
      queryKey: ["issue", key],
      queryFn: () => fetchFull(key).then(() => true),
    });
  } catch {
    error("Could not load issue details");
  }
}
/** Jira's remote links as link resources. A writable site takes Jira's set (unless a write is queued); a read-only one only adds links it lacks. */
export function withJiraLinks(
  resources: Issue["resources"] = [],
  links: { url: string; title: string }[] | undefined,
  replace: boolean,
): Issue["resources"] {
  if (!links) return resources;
  const jira = new Map(links.map((l) => [l.url, l])),
    have = new Set<string>();
  const kept = resources.flatMap((r) => {
    if (r.kind === "document" || !r.url) return [r];
    const link = jira.get(r.url);
    if (!link) return replace ? [] : [r];
    have.add(r.url);
    return [{ ...r, title: link.title }];
  });
  const at = now();
  return [
    ...kept,
    ...links
      .filter((l) => !have.has(l.url))
      .map((l) => ({
        id: crypto.randomUUID(),
        kind: "link" as const,
        url: l.url,
        title: l.title,
        updated: at,
        created: at,
      })),
  ];
}
/** Loads an issue's Jira record and keeps local field edits on top. */
async function fetchFull(key: string) {
  const res = await fetch(`/api/issues/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error("Could not load issue details");
  let full = await res.json();
  // A comment whose delete waits out the undo window (an undone add) stays hidden until Jira drops it.
  if (heldDeletes.size && Array.isArray(full.fields?.comment?.comments))
    full.fields.comment.comments = full.fields.comment.comments.filter(
      (c: any) => !heldDeletes.has(String(c.id)),
    );
  const local = state.full.get(key);
  if (local)
    for (const field of fullFields.get(key) ?? []) {
      if (field === "comment") {
        const comments = [
          ...(full.fields.comment?.comments ?? []),
          ...(local.fields.comment?.comments ?? []).filter((c: any) =>
            String(c.id).startsWith("local-"),
          ),
        ];
        full = {
          ...full,
          fields: {
            ...full.fields,
            comment: { ...full.fields.comment, comments, total: comments.length },
          },
        };
      } else full = { ...full, fields: { ...full.fields, [field]: local.fields[field] } };
    }
  // A refused description, and the base of one still unsent, outlive Jira's copy.
  if (local?.descriptionRejected)
    full = {
      ...full,
      descriptionRejected: local.descriptionRejected,
      descriptionError: local.descriptionError,
    };
  if (local?.descriptionBase && fullFields.get(key)?.has("description"))
    full = { ...full, descriptionBase: local.descriptionBase };
  needsFullRefresh.delete(key);
  const issue = state.issues.get(key);
  if (issue)
    set({
      full: new Map(state.full).set(key, full),
      issues: new Map(state.issues).set(key, {
        ...issue,
        ...(outbox.some((job) => job.key === key)
          ? {}
          : { resources: withJiraLinks(issue.resources, full.remotelinks, state.writable) }),
        ...(full.fields.comment
          ? {
              comments: visibleCommentTotal(
                full.fields.comment.total,
                full.fields.comment.comments ?? [],
                issue.commentStates,
              ),
            }
          : {}),
        ...(!localFields.get(key)?.has("description")
          ? { description: adfToText(full.fields.description) }
          : {}),
      }),
    });
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

const now = () => new Date().toISOString();
let navigationReady = false,
  restoringNavigation = false,
  linkView = false;
function syncNavigation(replace = false) {
  const url = new URL(location.href);
  if (
    url.searchParams.get("issue") !== (state.panel ? state.selected : null) ||
    url.searchParams.get("document") !== state.document
  )
    url.hash = "";
  url.pathname = state.editorDraft ? (state.editorDraft.id ? `/view/${encodeURIComponent(state.editorDraft.id)}/edit` : "/view/new") : state.activeViewId ? `/view/${encodeURIComponent(state.activeViewId)}` : state.viewsPage ? "/views" : "/";
  if (state.activeViewId && state.overlayFilters.children.length)
    url.searchParams.set("filter", encodeOverlay(state.overlayFilters));
  else url.searchParams.delete("filter");
  url.searchParams.set("board", String(state.board));
  if (state.panel && state.selected) {
    url.searchParams.set("issue", state.selected);
    url.searchParams.set("view", state.view);
  } else {
    url.searchParams.delete("issue");
    url.searchParams.delete("view");
  }
  if (state.document && state.panel) url.searchParams.set("document", state.document);
  else url.searchParams.delete("document");
  if (state.inbox) url.searchParams.set("inbox", "1");
  else url.searchParams.delete("inbox");
  if (!state.inbox) url.searchParams.delete("notification"); // the inbox's selected row outside the mirror
  if (state.mine && !state.inbox) url.searchParams.set("mine", "1");
  else url.searchParams.delete("mine");
  if (state.editorDraft) {
    try { sessionStorage.setItem(`view-editor:${state.namespace}:${url.pathname}`, JSON.stringify(state.editorDraft)); } catch { /* Draft remains available until navigation. */ }
  }
  if (url.href !== location.href) history[replace ? "replaceState" : "pushState"]({}, "", url);
}
function restoreNavigation() {
  const params = new URL(location.href).searchParams,
    wanted = params.get("issue"),
    // A link to an issue's app key opens the issue Jira made for it, wherever it was created (sync check 7).
    issue = state.issues.get(currentKey(wanted ?? ""));
  const editorRoute = /^\/view\/(new|[^/]+\/edit)$/.test(location.pathname);
  let editorDraft: ViewDraft | null = null;
  if (editorRoute) {
    try { editorDraft = JSON.parse(sessionStorage.getItem(`view-editor:${state.namespace}:${location.pathname}`) ?? "null"); } catch { /* Start a fresh draft. */ }
    if (!editorDraft) {
      const id = /^\/view\/([^/]+)\/edit$/.exec(location.pathname)?.[1];
      editorDraft = id && state.savedViews.some(v => v.id === id) ? editViewDraft(id) : createViewDraft();
    }
  }
  const routeId = /^\/view\/([^/]+)$/.exec(new URL(location.href).pathname)?.[1];
  const active = state.savedViews.find((v) => v.id === routeId);
  const board = editorDraft?.board ?? active?.board ?? issue?.board ?? Number(params.get("board"));
  restoringNavigation = true;
  commit({
    editorDraft,
    viewsPage: location.pathname === "/views",
    activeViewId: active?.id ?? null,
    overlayFilters: active ? decodeOverlay(params.get("filter")) : emptyOverlay(),
  });
  navigate({
    ...(state.boards.some((b) => b.id === board) ? { board } : {}),
    selected: issue?.key ?? null,
    panel: !!issue,
    document: issue ? params.get("document") : null,
    inbox: params.has("inbox"),
    ...(active ? { view: active.display.openIn } : {}),
    ...(params.get("view") === "page" || params.get("view") === "side"
      ? { view: params.get("view") as View }
      : {}),
  });
  // mine.set also leaves the inbox, so send it only when My issues actually changes.
  if (!params.has("inbox") && get().mine !== (editorDraft?.mine ?? active?.mine ?? params.has("mine")))
    ui.send({ type: "mine.set", mine: editorDraft?.mine ?? active?.mine ?? params.has("mine") });
  restoringNavigation = false;
  if (wanted && !issue) ui.send({ type: "toast.show", text: `Issue ${wanted} not found` });
}
const localFields = new Map<string, Set<string>>(),
  fullFields = new Map<string, Set<string>>();
const changedKeys = new Set<string>(),
  createdKeys = new Set<string>(),
  needsFullRefresh = new Set<string>();
const undo: LocalEdit[] = [],
  redo: LocalEdit[] = [];
let database: LocalDatabase | undefined;
/** Which open tab sends each saved change (absent: this tab). */
const owners = new Map<string, string>();
// An issue another tab is creating stays that tab's to send: two editing tabs never wait on each other (sync review 2-3).
const touch = (...keys: string[]) => {
  for (const key of keys) if (!othersCreating.has(key)) owners.delete(key);
};
/** This tab across reloads (sessionStorage is per tab), so its undo history survives a reload and never reaches another tab.
 *  ponytail: a duplicated tab copies sessionStorage and shares the history; mint a new id on `pageshow` duplicates if that matters. */
const undoTab = (() => {
  try {
    return (sessionStorage["better-jira:undo-tab"] ??= crypto.randomUUID()) as string;
  } catch {
    return crypto.randomUUID();
  }
})();
const tabId = crypto.randomUUID(),
  TAB_LOCK = "better-jira-tab:";
/** Held while this tab is open, so other tabs know its saved changes are still being sent. */
let tabLock: Promise<void> | undefined;
const holdTabLock = () =>
  (tabLock ??= new Promise((resolve) =>
    navigator.locks.request(TAB_LOCK + tabId, () => (resolve(), new Promise(() => {}))),
  ));
/** The URLs of an issue's Jira remote links, or undefined if they can't be read. */
async function jiraLinks(key: string) {
  try {
    const response = await fetch(`/api/issues/${encodeURIComponent(key)}`);
    if (!response.ok) return;
    const full: Full = await response.json();
    return new Set((full.remotelinks ?? []).map((l) => l.url));
  } catch {}
}
function localSnapshot(): LocalState {
  return {
    version: 1,
    sequence: localSeq,
    changes: [...changedKeys]
      .filter(
        (key) =>
          createdKeys.has(key) ||
          !state.issues.has(key) ||
          localFields.get(key)?.size ||
          fullFields.get(key)?.size,
      )
      .map((key) => ({
        key,
        issue: state.issues.get(key) ?? null,
        full: state.full.get(key),
        issueFields: [...(localFields.get(key) ?? [])],
        fullFields: [...(fullFields.get(key) ?? [])],
        created: createdKeys.has(key),
        tab: owners.get(key) ?? tabId,
      })),
    undo: [...undo],
    redo: [...redo],
    keys: Object.fromEntries(jiraKeys),
  };
}
/** Ignored until storage has opened, and while it is blocked; see storageMachine. */
const queueSave = () => storage.send({ type: "change" });

// --- Jira writes: each edit's before/after becomes ops, sent one job at a time ---
// ponytail: the outbox lives in memory; closing the tab with writes pending is guarded by beforeunload only.
/** `hold`: a status change waits until then, so rapid changes reach Jira as one transition (R2-issue-fields-D13). */
type Job = {
  key: string;
  board: number;
  ops: Op[];
  started?: boolean;
  cancelled?: boolean;
  hold?: number;
  /** Jira couldn't tell yet whether an earlier send went through: tries so far, and when to send it again. */
  tries?: number;
  retryAt?: number;
};
// ponytail: fixed backoff (5 s doubling to 1 min) and error after 4 tries; tune if outages need other pacing.
const RETRY_WAIT = 5000,
  RETRY_WAIT_MAX = 60_000,
  RETRY_SHOWN = 4;
// ponytail: fixed 400 ms debounce on status writes; tune if single status edits must settle faster.
const STATUS_HOLD = 400;
type WriteResult = {
  error?: string;
  key?: string;
  created?: Record<string, string>;
  others?: Issue[];
  issue?: Issue | null;
  full?: Full | null;
};
const outbox: Job[] = [];
/** App ids (new issue keys, new comment ids) that Jira has since replaced. Kept apart: comment ids are plain numbers. */
const jiraKeys = new Map<string, string>(),
  jiraComments = new Map<string, string>();
/** The key Jira gave an issue created here; views and closures holding the app key reach the issue through it. */
export const currentKey = (key: string) => jiraKeys.get(key) ?? key;
/** The first key an issue had in this session, so a view stays mounted when Jira assigns the real key. */
export const firstKey = (key: string) => {
  for (const [from, to] of jiraKeys) if (to === key) return from;
  return key;
};
/** Image comments Jira already has; a replay re-sends only the rest. */
const jiraImageComments = (edits: Issue["mediaEdits"]) =>
  edits &&
  Object.fromEntries(
    Object.entries(edits).map(([id, edit]) => [
      id,
      { ...edit, comments: edit.comments?.filter((c) => jiraCommentId(c.id)) },
    ]),
  );
function send(changes: [string, Side, Side][]) {
  if (!state.writable) return;
  // Creates go first, so other issues can name the new key; deletes last, so edits to related issues (cleared parents, links) land first.
  const order = (ops: Op[]) => (ops[0]?.op === "create" ? -1 : ops[0]?.op === "delete" ? 1 : 0);
  const jobs = changes
    .map(([key, before, after]) => ({
      key,
      board: (after.issue ?? before.issue)?.board,
      ops: opsFor(before, after, state.issues),
    }))
    .sort((a, b) => order(a.ops) - order(b.ops));
  // Jira detaches (or, for sub-tasks, deletes) the children of a deleted issue, and drops its links, itself (R1-D101).
  const deleted = new Set(jobs.filter((job) => job.ops[0]?.op === "delete").map((job) => job.key));
  for (const job of jobs)
    if (deleted.size && !deleted.has(job.key)) {
      const parent = changes.find(([key]) => key === job.key)?.[1].issue?.parent;
      job.ops = job.ops.flatMap((op): Op[] => {
        if (op.op === "link" && op.remove && deleted.has(op.target)) return [];
        if (op.op !== "fields" || op.fields.parent !== null || !parent || !deleted.has(parent))
          return [op];
        const { parent: _, ...fields } = op.fields;
        return Object.keys(fields).length ? [{ op: "fields", fields }] : [];
      });
    }
  for (const job of jobs) job.ops = holdCommentDeletes(job.key, job.board, job.ops);
  for (const { key, board, ops } of jobs) {
    if (!ops.length || board === undefined) continue;
    // Ops naming an issue whose create is still queued must run after that create, so they never fold into an earlier job.
    const text = JSON.stringify(ops),
      afterCreate = outbox.some(
        (job) => job.key !== key && job.ops[0]?.op === "create" && text.includes(`"${job.key}"`),
      );
    const waiting = afterCreate
      ? undefined
      : outbox.findLast((job) => job.key === key && !job.started);
    const hold = ops.some((op) => op.op === "status") ? Date.now() + STATUS_HOLD : undefined;
    if (waiting) {
      waiting.ops = mergeOps(waiting.ops, ops);
      if (hold) waiting.hold = hold;
    } else outbox.push({ key, board, ops, ...(hold ? { hold } : {}) });
  }
  // A change that queued no write (nothing to send, or a redo that only cancelled a held comment delete) gets no answer
  // for adopt() to settle, so its Jira fields would stay pinned over every refresh: Jira's copy owns them again (R2-comments-D1).
  for (const { key } of jobs)
    if (
      !createdKeys.has(key) &&
      !outbox.some((job) => job.key === key) &&
      (fullFields.get(key)?.size ||
        JIRA_ISSUE_FIELDS.some((field) => localFields.get(key)?.has(field)))
    ) {
      fullFields.delete(key);
      for (const field of JIRA_ISSUE_FIELDS) localFields.get(key)?.delete(field);
      needsFullRefresh.add(key);
      touch(key);
      queueSave();
    }
  set({ pendingWrites: outbox.length });
  void flush();
}
/**
 * Jira can't restore a deleted comment's id, time or thread, so a comment delete waits out the undo window and ⌘Z
 * simply cancels it, leaving the comment where it was (R1-D16). The comment is hidden locally meanwhile.
 */
const COMMENT_UNDO_WINDOW = 8000;
const heldDeletes = new Map<string, ReturnType<typeof setTimeout>>();
function holdCommentDeletes(key: string, board: number | undefined, ops: Op[]): Op[] {
  if (board === undefined) return ops;
  return ops.filter((op) => {
    if (op.op === "comment" && heldDeletes.has(op.ref)) {
      clearTimeout(heldDeletes.get(op.ref));
      heldDeletes.delete(op.ref);
      return false;
    }
    if (op.op !== "comment.delete") return true;
    clearTimeout(heldDeletes.get(op.id));
    heldDeletes.set(
      op.id,
      setTimeout(() => {
        heldDeletes.delete(op.id);
        outbox.push({ key: currentKey(key), board, ops: [op] });
        set({ pendingWrites: outbox.length });
        void flush();
      }, COMMENT_UNDO_WINDOW),
    );
    return false;
  });
}
/** Whether `job` is for, or names, an issue another tab is still creating in Jira. */
const waitsForCreate = (job: Job) =>
  othersCreating.size > 0 &&
  [...othersCreating.keys()].some(
    (key) => currentKey(job.key) === key || JSON.stringify(job.ops).includes(`"${key}"`),
  );
/**
 * Waits for the tabs creating issues this tab's jobs name: takes up the Jira keys they saved; sends a create itself once
 * its tab has closed; and lets go of an issue its tab discarded (sync check 7, sync review 3).
 */
async function waitForCreators() {
  const stored = await database?.stored().catch(() => undefined);
  if (!stored) {
    othersCreating.clear();
    return;
  }
  learnKeys(stored.keys);
  for (const key of othersCreating.keys())
    if (jiraKeys.has(key)) othersCreating.delete(key);
    else if (!stored.created.has(key)) {
      // Discarded in the tab that made it (or Jira refused the create): its edits here go with it.
      othersCreating.delete(key);
      for (let i = outbox.length - 1; i >= 0; i--) if (outbox[i]!.key === key) outbox.splice(i, 1);
      if (state.issues.has(key)) discard(key, false);
    }
  if (othersCreating.size && navigator.locks) {
    // This tab's own edits go into the saved copy first, so a create sent from that copy carries them.
    queueSave();
    await flushLocalChanges();
    await navigator.locks.request("better-jira-outbox", async () => {
      const held = (await navigator.locks.query()).held ?? [],
        live = new Set(
          held.flatMap((l) =>
            l.name?.startsWith(TAB_LOCK) ? [l.name.slice(TAB_LOCK.length)] : [],
          ),
        );
      const orphaned = new Set(
        [...othersCreating].flatMap(([key, tab]) => (live.has(tab) ? [] : [key])),
      );
      if (!orphaned.size) return;
      // Its tab closed before Jira had it. Exactly one open tab claims it and sends the create (sync review 2-3).
      const claimed = await database!.claim(tabId, live, orphaned),
        saved = await database!.stored();
      for (const key of orphaned) {
        const change = saved.changes.find((c) => c.key === key);
        if (!claimed.has(key)) {
          // Another open tab claimed it: wait for that tab's create instead.
          if (change?.tab) othersCreating.set(key, change.tab);
          continue;
        }
        owners.delete(key);
        othersCreating.delete(key);
        for (let i = outbox.length - 1; i >= 0; i--)
          if (outbox[i]!.key === key) outbox.splice(i, 1);
        if (!change?.issue) continue;
        // The saved copy merges every tab's edits: the create carries them all, and this tab shows it. The create's
        // client id is the issue's, so if the closed tab's send did reach Jira this one gets the same issue back.
        set({
          issues: new Map(state.issues).set(key, change.issue),
          ...(change.full ? { full: new Map(state.full).set(key, change.full) } : {}),
        });
        send([[key, {}, { issue: change.issue, full: change.full }]]);
        // First: jobs waiting on it (links, parents, ranks naming it) must find its Jira key (sync review 2-5).
        const index = outbox.findIndex((job) => job.key === key && job.ops[0]?.op === "create");
        if (index > 0) outbox.unshift(...outbox.splice(index, 1));
      }
    });
  }
  set({ pendingWrites: outbox.length });
  if (othersCreating.size) {
    set({
      perf: `Waiting for another tab to create ${[...othersCreating.keys()].join(", ")} in Jira…`,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
let flushing = false,
  wake: (() => void) | undefined;
async function flush() {
  // A write made while the loop waits on a retry goes now.
  if (flushing) return wake?.();
  flushing = true;
  try {
    while (outbox.length) {
      // A job for an issue another tab is still creating waits for its Jira key; one Jira couldn't settle yet waits for
      // its retry, and its issue's later jobs behind it. Every other issue's jobs go on (sync review 3, 3-2).
      const now = Date.now(),
        cooling = new Set(
          outbox.flatMap((job) => (job.retryAt! > now ? [currentKey(job.key)] : [])),
        );
      const index = outbox.findIndex(
        (job) => !waitsForCreate(job) && !cooling.has(currentKey(job.key)),
      );
      if (index < 0) {
        if (outbox.some(waitsForCreate)) await waitForCreators();
        else {
          const next = Math.min(...outbox.map((job) => job.retryAt ?? now));
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, Math.min(next - now, 1000));
          });
          wake = undefined;
        }
        continue;
      }
      if (index > 0) outbox.unshift(...outbox.splice(index, 1));
      const job = outbox[0]!;
      // Later status changes merge into a held job; the wait restarts with each.
      if (job.hold && job.hold > Date.now()) {
        await new Promise((resolve) => setTimeout(resolve, job.hold! - Date.now()));
        continue;
      }
      job.started = true;
      job.key = currentKey(job.key);
      job.ops = renameCommentIds(renameIds(job.ops, jiraKeys), jiraComments);
      // Files attach to an existing issue: create it first, then upload and attach in a follow-up job.
      const [first, ...rest] = job.ops;
      if (
        first?.op === "create" &&
        (rest.some((op) => op.op === "attachment.add") ||
          JSON.stringify(first).includes('"collection":"local"'))
      ) {
        const description = first.fields.description;
        job.ops = [
          {
            ...first,
            fields: {
              ...first.fields,
              ...(description ? { description: withoutLocalMedia(description) } : {}),
            },
          },
        ];
        outbox.splice(1, 0, {
          key: job.key,
          board: job.board,
          ops: [
            ...(description && JSON.stringify(description).includes('"collection":"local"')
              ? [{ op: "fields" as const, fields: { description } }]
              : []),
            ...rest,
          ],
        });
      }
      // A cancelled job (Restore mirrored Jira version) stops retrying instead of sending discarded edits (R2-D3).
      const post = async (ops: Op[]) =>
        job.cancelled
          ? Response.json({})
          : fetch(`/api/issues/${encodeURIComponent(job.key)}/ops`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // A later write for this issue re-reads it anyway: don't wait for Jira's copy twice (R2-create-D2).
              body: JSON.stringify({
                ops,
                board: job.board,
                ...(ops.length && outbox.some((other) => other !== job && other.key === job.key)
                  ? { settle: false }
                  : {}),
                ...(job.tries ? { resend: true } : {}),
              }),
            });
      let result: WriteResult, ops: Op[] | undefined;
      try {
        ops = await prepareOps(job.key, job.ops);
      } catch (e) {
        // An upload failed: fetch Jira's copy to roll back to.
        result = { error: e instanceof Error ? e.message : "Could not upload the file to Jira." };
        try {
          result = { ...(await (await post([])).json()), error: result.error };
        } catch {}
      }
      // Files uploaded before they were placed leave nothing to send: no empty write for the next one to wait behind (R2-D10).
      // The issue's next write, or the property poll, brings Jira's attachment list.
      if (ops && !ops.length) {
        outbox.shift();
        if (job.ops.every((op) => op.op === "attachment.add" || op.op === "attachment.delete"))
          localFields.get(job.key)?.delete("attachments");
        set({ pendingWrites: outbox.length });
        continue;
      }
      if (ops) {
        // An unreachable server means nothing reached Jira: send the same ops again every 5 s until it answers.
        const response = (await asyncRetry(post, {
          maxAttempts: Infinity,
          backoff: "fixed",
          baseWait: 5000,
          onRetry: () =>
            set({ perf: "Can't reach the better-jira server. Retrying the Jira write…" }),
        })(ops))!;
        // 503: Jira didn't answer, or can't tell yet whether an earlier send went through. The same job (same client ids)
        // goes again later, with backoff, behind other issues' writes; it is never dropped (sync review 2-2, 3-1, 3-2).
        if (response.status === 503) {
          const { error } = await response.json().catch(() => ({}));
          const text = error ?? "Jira didn't answer. The change will be sent again shortly.";
          job.tries = (job.tries ?? 0) + 1;
          job.retryAt = Date.now() + Math.min(RETRY_WAIT * 2 ** (job.tries - 1), RETRY_WAIT_MAX);
          set({
            perf: text,
            ...(job.tries >= RETRY_SHOWN
              ? { writeError: { key: job.key, text, retrying: true } }
              : {}),
          });
          continue;
        }
        result = await response
          .json()
          .catch(() => ({ error: `Server returned ${response.status}` }));
      }
      outbox.shift();
      // A create Jira refused leaves nothing for its follow-up uploads to attach to.
      const refused = first?.op === "create" && !result!.created?.[job.key];
      if (refused)
        for (let i = outbox.length - 1; i >= 0; i--)
          if (outbox[i]!.key === job.key) outbox.splice(i, 1);
      const created = new Map(Object.entries(result!.created ?? {}));
      for (const [from, to] of created)
        if (from === job.key) jiraKeys.set(from, to);
        // A re-created comment's old Jira id still files the replies Jira kept under it: only writes already queued move to the new id (R1-D15).
        else if (from.startsWith("local-")) jiraComments.set(from, to);
        else
          for (const queued of outbox)
            queued.ops = renameCommentIds(queued.ops, new Map([[from, to]]));
      if (created.has(job.key)) rekey(job.key, created.get(job.key)!);
      // A deleted issue (full null) takes its upload slots with it.
      if (result!.full !== undefined && result!.key) settleUploads(result!.key, result!.full);
      // New comment ids too, so undo and redo address the comment Jira now has.
      const comments = new Map([...created].filter(([from]) => from !== job.key));
      if (comments.size) {
        for (const list of [undo, redo])
          list.splice(0, list.length, ...renameCommentIds(list, comments));
        // An image thread keeps its place on the image under the Jira comment id.
        const key = result!.key ?? job.key,
          issue = state.issues.get(key);
        if (issue?.mediaEdits) {
          set({
            issues: new Map(state.issues).set(key, {
              ...issue,
              mediaEdits: renameCommentIds(issue.mediaEdits, comments),
            }),
          });
          touch(key);
          queueSave();
        }
      }
      // A rejected link or parent naming an issue created here leaves that issue in Jira on its own: say which.
      const orphans =
        first?.op === "create"
          ? []
          : [...new Set(jiraKeys.values())].filter((created) =>
              JSON.stringify(job.ops).includes(`"${created}"`),
            );
      if (result!.error)
        ui.send({
          type: "toast.show",
          text: `Jira did not save the change to ${result!.key ?? job.key}`,
          detail: `${result!.error}${orphans.length ? ` ${orphans.join(", ")} was created in Jira, but not linked.` : ""}`,
        });
      const describes = job.ops.some(
        (op) => op.op === "fields" && op.fields.description !== undefined,
      );
      // A refused description stands in for the description edits still queued: they started from the refused text, so Jira would refuse them too.
      if (result!.error && describes)
        for (const queued of outbox)
          if (queued.key === job.key && !queued.started)
            queued.ops = queued.ops.flatMap((op): Op[] => {
              if (op.op !== "fields" || op.fields.description === undefined) return [op];
              const { description: _d, descriptionBase: _b, ...fields } = op.fields;
              return Object.keys(fields).length ? [{ op: "fields", fields }] : [];
            });
      // A comment Jira refused goes back into its composer, so the text is never lost (R2-comments-D4).
      if (result!.error)
        for (const op of job.ops)
          if (op.op === "comment" && !created.has(op.ref))
            rejectComment({ key: result!.key ?? job.key, parentId: op.parentId, body: op.body });
      adopt(result!.key ?? job.key, result!, !!result!.error, created, describes);
      for (const other of result!.others ?? [])
        adopt(other.key, { issue: other, error: result!.error }, false, created);
      if (refused) discard(job.key);
      const key = result!.key ?? job.key;
      set({
        pendingWrites: outbox.length,
        ...(result!.error
          ? { writeError: { key, text: result!.error } }
          : state.writeError?.key === key
            ? { writeError: null }
            : {}),
      });
    }
  } finally {
    flushing = false;
  }
}
export const REJECTED_COMMENT = "better-jira:comment-rejected";
export type RejectedComment = {
  key: string;
  parentId?: string;
  body: AdfDocument;
};
/** Puts a refused comment back into the saved draft at `draftKey`, after anything typed since, and returns it. */
export function restoreRejectedDraft(draftKey: string, body: AdfDocument): AdfDocument {
  let draft = normalizeDocument("");
  try {
    draft = normalizeDocument(JSON.parse(localStorage.getItem(draftKey) ?? '""'));
  } catch {}
  const merged =
    adfToText(draft).trim() || documentHasMedia(draft)
      ? { ...draft, content: [...(draft.content ?? []), ...(body.content ?? [])] }
      : body;
  try {
    localStorage.setItem(draftKey, JSON.stringify(merged));
  } catch {}
  return merged;
}
/** An open composer takes the text back (and cancels the event); otherwise it waits in the issue's comment draft. */
function rejectComment(detail: RejectedComment) {
  const event = new CustomEvent(REJECTED_COMMENT, { detail, cancelable: true });
  if (dispatchEvent(event))
    restoreRejectedDraft(`better-jira:comment-draft:${state.namespace}:${detail.key}`, detail.body);
}
/** Drops an issue made here that Jira refused to create, so no ghost stays or is created again after reload (R1-D24). */
function discard(key: string, reopen = true) {
  const issue = state.issues.get(key),
    description = state.full.get(key)?.fields.description;
  const issues = new Map(state.issues),
    full = new Map(state.full);
  issues.delete(key);
  full.delete(key);
  changedKeys.delete(key);
  createdKeys.delete(key);
  localFields.delete(key);
  fullFields.delete(key);
  touch(key);
  set({ issues, full });
  if (state.selected === key) navigate({ selected: null, panel: false });
  queueSave();
  // The composer comes back with what was typed, so a create Jira refuses loses nothing (R2-comments-D3).
  if (reopen && issue && !state.overlay)
    beginCreate({
      title: issue.summary,
      descriptionDoc: description,
      attachments: issue.attachments,
      status: issue.status,
      type: issue.type,
      priority: issue.priority,
      assignee: issue.assignee,
      labels: issue.labels,
      parent: issue.parent,
      project: issue.project,
      due: issue.due,
      milestones: issue.milestones,
    });
}
export const dismissWriteError = () => set({ writeError: null });
/** A new issue's app key becomes Jira's key everywhere: issues, references, undo history and queued writes. */
function rekey(from: string, to: string) {
  const ids = new Map([[from, to]]),
    mentions = (v: unknown) => JSON.stringify(v).includes(`"${from}"`);
  const issues = new Map<string, Issue>(),
    full = new Map<string, Full>();
  // The issue under its app key carries the local edits: it wins over a copy the poll already brought under the Jira key,
  // except for fields edited on that copy before this tab learnt the move (sync review 4).
  const edited = <T>(value: T, copy: any, fields?: Set<string>, nested?: "fields"): T => {
    if (!copy || !fields?.size) return value;
    const picked = Object.fromEntries(
      [...fields].map((f) => [f, (nested ? copy[nested] : copy)[f]]),
    );
    return (
      nested
        ? { ...value, fields: { ...(value as any).fields, ...picked } }
        : { ...value, ...picked }
    ) as T;
  };
  for (const [k, v] of state.issues)
    if (k !== to || !state.issues.has(from))
      issues.set(
        ids.get(k) ?? k,
        edited(
          mentions(v) ? renameIds(v, ids) : v,
          k === from && state.issues.get(to),
          localFields.get(to),
        ),
      );
  for (const [k, v] of state.full)
    if (k !== to || !state.full.has(from))
      full.set(
        ids.get(k) ?? k,
        k === from
          ? edited(renameIds(v, ids), state.full.get(to), fullFields.get(to), "fields")
          : v,
      );
  for (const map of [localFields, fullFields] as Map<string, Set<string>>[]) {
    const v = map.get(from);
    if (v) {
      map.delete(from);
      map.set(to, new Set([...v, ...(map.get(to) ?? [])]));
    }
  }
  if (changedKeys.delete(from)) changedKeys.add(to);
  createdKeys.delete(from);
  touch(from, to);
  lastProperties.delete(from);
  const label = new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g");
  for (const list of [undo, redo])
    list.splice(
      0,
      list.length,
      ...list.map((edit) =>
        mentions(edit) ? { ...renameIds(edit, ids), label: edit.label.replace(label, to) } : edit,
      ),
    );
  for (const job of outbox) {
    job.key = ids.get(job.key) ?? job.key;
    job.ops = renameIds(job.ops, ids);
  }
  set({ issues, full });
  // Saved at once: other tabs wait for this move to send their edits of the issue (sync check 7).
  queueSave();
  ui.send({ type: "toast.rekey", from, to });
  if (state.selected === from) navigate({ selected: to });
}
/** Takes up key moves another tab saved for issues it created (app key → Jira key). Returns whether any was new. */
export function learnKeys(keys: Record<string, string> = {}) {
  let learned = false;
  for (const [from, to] of Object.entries(keys))
    if (!jiraKeys.has(from)) {
      jiraKeys.set(from, to);
      learned = true;
      if (state.issues.has(from)) rekey(from, to);
    }
  return learned;
}
/** Takes Jira's copy of what Jira owns, once no later write for the issue waits. `force` rolls a failed write back. */
function adopt(
  key: string,
  result: WriteResult,
  force: boolean,
  created = new Map<string, string>(),
  describes = false,
) {
  if (result.issue === undefined || (!force && outbox.some((job) => job.key === key))) return;
  touch(key);
  const issue = state.issues.get(key);
  if (result.issue === null) {
    // Gone from Jira (deleted there, or by this write).
    if (issue && !createdKeys.has(key)) {
      const issues = new Map(state.issues);
      issues.delete(key);
      set({ issues });
      if (state.selected === key) navigate({ selected: null, panel: false });
    }
    return;
  }
  if (!issue) return;
  if (result.full)
    result.issue.attachments = uploadedAttachments(key, result.full, issue.attachments);
  const local = localFields.get(key) ?? new Set(),
    fields: Record<string, unknown> = {};
  // Status dates come from the next property poll; keep the optimistic ones until then.
  for (const field of JIRA_ISSUE_FIELDS) {
    if (field in result.issue) fields[field] = (result.issue as any)[field];
    else if (!["statusSince", "started"].includes(field)) fields[field] = undefined;
    local.delete(field);
  }
  localFields.set(key, local);
  const next: Issue = { ...issue, ...fields } as Issue;
  // A rejected write's Activity entries go with it.
  if (result.error && issue.activity) {
    const activity = rollbackActivity(issue.activity, issue, fields, ME.id);
    if (activity !== issue.activity) next.activity = [...activity];
  }
  const full = state.full.get(key),
    patch: { issues: Map<string, Issue>; full?: Map<string, Full> } = {
      issues: new Map(state.issues),
    };
  if (result.full?.remotelinks)
    next.resources = withJiraLinks(issue.resources, result.full.remotelinks, true);
  if (full && result.full) {
    for (const field of ["description", "comment"]) fullFields.get(key)?.delete(field);
    const comment = result.full.fields?.comment,
      description = result.full.fields?.description,
      mine = full.fields.description;
    // Jira refused this description: keep it beside Jira's copy, so it's never silently lost, even unfocused or after a reload (R2-D2, R2-D4).
    const refused =
      !!result.error &&
      describes &&
      mine !== undefined &&
      JSON.stringify(normalizeDocument(mine)) !== JSON.stringify(normalizeDocument(description));
    patch.full = new Map(state.full).set(key, {
      ...full,
      fields: { ...full.fields, description, comment },
      descriptionBase: undefined,
      ...(refused ? { descriptionRejected: mine, descriptionError: result.error } : {}),
    });
    // Bodies and deletions now live in Jira; resolved, subscribed and reactions stay local.
    const states: Record<string, CommentState> = {};
    for (const [id, { body: _b, updated: _u, deleted, ...rest }] of Object.entries(
      issue.commentStates ?? {},
    )) {
      // A delete still held for undo has not reached Jira yet.
      const kept = heldDeletes.has(id) ? { ...rest, deleted } : rest;
      if (Object.keys(kept).length) states[created.get(id) ?? id] = kept;
    }
    next.commentStates = states;
    next.comments = visibleCommentTotal(comment?.total ?? 0, comment?.comments ?? [], states);
  }
  patch.issues.set(key, next);
  set(patch);
  queueSave();
}
export const pendingJiraWrites = () => outbox.length;
/** Whether the issue has edits Jira doesn't have yet, so restoring Jira's copy would change something. */
export const hasLocalJiraChanges = (key: string) =>
  [...(localFields.get(key) ?? [])].some((field) => JIRA_ISSUE_FIELDS.includes(field as never)) ||
  !!fullFields.get(key)?.size ||
  outbox.some((job) => job.key === key);
/** Drops the issue's queued Jira writes; one already being sent stops retrying (an unreachable server never got it). */
function cancelWrites(key: string) {
  for (let i = outbox.length - 1; i >= 0; i--)
    if (outbox[i]!.key === key) {
      if (outbox[i]!.started) outbox[i]!.cancelled = true;
      else outbox.splice(i, 1);
    }
  set({ pendingWrites: outbox.length });
}
export const dismissRecoveryNotice = () => storage.send({ type: "dismiss" });
export async function flushLocalChanges() {
  await waitFor(storage, (s) => !s.matches("saving"));
}
export async function retryLocalStorage() {
  if (storage.getSnapshot().matches("blocked")) {
    app.send({ type: "reload" });
    await waitFor(app, settled);
  } else {
    queueSave();
    await flushLocalChanges();
  }
}
export async function localFileURL(id: string) {
  return database?.fileURL(id);
}
export async function retainJiraFile(id: string, url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not retain attachment for undo.");
  await database?.retainFile(id, await response.blob());
}
export async function addLocalFiles(files: File[]) {
  if (!database || !state.canEdit)
    throw new Error("Local file storage is unavailable. Retry local storage first.");
  return database.addFiles(files);
}
export async function addLocalFile(file: File) {
  return (await addLocalFiles([file]))[0]!;
}
/** On a writable site a crop uploads as a new Jira attachment, which takes the original's place in the description. Read-only sites keep it as a local view edit. */
export async function saveCrop(key: string, id: string, crop: ImageCrop, file: File) {
  const edit = () => ({ ...state.issues.get(key)?.mediaEdits?.[id], crop });
  if (!state.writable) {
    actions.mediaEdit(key, id, edit());
    return;
  }
  const [saved] = await addLocalFiles([file]),
    issue = state.issues.get(key);
  if (!issue || !saved) return;
  let swapped = false;
  const swap = (node: any): any => {
    if (!node || typeof node !== "object") return node;
    if (["media", "mediaInline"].includes(node.type) && node.attrs?.id === id) {
      swapped = true;
      const { width, height } = node.attrs;
      return {
        ...node,
        attrs: {
          ...node.attrs,
          id: saved.id,
          collection: "local",
          localId: saved.id,
          ...(width && height
            ? { width: Math.round(width * crop.width), height: Math.round(height * crop.height) }
            : {}),
        },
      };
    }
    return Array.isArray(node.content) ? { ...node, content: node.content.map(swap) } : node;
  };
  const description = swap(normalizeDocument(state.full.get(key)?.fields.description));
  record(key, `crop image on ${key}`, () => {
    patchIssue(key, {
      attachments: [...(issue.attachments ?? []), saved],
      ...(swapped ? {} : { mediaEdits: { ...issue.mediaEdits, [id]: edit() } }),
    });
    if (swapped) patchFields(key, () => ({ description }));
  });
}
export async function restoreLocalFiles(files: NonNullable<Issue["attachments"]>) {
  return Promise.all(
    files.map(async (file) => {
      const url = await database?.fileURL(file.id);
      return { ...file, url: url ?? "", missing: !url };
    }),
  );
}
/** `clients` name each upload (see draft-uploads), so cleanup can find what it made by id. */
export async function addIssueFiles(key: string, files: File[], clients?: string[]) {
  if (!database || !state.canEdit)
    throw new Error("Local file storage is unavailable. Retry local storage first.");
  const db = database,
    // On a writable site the files go to Jira now, so a failed upload shows on the file (Retry, Discard) before anything looks saved.
    saved =
      state.writable && !createdKeys.has(key)
        ? await uploadNow(key, files, (files) => db.addFiles(files), clients)
        : await db.addFiles(files),
    issue = state.issues.get(key);
  if (issue)
    record(key, `attached files to ${key}`, () =>
      patchIssue(key, { attachments: [...(issue.attachments ?? []), ...saved] }),
    );
  return saved;
}
export async function downloadLocalBackup() {
  try {
    const { backupArchive } = await import("./backup-archive");
    const data = {
      version: 2,
      namespace: state.namespace,
      state: localSnapshot(),
      recovery: await database?.recoveryCopies(),
    };
    const url = URL.createObjectURL(backupArchive(data, (await database?.fileBlobs()) ?? [])),
      a = document.createElement("a");
    a.href = url;
    a.download = "better-jira-local-backup.tar";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    set({ perf: "Could not export the local backup" });
  }
}
export function jiraIssueURL(key: string) {
  return `${state.site}/browse/${encodeURIComponent(key)}`;
}
/** The issue in this app, for links that open here (and in a new tab with ⌘-click). */
export function appURL(issue: Issue) {
  const url = new URL(location.origin);
  url.searchParams.set("board", String(issue.board));
  url.searchParams.set("issue", issue.key);
  return url.href;
}
export function issueURL(issue: Issue) {
  return createdKeys.has(issue.key) && typeof location !== "undefined"
    ? appURL(issue)
    : jiraIssueURL(issue.key);
}
export const isLocalIssue = (key: string) => createdKeys.has(key);
const snapshot = (key: string): Snapshot => ({
  issue: state.issues.get(key),
  full: state.full.get(key),
  issueFields: [...(localFields.get(key) ?? [])],
  fullFields: [...(fullFields.get(key) ?? [])],
});
let lastEditGroup: string | undefined;
let transaction: { label: string; before: Map<string, Snapshot> } | null = null;
function record(
  key: string | string[],
  label: string,
  fn: () => void,
  group?: string,
  quiet = false,
) {
  if (!state.canEdit) {
    set({ perf: "Local editing is paused until saved data is available" });
    return;
  }
  const keys = typeof key === "string" ? [key] : key;
  const nested = transaction !== null;
  transaction ??= { label, before: new Map() };
  for (const key of keys)
    if (!transaction.before.has(key)) transaction.before.set(key, snapshot(key));
  if (nested) {
    fn();
    return;
  }
  try {
    fn();
    const changed = [...transaction.before.keys()].filter((key) => {
      const before = transaction!.before.get(key)!,
        after = snapshot(key);
      return before.issue !== after.issue || before.full !== after.full;
    });
    if (!changed.length) return;
    for (const key of changed) {
      changedKeys.add(key);
      editCounts.set(key, (editCounts.get(key) ?? 0) + 1);
    }
    touch(...changed);
    if (!quiet) send(changed.map((key) => [key, transaction!.before.get(key)!, snapshot(key)]));
    const previous = undo.at(-1);
    if (
      group &&
      group === lastEditGroup &&
      previous &&
      JSON.stringify(previous.keys) === JSON.stringify(changed)
    )
      previous.after = changed.map(snapshot);
    else
      undo.push({
        tab: undoTab,
        keys: changed,
        label,
        before: changed.map((key) => transaction!.before.get(key)!),
        after: changed.map(snapshot),
      });
    lastEditGroup = group;
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    set({ undoCount: undo.length, redoCount: 0 });
    queueSave();
  } finally {
    transaction = null;
  }
}
function restore(edit: LocalEdit, snapshots: Snapshot[]) {
  lastEditGroup = undefined;
  // Jira gets this edit's inverse alone, so comments, labels, files or links others added since are never removed.
  const [from, to] =
    snapshots === edit.before ? [edit.after, edit.before] : [edit.before, edit.after];
  const current = edit.keys.map(snapshot);
  // With Jira writes, undo reverts only the fields this edit changed, so it never overwrites newer Jira values.
  if (state.writable)
    snapshots = edit.keys.map((key, index) => {
      const target = snapshots[index]!,
        now = current[index]!,
        before = edit.before[index]!,
        after = edit.after[index]!;
      if (!target.issue || !now.issue) return target;
      const changed = (a: any, b: any, field: string) =>
        JSON.stringify(a?.[field]) !== JSON.stringify(b?.[field]);
      const issue = { ...now.issue };
      for (const field of new Set([
        ...Object.keys(before.issue ?? {}),
        ...Object.keys(after.issue ?? {}),
      ]))
        if (changed(before.issue, after.issue, field))
          (issue as any)[field] = (target.issue as any)[field];
      const full =
        now.full && target.full ? { ...now.full, fields: { ...now.full.fields } } : target.full;
      // Comment edits and deletes live in commentStates; once Jira has them, undo needs the comment list back too.
      const commentEdit = changed(before.issue, after.issue, "commentStates");
      if (full && now.full)
        for (const field of new Set([
          ...Object.keys(before.full?.fields ?? {}),
          ...Object.keys(after.full?.fields ?? {}),
        ]))
          if (
            changed(before.full?.fields, after.full?.fields, field) ||
            (field === "comment" && commentEdit)
          )
            full.fields[field] = target.full!.fields[field];
      return { ...target, issue, full };
    });
  for (const key of edit.keys)
    try {
      const prefix = `better-jira:resource-draft:${state.namespace}:${key}:`;
      for (const name of Object.keys(localStorage))
        if (name.startsWith(prefix)) localStorage.removeItem(name);
    } catch {}
  const issues = new Map(state.issues),
    full = new Map(state.full);
  touch(...edit.keys);
  // Undo and redo are edits too: a Restore reading Jira's version meanwhile must not discard them (sync review 7).
  for (const key of edit.keys) editCounts.set(key, (editCounts.get(key) ?? 0) + 1);
  edit.keys.forEach((key, index) => {
    const snapshot = snapshots[index]!;
    if (snapshot.issue) issues.set(key, snapshot.issue);
    else issues.delete(key);
    if (snapshot.full) full.set(key, snapshot.full);
    else full.delete(key);
    if (snapshot.issueFields) localFields.set(key, new Set(snapshot.issueFields));
    if (snapshot.fullFields) fullFields.set(key, new Set(snapshot.fullFields));
  });
  set({ issues, full });
  ui.send({ type: "overlay.close" });
  send(edit.keys.map((key, index) => [key, from[index]!, to[index]!]));
  // The write's answer brings Jira's copy; a refresh before it lands would show the undone value again (R1-D16).
  for (const key of edit.keys)
    if (state.issues.has(key) && !createdKeys.has(key) && !outbox.some((job) => job.key === key))
      needsFullRefresh.add(key);
  if (state.selected && !issues.has(state.selected)) navigate({ selected: null, panel: false });
}
/** Jira can't restore a deleted issue; undo or redo would only create a copy under a new key. Issues made here (PREFIX-NEWn) can be re-created. */
function revivesJiraIssue(edit: LocalEdit, target: Snapshot[]) {
  const source = target === edit.before ? edit.after : edit.before;
  return (
    state.writable &&
    edit.keys.some(
      (key, index) => target[index]?.issue && !source[index]?.issue && !/-NEW\d+$/.test(key),
    )
  );
}
export function undoEdit() {
  const edit = undo.pop();
  if (!edit) return;
  if (revivesJiraIssue(edit, edit.before)) {
    set({
      undoCount: undo.length,
      perf: `Can't undo ${edit.label}: Jira can't restore deleted issues.`,
    });
    queueSave();
    return;
  }
  restore(edit, edit.before);
  redo.push(edit);
  set({ undoCount: undo.length, redoCount: redo.length, perf: `Undid ${edit.label}` });
  // Undoing a create removes the issue its toast offers to open.
  if (state.toast?.key && !state.issues.has(currentKey(state.toast.key)))
    ui.send({ type: "toast.dismiss" });
  queueSave();
}
export function redoEdit() {
  const edit = redo.pop();
  if (!edit) return;
  if (revivesJiraIssue(edit, edit.after)) {
    set({
      redoCount: redo.length,
      perf: `Can't redo ${edit.label}: Jira can't restore a deleted issue; create it again to get a new key.`,
    });
    queueSave();
    return;
  }
  restore(edit, edit.after);
  undo.push(edit);
  set({ undoCount: undo.length, redoCount: redo.length, perf: `Redid ${edit.label}` });
  queueSave();
}
export function beginCreate(draft: IssueDraft = {}) {
  if (!state.canEdit) {
    set({ perf: "Retry local storage before creating an issue" });
    return;
  }
  const prefs = preferencesFor(state.board),
    board = state.boards.find((b) => b.id === state.board);
  const status =
    prefs.scope === "active"
      ? board?.columns
          .find((c) => !/backlog/i.test(c.name) && c.statuses.some((s) => s.category !== "done"))
          ?.statuses.find((s) => s.category !== "done")?.id
      : undefined;
  ui.send({
    type: "overlay.open",
    overlay: "create",
    draft: { ...(status ? { status } : {}), ...(state.mine ? { assignee: ME } : {}), ...draft },
  });
}
/** Boards are favourited once, not per tab; older `board:<id>:<tab>` entries collapse into `board:<id>`. */
function readFavorites(): string[] {
  try {
    const values = JSON.parse(savedValue("better-jira:favorites:v1") ?? "[]");
    return Array.isArray(values)
      ? [
          ...new Set(
            values
              .filter((v) => typeof v === "string")
              .map((v) => v.replace(/^(board:\d+):.*$/, "$1")),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
/** Toggles against the stored list, so another tab's favorites aren't overwritten (R2-issue-fields-D1). */
export function toggleFavorite(id: string) {
  const favorites = readFavorites();
  set({
    favorites: favorites.includes(id) ? favorites.filter((v) => v !== id) : [...favorites, id],
  });
}
if (typeof addEventListener === "function")
  addEventListener("storage", (event: StorageEvent) => {
    if (event.key === preferenceKey("better-jira:favorites:v1"))
      set({ favorites: readFavorites() });
  });
const viewError = (e: unknown) =>
  set({ perf: e instanceof Error ? e.message : "Could not save view" });
async function viewRequest<T>(path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/views${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(
      `Could not ${method === "GET" ? "load" : "save"} views (${response.status})`,
    );
  return response.status === 204 ? (undefined as T) : response.json();
}
export async function refreshSavedViews(migrate = false) {
  if (migrate) {
    const key = preferenceKey("better-jira:saved-views:v1");
    const marker = `${key}:imported`;
    if (localStorage.getItem(marker) !== "1") {
      const legacy = migrateLegacyViews(localStorage.getItem(key));
      await viewRequest("/import", "POST", legacy);
      // Retain the old source as a backup; never overwrite it with server state.
      localStorage.setItem(marker, "1");
    }
  }
  const savedViews = await viewRequest<SavedView[]>();
  if (viewWrites.size) return; // A focus read must not replace a display edit still being saved.
  set({
    savedViews,
    favorites: readFavorites().filter(
      (id) => !id.startsWith("view:") || savedViews.some((v) => `view:${v.id}` === id),
    ),
  });
  if (state.activeViewId && !savedViews.some((v) => v.id === state.activeViewId))
    navigate({ board: state.board });
}
export function createViewDraft(
  kind: SavedView["kind"] = "custom",
  board = state.board,
): ViewDraft {
  const p = effectivePreferencesFor(board);
  return structuredClone({
    board,
    kind,
    name: "",
    description: "",
    icon: "filter",
    color: "gray",
    filters: p.filters,
    display: p.display,
    scope: p.scope,
    mine: state.mine,
  });
}
export function editViewDraft(id: string): ViewDraft {
  const v = state.savedViews.find((v) => v.id === id);
  if (!v) throw new Error("View not found");
  const { createdAt: _created, updatedAt: _updated, ...draft } = structuredClone(v);
  return draft;
}
export function duplicateViewDraft(id: string): ViewDraft {
  const { id: _id, ...draft } = editViewDraft(id);
  return { ...draft, name: "", description: "" };
}
export async function createSavedView(draft: ViewDraft): Promise<string> {
  const view = await viewRequest<SavedView>("", "POST", draft);
  set({
    savedViews: [...state.savedViews.filter((v) => v.id !== view.id), view],
  });
  return view.id;
}
const viewWrites = new Map<string, Promise<unknown>>();
export async function updateSavedView(id: string, patch: Partial<ViewDraft>): Promise<string> {
  const old = state.savedViews.find((v) => v.id === id);
  if (!old) throw new Error("View not found");
  const optimistic = { ...old, ...patch, id };
  set({
    savedViews: state.savedViews.map((v) => (v.id === id ? optimistic : v)),
  });
  const request = (viewWrites.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(() => viewRequest<SavedView>(`/${encodeURIComponent(id)}`, "PUT", patch));
  viewWrites.set(id, request);
  try {
    const view = await request;
    set({
      savedViews: state.savedViews.map((v) => (v === optimistic ? view : v)),
    });
    return id;
  } catch (e) {
    set({
      savedViews: state.savedViews.map((v) => (v === optimistic ? old : v)),
    });
    throw e;
  } finally {
    if (viewWrites.get(id) === request) viewWrites.delete(id);
  }
}
export async function saveViewDraft(draft: ViewDraft): Promise<string> {
  return draft.id ? updateSavedView(draft.id, draft) : createSavedView(draft);
}
export async function deleteSavedView(id: string) {
  await viewRequest(`/${encodeURIComponent(id)}`, "DELETE");
  if (state.activeViewId === id) navigate({ board: state.board });
  set({
    savedViews: state.savedViews.filter((v) => v.id !== id),
    favorites: readFavorites().filter((v) => v !== `view:${id}`),
  });
}
export function clearOverlay() {
  set({ overlayFilters: emptyOverlay() });
}
export async function saveOverlayToView() {
  const v = state.savedViews.find((v) => v.id === state.activeViewId);
  if (!v) return;
  await updateSavedView(v.id, {
    filters: mergeFilters(v.filters, state.overlayFilters),
  });
  clearOverlay();
}
export async function createViewFromCurrent(
  name: string,
  kind: SavedView["kind"] = "custom",
): Promise<string> {
  const id = await createSavedView({ ...createViewDraft(kind), name });
  openSavedView(id);
  return id;
}
export async function saveView(name: string) {
  try {
    return await createViewFromCurrent(name);
  } catch (e) {
    viewError(e);
  }
}
export function openSavedView(view: SavedView | string) {
  const v = typeof view === "string" ? state.savedViews.find((v) => v.id === view) : view;
  if (!v) return;
  // One history entry, with identity installed before UI view changes can persist defaults.
  if (state.editorDraft) clearEditorSession();
  const previous = restoringNavigation;
  restoringNavigation = true;
  commit({ editorDraft: null, activeViewId: v.id, viewsPage: false, overlayFilters: emptyOverlay() });
  ui.send({
    type: "navigate",
    board: v.board,
    selected: null,
    panel: false,
    inbox: false,
    view: v.display.openIn,
  });
  ui.send({ type: "mine.set", mine: v.mine });
  ui.send({ type: "toolbar.close" });
  restoringNavigation = previous;
  if (navigationReady) syncNavigation();
}

function patchIssue(key: string, patch: Partial<Issue>) {
  const i = state.issues.get(key);
  if (i) {
    const prior = i.activity ?? [],
      activity = recordActivity(prior, i, patch, ME, now(), () => crypto.randomUUID());
    if (activity !== prior) patch = { ...patch, activity: [...activity] };
    localFields.set(
      key,
      new Set([...(localFields.get(key) ?? []), ...Object.keys(patch), "updated"]),
    );
    set({ issues: new Map(state.issues).set(key, { ...i, ...patch, updated: now() }) });
  }
}

function patchFields(key: string, fn: (fields: any) => object) {
  const f = state.full.get(key);
  if (f) {
    const patch = fn(f.fields),
      // The first unsent description edit remembers Jira's text it started from.
      base =
        "description" in patch && !fullFields.get(key)?.has("description")
          ? { descriptionBase: f.fields.description }
          : {};
    fullFields.set(key, new Set([...(fullFields.get(key) ?? []), ...Object.keys(patch)]));
    set({
      full: new Map(state.full).set(key, { ...f, ...base, fields: { ...f.fields, ...patch } }),
    });
  }
}

export const isWatching = (issue: Issue) =>
  issue.watchers ? issue.watchers.some((u) => u.id === ME.id) : !!issue.watching;
export const boardOf = (key: string) =>
  state.boards.find((b) => b.id === state.issues.get(key)?.board);

let localSeq = 0;
/** Local edits per issue in this tab, so a slow read can tell whether the issue was edited meanwhile. */
const editCounts = new Map<string, number>();
/** Issues another open tab made and is still creating in Jira, with that tab's id: edits here wait for the Jira key it gets. */
const othersCreating = new Map<string, string>();
/** Submission id → the issue it created. */
const submissions = new Map<string, string>();
/** Local numbers (PREFIX-NEWn keys, local comment ids) come from blocks this tab reserves in IndexedDB, one transaction per
 * block, so two tabs never mint the same one (sync review 2). */
const NUMBER_BLOCK = 50;
let numbers = { next: 0, end: 0 },
  reserving: Promise<void> | undefined;
function reserveNumbers() {
  return (reserving ??= (async () => {
    try {
      const first = await database!.reserve(NUMBER_BLOCK, localSeq);
      numbers = { next: first, end: first + NUMBER_BLOCK };
    } catch {
    } finally {
      reserving = undefined;
    }
  })());
}
function nextSeq() {
  let n: number;
  if (numbers.next < numbers.end) n = numbers.next++;
  // No shared storage, so no other tab to clash with: count on.
  else if (!database) n = localSeq + 1;
  // ponytail: the block ran out before the next one arrived (dozens of creates within one IndexedDB write); a random number
  // well past the blocks stands in. Reserve larger blocks if this ever shows.
  else n = 1_000_000 + Math.floor(Math.random() * 9_000_000);
  if (database && numbers.end - numbers.next < NUMBER_BLOCK / 2) void reserveNumbers();
  localSeq = Math.max(localSeq, n);
  return n;
}

// Local overrides are saved separately from the read-only Jira mirror.
export const actions = {
  /** `document` targets one of the issue's documents, as Linear's document Remind me does. */
  remind(key: string, at: string | null, document?: string) {
    if (at !== null && (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now())) return;
    const reminder = at ? { at } : null,
      issue = state.issues.get(key);
    record(key, `${at ? "set" : "cancel"} reminder on ${key}`, () =>
      patchIssue(
        key,
        document
          ? {
              resources: issue?.resources?.map((r) =>
                r.id === document ? { ...r, reminder } : r,
              ),
            }
          : { reminder },
      ),
    );
    ui.send({
      type: "toast.show",
      text: at ? "Reminder set" : "Reminder canceled",
      ...(at ? { detail: `You will receive a reminder on ${reminderTime(at)}` } : {}),
    });
  },
  deliverReminder(key: string, document?: string) {
    const issue = state.issues.get(key),
      target = document ? issue?.resources?.find((r) => r.id === document) : issue;
    if (
      !state.canEdit ||
      !issue ||
      !target?.reminder ||
      target.reminder.delivered ||
      Date.parse(target.reminder.at) > Date.now()
    )
      return;
    // Delivery is a fact, not a user edit. Preserve it in historical snapshots without adding an undo step.
    const deliver = <T extends { reminder?: { at: string; delivered?: boolean } | null }>(
      item: T,
    ): T =>
      item.reminder && Date.parse(item.reminder.at) <= Date.now()
        ? { ...item, reminder: { ...item.reminder, delivered: true } }
        : item;
    const delivered = (item: Issue): Issue =>
      document
        ? { ...item, resources: item.resources?.map((r) => (r.id === document ? deliver(r) : r)) }
        : deliver(item);
    for (const edit of [...undo, ...redo])
      for (const entry of [...edit.before, ...edit.after])
        if (entry.issue?.key === key) entry.issue = delivered(entry.issue);
    const next = delivered(issue);
    patchIssue(key, document ? { resources: next.resources } : { reminder: next.reminder });
    changedKeys.add(key);
    touch(key);
    queueSave();
    ui.send({
      type: "toast.show",
      text: `Reminder: ${document ? (target as IssueResource).title || "New document" : issue.summary}`,
      key,
    });
  },
  /** False when the issue already has this URL. */
  resource(key: string, resource: IssueResource) {
    const issue = state.issues.get(key);
    if (!issue) return false;
    if (
      resource.url &&
      (issue.resources?.some((r) => r.url === resource.url) || issue.links?.includes(resource.url))
    )
      return false;
    record(
      key,
      `${resource.kind === "document" ? "create document" : "add resource"} on ${key}`,
      () =>
        patchIssue(key, {
          resources: [...(issue.resources ?? []).filter((r) => r.id !== resource.id), resource],
        }),
    );
    return true;
  },
  /** A link's fetched preview is display only: not an edit, so it never marks the issue changed or sends it to Jira (R1-D1). */
  linkPreview(key: string, id: string, preview: LinkPreview) {
    const issue = state.issues.get(key);
    if (!issue?.resources?.some((r) => r.id === id && r.kind !== "document")) return;
    const add = (item: Issue): Issue => ({
      ...item,
      resources: item.resources?.map((r) => (r.id === id ? { ...r, preview } : r)),
    });
    for (const edit of [...undo, ...redo])
      for (const entry of [...edit.before, ...edit.after])
        if (entry.issue?.key === key) entry.issue = add(entry.issue);
    set({ issues: new Map(state.issues).set(key, add(issue)) });
  },
  removeResource(key: string, id: string) {
    const issue = state.issues.get(key),
      resource = issue?.resources?.find((r) => r.id === id);
    if (!issue || !resource) return;
    const resources = issue.resources?.filter((r) => r.id !== id),
      removed = resourceMediaIds(resource),
      retained = resourceMediaIds(state.full.get(key)?.fields.description);
    for (const other of resources ?? []) resourceMediaIds(other, retained);
    for (const comment of state.full.get(key)?.fields.comment?.comments ?? [])
      resourceMediaIds(comment.body, retained);
    record(
      key,
      `${resource.kind === "document" ? "delete document" : "remove resource"} ${resource.title || "New document"} on ${key}`,
      () =>
        patchIssue(key, {
          resources,
          attachments: issue.attachments?.filter((a) => !removed.has(a.id) || retained.has(a.id)),
        }),
    );
  },
  /** `restore` always keeps the replaced version, however recent the last edit was. */
  editResource(
    key: string,
    id: string,
    patch: Partial<Pick<IssueResource, "title" | "body">>,
    session?: string,
    restore = false,
  ) {
    const issue = state.issues.get(key),
      resource = issue?.resources?.find((r) => r.id === id);
    if (!issue || !resource) return;
    if (
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(resource[key as keyof IssueResource]) === JSON.stringify(value),
      )
    )
      return;
    const at = now(),
      history = resource.history ?? [];
    // Keep the version before a new editing session after a minute of inactivity.
    const replaced = { title: resource.title, body: normalizeDocument(resource.body) },
      last = history.at(-1);
    const checkpoint =
      (restore || Date.parse(at) - Date.parse(resource.updated) >= 60000) &&
      !!(resource.title || documentHasMedia(resource.body) || adfToText(resource.body)) &&
      !(
        last &&
        last.title === replaced.title &&
        JSON.stringify(normalizeDocument(last.body)) === JSON.stringify(replaced.body)
      );
    const revisions = checkpoint
      ? [
          ...history,
          {
            ...replaced,
            at: resource.updated,
            author: resource.editedBy ?? resource.owner ?? { ...ME },
          },
        ].slice(-100)
      : history;
    record(
      key,
      `edit document on ${key}`,
      () =>
        patchIssue(key, {
          resources: issue.resources?.map((r) =>
            r.id === id
              ? { ...r, ...patch, updated: at, editedBy: { ...ME }, history: revisions }
              : r,
          ),
        }),
      session,
    );
  },
  documentProperties(
    key: string,
    id: string,
    patch: Omit<DocumentProperties, "editedBy" | "history">,
  ) {
    const issue = state.issues.get(key);
    if (!issue?.resources?.some((r) => r.id === id && r.kind === "document")) return;
    record(key, `change document settings on ${key}`, () =>
      patchIssue(key, {
        resources: issue.resources?.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }),
    );
  },
  async restoreJira(key: string) {
    if (createdKeys.has(key) || !state.canEdit) return;
    const edits = editCounts.get(key);
    try {
      const [remote, full] = await Promise.all([
        fetchJson<Issue[]>("/api/issues"),
        fetchJson<Full>(`/api/issues/${encodeURIComponent(key)}`),
      ]);
      const issue = remote.find((i) => i.key === key);
      if (!issue) throw new Error("Issue is no longer in the Jira mirror");
      // An edit made after the click is newer than the choice to restore: keep it and say so (sync check 6).
      if (editCounts.get(key) !== edits) {
        ui.send({
          type: "toast.show",
          text: `Didn't restore ${key}`,
          detail:
            "You edited it while Jira's version loaded. Restore again to discard your changes.",
        });
        return;
      }
      // Jira already has this version: queued edits are dropped and nothing is written (R2-D3).
      cancelWrites(key);
      record(
        key,
        `restore Jira version of ${key}`,
        () => {
          localFields.set(key, new Set());
          fullFields.set(key, new Set());
          needsFullRefresh.delete(key);
          // The mirror's list carries no remote links: take them from the full record, or the restore would delete them in Jira (R2-issue-fields-D2).
          const current = state.issues.get(key);
          set({
            issues: new Map(state.issues).set(key, {
              ...issue,
              resources: withJiraLinks(current?.resources, full.remotelinks, true),
            }),
            full: new Map(state.full).set(key, full),
            perf: `Restored mirrored Jira version of ${key}`,
          });
          dispatchEvent(new CustomEvent("jira-restored", { detail: key }));
          ui.send({ type: "overlay.close" });
        },
        undefined,
        true,
      );
    } catch {
      ui.send({
        type: "toast.show",
        text: "Could not read the Jira version",
        detail: "Nothing was restored. Your local changes are still here.",
      });
    }
  },
  patch(
    key: string,
    patch: IssueDraft &
      Partial<
        Pick<
          Issue,
          "links" | "resources" | "relations" | "reactions" | "watchers" | "watchersComplete"
        >
      >,
  ) {
    timed(`edit ${key}`, () => record(key, `edit ${key}`, () => patchIssue(key, patch)));
  },
  /** `rank` places the card where it was dropped (manual ordering). */
  drop(key: string, boardId: number, groups: { by: Grouping; id: string }[], rank?: string) {
    const issue = state.issues.get(key),
      board = state.boards.find((b) => b.id === boardId);
    if (!issue || !board || issue.board !== boardId) return;
    // Jira only changes a type within its hierarchy level (no Subtask ↔ Task), like the type menu: a drop onto another level is ignored.
    const types = state.options.types?.[issue.project?.key ?? ""];
    if (
      types &&
      groups.some(
        ({ by, id }) =>
          by === "type" && id !== issue.type && !typeChoices(issue.type, types, []).includes(id),
      )
    )
      return;
    // One drag, including its column and row changes, is one undoable edit.
    record(key, `move ${key}`, () => {
      if (rank !== undefined) patchIssue(key, { rank });
      for (const { by, id } of groups) {
        const current = state.issues.get(key)!;
        if (by === "status") {
          const col = board.columns.findIndex((c) => c.name === id);
          if (col >= 0) actions.move(key, col);
        } else if (by === "category") {
          const status = board.columns.flatMap((c) => c.statuses).find((s) => s.category === id);
          if (status) actions.status(key, status.id);
        } else if (by === "assignee")
          actions.assign(
            key,
            id === "$none"
              ? null
              : id === ME.id
                ? ME
                : ([...state.issues.values()].find((i) => i.assignee?.id === id)?.assignee ?? null),
          );
        else if (by === "project")
          actions.patch(key, {
            project: [...state.issues.values()].find((i) => i.project?.key === id)?.project ?? null,
            milestones: [],
          });
        else if (by === "priority" || by === "type")
          actions.patch(key, { [by]: id === "$none" ? undefined : id });
        else if (by === "label")
          actions.patch(key, {
            labels: id === "$none" ? [] : [...new Set([...current.labels, id])],
          });
        else if (by === "parent") {
          let ancestor = id;
          const seen = new Set([key]);
          let cycle = false;
          while (ancestor && ancestor !== "$none") {
            if (seen.has(ancestor)) {
              cycle = true;
              break;
            }
            seen.add(ancestor);
            ancestor = state.issues.get(ancestor)?.parent ?? "";
          }
          if (!cycle) actions.patch(key, { parent: id === "$none" ? undefined : id });
        }
      }
    });
  },
  /** Move to a column's first status; no-op if the issue is already in that column. */
  move(key: string, col: number) {
    const c = boardOf(key)?.columns[col];
    if (c?.statuses[0] && !c.statuses.some((x) => x.id === state.issues.get(key)?.status))
      actions.status(key, c.statuses[0].id);
  },
  status(key: string, id: string) {
    const i = state.issues.get(key);
    const s = boardOf(key)
      ?.columns.flatMap((c) => c.statuses)
      .find((x) => x.id === id);
    ui.send({ type: "overlay.close" });
    if (!i || !s || i.status === id) return;
    timed(`move ${key} → ${s.name}`, () =>
      record(key, `move ${key}`, () =>
        patchIssue(key, {
          status: s.id,
          statusSince: now(),
          started: i.started ?? (s.category === "indeterminate" ? now() : undefined),
          resolved: s.category === "done" ? (i.resolved ?? now()) : null,
        }),
      ),
    );
  },
  assign(key: string, user: User | null) {
    timed(`assign ${key} → ${user?.name ?? "Unassigned"}`, () => {
      record(key, `assign ${key}`, () => patchIssue(key, { assignee: user }));
      ui.send({ type: "overlay.close" });
    });
  },
  summary(key: string, summary: string) {
    if (summary.trim() && summary !== state.issues.get(key)?.summary)
      timed(`edit ${key} summary`, () =>
        record(key, `rename ${key}`, () => patchIssue(key, { summary: summary.trim() })),
      );
  },
  mediaEdit(key: string, id: string, edit: MediaEdit) {
    const issue = state.issues.get(key);
    if (issue)
      record(key, `image edit on ${key}`, () =>
        patchIssue(key, { mediaEdits: { ...issue.mediaEdits, [id]: edit } }),
      );
  },
  /** restore: always keep the version being replaced (unless it is already the newest entry), even inside the one-minute window. */
  description(key: string, value: string | AdfDocument, restore = false) {
    const previous = normalizeDocument(state.full.get(key)?.fields.description);
    const document = normalizeDocument(value);
    // Any new version replaces one Jira refused: it is sent from Jira's copy, or is Jira's copy.
    const f = state.full.get(key);
    if (f?.descriptionRejected) {
      const { descriptionRejected: _r, descriptionError: _e, ...rest } = f;
      set({ full: new Map(state.full).set(key, rest) });
      if (state.writeError?.key === key) set({ writeError: null });
      touch(key);
      queueSave();
    }
    if (JSON.stringify(document) === JSON.stringify(previous)) {
      ui.send({ type: "description.editDone" });
      return;
    }
    timed(`edit ${key} description`, () =>
      record(key, `description on ${key}`, () => {
        patchFields(key, () => ({ description: document }));
        // Autosave writes often; one history entry per minute of editing keeps the revision list readable.
        const history = state.issues.get(key)?.descriptionHistory ?? [],
          last = history.at(-1),
          recent = !!last && Date.now() - Date.parse(last.at) < 60_000;
        const keep = restore
          ? !(
              last &&
              JSON.stringify(normalizeDocument(last.document ?? last.text)) ===
                JSON.stringify(previous)
            )
          : !recent;
        patchIssue(key, {
          description: adfToText(document),
          descriptionHistory: keep
            ? [...history, { text: adfToText(previous), document: previous, at: now() }]
            : history,
        });
        ui.send({ type: "description.editDone" });
      }),
    );
  },
  /** Use Jira's version: drops a refused description (and any unsaved text) into the description history, so it can still be restored. */
  discardDescription(key: string, unsaved?: AdfDocument) {
    const f = state.full.get(key),
      issue = state.issues.get(key),
      dropped = unsaved ?? f?.descriptionRejected;
    if (f?.descriptionRejected) {
      const { descriptionRejected: _r, descriptionError: _e, ...rest } = f;
      set({ full: new Map(state.full).set(key, rest) });
    }
    if (issue && dropped && adfToText(dropped) !== adfToText(f?.fields.description)) {
      const doc = normalizeDocument(dropped);
      changedKeys.add(key);
      set({
        issues: new Map(state.issues).set(key, {
          ...issue,
          descriptionHistory: [
            ...(issue.descriptionHistory ?? []),
            { text: adfToText(doc), document: doc, at: now() },
          ],
        }),
      });
    }
    if (state.writeError?.key === key) set({ writeError: null });
    touch(key);
    queueSave();
  },
  /** `replyTo` may be any comment in a thread; the reply is filed under the thread's Jira parent. */
  comment(key: string, value: string | AdfDocument, replyTo?: string): boolean {
    const body = typeof value === "string" ? textToAdf(value) : normalizeDocument(value);
    const parentId =
      replyTo &&
      replyParent(
        state.full.get(key)?.fields.comment?.comments ?? [],
        replyTo,
        state.issues.get(key)?.commentStates,
      );
    if (replyTo && !parentId) return false;
    if (
      (!adfToText(body).trim() && !documentHasMedia(body)) ||
      !state.full.has(key) ||
      !state.canEdit
    )
      return false;
    timed(`comment on ${key}`, () =>
      record(key, `comment on ${key}`, () => {
        const c = {
          id: `local-${nextSeq()}`,
          ...(parentId ? { parentId } : {}),
          author: { accountId: ME.id, displayName: ME.name, avatarUrls: { "48x48": ME.avatar } },
          body,
          created: now(),
        };
        patchFields(key, (f) => ({
          comment: {
            ...f.comment,
            comments: [...(f.comment?.comments ?? []), c],
            total: (f.comment?.total ?? 0) + 1,
          },
        }));
        patchIssue(key, { comments: (state.issues.get(key)?.comments ?? 0) + 1 });
      }),
    );
    return true;
  },
  commentState(key: string, id: string, patch: CommentState) {
    const issue = state.issues.get(key),
      full = state.full.get(key);
    if (!issue || !full) return;
    const comments = full.fields.comment?.comments ?? [];
    if (!comments.some((c: any) => c.id === id)) return;
    record(key, `update comment on ${key}`, () => {
      const commentStates = {
        ...issue.commentStates,
        [id]: { ...issue.commentStates?.[id], ...patch },
      };
      patchIssue(key, {
        commentStates,
        comments: visibleCommentTotal(
          full.fields.comment?.total ?? comments.length,
          comments,
          commentStates,
        ),
      });
    });
  },
  editComment(key: string, id: string, value: AdfDocument) {
    const comment = state.full.get(key)?.fields.comment?.comments?.find((c: any) => c.id === id),
      body = normalizeDocument(value);
    if (
      !comment ||
      comment.author?.accountId !== ME.id ||
      (!adfToText(body).trim() && !documentHasMedia(body))
    )
      return;
    actions.commentState(key, id, { body, updated: now() });
  },
  deleteComment(key: string, id: string) {
    const comment = state.full.get(key)?.fields.comment?.comments?.find((c: any) => c.id === id);
    // Linear confirms first and shows no toast; local undo history still covers it.
    if (comment?.author?.accountId === ME.id) actions.commentState(key, id, { deleted: true });
  },
  /** Removes files a comment draft uploaded and then dropped, unless the description, a comment or a resource shows them. */
  dropDraftFiles(key: string, ids: string[]) {
    const issue = state.issues.get(key),
      full = state.full.get(key);
    if (!issue) return;
    const used = resourceMediaIds(full?.fields.description);
    for (const c of full?.fields.comment?.comments ?? []) resourceMediaIds(c.body, used);
    for (const c of Object.values(issue.commentStates ?? {})) resourceMediaIds(c.body, used);
    for (const r of issue.resources ?? []) resourceMediaIds(r, used);
    const drop = new Set(ids.filter((id) => !used.has(id)));
    if (issue.attachments?.some((a) => drop.has(a.id)))
      record(key, `remove unused draft files from ${key}`, () =>
        patchIssue(key, { attachments: issue.attachments!.filter((a) => !drop.has(a.id)) }),
      );
  },
  /** Like Linear, creating from the composer stays on the board and confirms with a toast; `open` shows the new issue instead. */
  create(summary: string, draft: IssueDraft = {}, more = false, open = false) {
    if (!state.canEdit) return;
    // The submit itself is guarded, not just its button: one submission makes one issue (comments smoke F1).
    const made = draft.submission && submissions.get(draft.submission);
    if (made) return made;
    const board = state.boards.find((b) => b.id === state.board);
    const statuses = board?.columns.flatMap((c) => c.statuses) ?? [];
    const status = statuses.find((s) => s.id === draft.status) ?? statuses[0];
    if (!board || !status || !summary.trim()) return;
    const prefix =
      [...state.issues.values()].find((i) => i.board === board.id)?.key.split("-")[0] ?? "LOCAL";
    const key = `${prefix}-NEW${nextSeq()}`;
    createdKeys.add(key);
    if (draft.submission) submissions.set(draft.submission, key);
    const {
      descriptionDoc,
      related,
      title: _title,
      copy: _copy,
      submission: _submission,
      ...fields
    } = draft;
    const document = normalizeDocument(descriptionDoc ?? draft.description ?? "");
    timed(`create ${key}`, () =>
      record(key, `create ${key}`, () => {
        const issue: Issue = {
          key,
          board: board.id,
          summary: summary.trim(),
          type: "Task",
          priority: state.writable ? undefined : "Normal",
          assignee: null,
          labels: [],
          rank: "0",
          comments: 0,
          updated: now(),
          created: now(),
          statusSince: now(),
          creator: ME,
          milestones: [],
          prCount: 0,
          watchers: [],
          watchersComplete: true,
          project: [...state.issues.values()].find((i) => i.board === board.id)?.project,
          ...fields,
          description: adfToText(document),
          status: status.id,
          resolved: status.category === "done" ? now() : null,
        };
        const full: Full = {
          key,
          fields: {
            description: document,
            created: now(),
            comment: { comments: [], total: 0 },
            reporter: {
              accountId: ME.id,
              displayName: ME.name,
              avatarUrls: { "48x48": ME.avatar },
            },
          },
        };
        set({
          issues: new Map(state.issues).set(key, issue),
          full: new Map(state.full).set(key, full),
        });
        if (related && state.issues.has(related.key)) {
          if (related.kind === "parent") actions.patch(related.key, { parent: key });
          else actions.relate(key, related.key, related.kind);
        }
        // "Create more" keeps the composer open; otherwise open the issue, or stay on the board with a toast.
        if (!more) {
          navigate(open ? { selected: key, panel: true } : { selected: key });
          ui.send({ type: "overlay.close" });
        }
        // "Create more" keeps the composer open, so the toast is its only confirmation (Linear).
        if (more || !open) ui.send({ type: "toast.show", text: `Created ${key}`, key });
      }),
    );
    return key;
  },
  /** With Jira writes this only asks first (DeleteConfirm); the dialog calls back with `confirmed`. */
  remove(key: string, confirmed = false) {
    // Jira cannot restore a deleted issue; undo would only create a copy under a new key, re-posting comments as you.
    if (state.writable && !confirmed) {
      set({ deleting: key });
      return;
    }
    const related = [...state.issues.values()].filter(
      (i) => i.parent === key || i.relations?.some((r) => r.key === key),
    );
    record([key, ...related.map((i) => i.key)], `delete ${key}`, () => {
      for (const issue of related)
        patchIssue(issue.key, {
          ...(issue.parent === key ? { parent: undefined } : {}),
          relations: issue.relations?.filter((r) => r.key !== key),
        });
      const issues = new Map(state.issues),
        full = new Map(state.full);
      issues.delete(key);
      full.delete(key);
      set({
        issues,
        full,
        perf: state.writable ? `Deleted ${key} in Jira.` : `Deleted ${key}. Undo to restore.`,
      });
      // A sub-issue row's delete keeps its parent open.
      if (state.selected === key) navigate({ selected: null, panel: false });
      ui.send({ type: "overlay.close" });
    });
    if (state.writable && undo.at(-1)?.label === `delete ${key}`) {
      undo.pop();
      set({ undoCount: undo.length });
      queueSave();
    }
  },
  /** Linear's Make a copy: the composer, prefilled, saves the copy; nothing is created until then. */
  duplicate(key: string) {
    const issue = state.issues.get(key);
    if (!issue) return;
    navigate({ board: issue.board });
    beginCreate({
      title: `${issue.summary} (copy)`,
      copy: true,
      status: issue.status,
      assignee: issue.assignee,
      priority: issue.priority,
      labels: [...issue.labels],
      project: issue.project,
      milestones: issue.milestones,
      due: issue.due,
      parent: issue.parent,
      type: issue.type,
      descriptionDoc: normalizeDocument(
        state.full.get(key)?.fields.description ?? issue.description,
      ),
    });
  },
  relate(key: string, target: string, kind: string, remove = false) {
    if (key === target) return;
    const inverse = RELATION_ISSUE[kind] ?? kind;
    record([key, target], `${remove ? "remove" : "add"} relation`, () => {
      for (const [from, to, relation] of [
        [key, target, kind],
        [target, key, inverse],
      ] as const) {
        const issue = state.issues.get(from);
        if (
          !issue ||
          (issue.relations ?? []).some((r) => r.key === to && r.kind === relation) !== remove
        )
          continue;
        const relations = (issue.relations ?? []).filter(
          (r) => r.key !== to || r.kind !== relation,
        );
        if (!remove) relations.push({ key: to, kind: relation });
        patchIssue(from, {
          relations,
          activity: [
            ...recordRelation(
              issue.activity ?? [],
              { key: to, kind: relation },
              remove,
              ME,
              now(),
              () => crypto.randomUUID(),
            ),
          ],
        });
      }
    });
  },
};

/** Editor routes keep a detached draft, including toolbar changes, across history and reload. */
export function beginViewEditor(draft: ViewDraft) {
  const previous = restoringNavigation;
  restoringNavigation = true;
  commit({ editorDraft: structuredClone(draft), activeViewId: null, overlayFilters: emptyOverlay() });
  navigate({ board: draft.board, selected: null, panel: false, inbox: false });
  ui.send({ type: "mine.set", mine: draft.mine });
  restoringNavigation = previous;
  syncNavigation();
}
function clearEditorSession() {
  try { sessionStorage.removeItem(`view-editor:${state.namespace}:${location.pathname}`); } catch { /* Best effort. */ }
}
export function discardViewEditor() {
  const draft = state.editorDraft;
  if (!draft) return;
  clearEditorSession();
  const previous = restoringNavigation;
  restoringNavigation = true;
  commit({ editorDraft: null });
  restoringNavigation = previous;
  if (draft.id) openSavedView(draft.id);
  else navigate({ board: draft.board });
}
