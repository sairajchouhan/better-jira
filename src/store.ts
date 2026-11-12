import {
  cancelWrites,
  keyMoves,
  learnKeys,
  restartSync,
  resumeSync,
  touch,
  unsentWrites,
} from "./jira-sync";
import {
  addLocalFiles,
  flushLocalChanges,
  localDataBlocked,
  localFiles,
  nextSeq,
  openLocalData,
  queueSave,
  storage,
  unsavedLocalChanges,
} from "./local-database";
import {
  forgetLastEdit,
  loadHistory,
  record,
  rewriteHistoricIssue,
  savedHistory,
} from "./undo-history";
import {
  clearLocalEdits,
  editCount,
  isLocalIssue,
  markChanged,
  markCreated,
  mergeFull,
  mergeProperties,
  needsFull,
  patchFields,
  patchIssue,
  resetLocalEdits,
  savedChanges,
  withJiraLinks,
} from "./local-edits";
import { showNotification } from "./app-notifications";
import { assignableUsers, knownPeople, statusById, statuses } from "./board-catalog";
import { viewSettings } from "./view-settings";
import { navigate, startNavigation, ui } from "./app-navigation";
import { liveFavorites } from "./favorites";
import {
  loadSavedViews,
  refreshSavedViews,
  viewError,
} from "./saved-views";
import { useMemo, useSyncExternalStore } from "react";
import { adfToText } from "./adf";
import {
  defaultPreferences,
  parsePreferences,
  type Display,
  type Grouping,
  type Preferences,
} from "./view-model";
import { documentHasMedia, normalizeDocument, textToAdf, type AdfDocument } from "./document";
import { createActor, fromPromise, waitFor } from "xstate";
import { appMachine, inspector, type UiContext } from "./machines";
import type { Screen } from "./navigation";
import { QueryClient, QueryObserver } from "@tanstack/query-core";

import { reminderTime } from "./reminder-display";
import { typeChoices, childTypes, canHaveChildren } from "./issue-properties";
import { replyParent, visibleCommentTotal, type CommentState } from "./comment-thread";
import { type ImageCrop, type MediaEdit } from "./media-edits";

import {
  resourceMediaIds,
  type DocumentProperties,
  type IssueResource,
  type LinkPreview,
} from "./issue-resource";
import { RELATION_ISSUE, recordRelation, type PropertyActivity } from "./issue-activity";
import { uploadNow } from "./jira-media";
import type { PersonTab } from "./people";
import {
  persistPreferences,
  rememberViewDetails,
  savedBoard,
  savedDefaults,
  savedFavorites,
  savedOpenIn,
  savedSidebarHidden,
  savedViewPreferences,
  scopePreferences,
  viewDetailsOpen,
} from "./browser-preferences";
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
  /** Every comment's text, for search (BJ-27). */
  commentText?: string;
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
export type Board = {
  id: number;
  name: string;
  columns: Column[];
  /** Added in the app, so the sidebar can remove it (BJ-24). */
  removable?: boolean;
};
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
export type IssueDraft = Partial<
  Pick<
    Issue,
    | "board"
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
    | "resources"
  >
> & {
  description?: string;
  descriptionDoc?: AdfDocument;
  /** Make a copy: the composer starts with this title and saves with "Save copy". */
  title?: string;
  copy?: boolean;
  subIssues?: string[];
  /** Linear "Create related": link the new issue to this one in the same undo step. */ related?: {
    key: string;
    kind: "related" | "blocked" | "blocking" | "parent";
  };
  /** Names one submit of a composer: a second call with it (a double click before React re-renders) creates nothing. */
  submission?: string;
  /** "Create issue from selection" (BJ-69): the editor waiting to swap its selected text for a reference to the new issue. */
  fromSelection?: string;
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
  emptyOverlay,
  mergeFilters,
} from "./saved-view-model";

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
  viewsPage: boolean;
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
  viewsPage: false,
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
export const useStore = <T>(sel: (s: State) => T) =>
  useSyncExternalStore(subscribe, () => sel(state));
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

const app = createActor(appMachine.provide({ actors: { load: fromPromise(loadApplication) } }), {
  inspect: inspector("app"),
}).start();
app.subscribe(({ context }) => {
  if (context.error !== state.loadError) commit({ loadError: context.error });
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
/** Boards added or removed on the server since load, by this tab or another: the list, the new boards' issues (a removed
 *  board's leave), and their default view. */
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
  const removed = new Set([...known].filter((id) => !boards.some((b) => b.id === id)));
  if (removed.size) for (const [key, issue] of issues) if (removed.has(issue.board)) issues.delete(key);
  for (const b of boards)
    preferences[b.id] ??= {
      ...defaultPreferences(),
      display: parsePreferences({ display: state.defaults[b.id] }).display,
    };
  set({ boards, issues, preferences });
  if (removed.has(state.board) && boards[0])
    navigate({ board: boards[0].id, selected: null, panel: false });
}
/** Removes a board added in the app from the sidebar, in every tab (BJ-24). */
export async function removeBoard(id: number) {
  const response = await fetch(`/api/boards/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not remove the board. Retry in a moment.");
  }
  await refreshBoards();
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
/** Window listeners are added by the first load only; a storage retry loads again. */
let listening = false;
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
  scopePreferences(namespace);
  // Views load with the issues, so a view route paints as the view, never the plain board first.
  const [boards, remote, savedViews] = await Promise.all([
    fetchJson<Board[]>("/api/boards"),
    fetchJson<Issue[]>("/api/issues"),
    loadSavedViews(),
  ]);
  if (!boards.length)
    throw new Error("The Jira mirror is still syncing your boards. Retry in a moment.");
  const { local, start: startSaving } = await openLocalData(namespace, {
    snapshot: () => ({ changes: savedChanges(), ...savedHistory(), keys: keyMoves() }),
    moved: learnKeys,
  });
  const defaults = savedDefaults();
  const preferences = savedViewPreferences();
  for (const b of boards)
    if (!preferences[b.id]) {
      const display = parsePreferences({ display: defaults[b.id] }).display;
      if (!defaults[b.id]) display.openIn = savedOpenIn();
      preferences[b.id] = { ...defaultPreferences(), display };
    }
  const last = savedBoard();
  const board = boards.some((b) => b.id === last) ? last : boards[0]!.id;
  const issues = new Map(remote.map((i) => [i.key, i])),
    full = new Map<string, Full>();
  resetLocalEdits();
  restartSync(local, remote, issues, full, client.writable === true);
  // Undo covers this tab's own edits only, as Linear's per-client history does; a reload keeps them (R2-inbox-D3).
  const history = loadHistory(local);
  set({
    boards,
    site: client.site,
    namespace,
    writable: client.writable === true,
    issues,
    full,
    defaults,
    preferences,
    savedViews,
    favorites: liveFavorites(savedViews),
    ...history,
  });
  navigate({ board, view: preferences[board]?.display.openIn ?? "side" });
  startSaving();
  resumeSync(local.changes);
  if (!listening) {
    listening = true;
    window.addEventListener("focus", () => {
      void refreshSavedViews().catch(viewError);
    });
    startNavigation();
    window.addEventListener("beforeunload", (event) => {
      // Jobs waiting on another tab's create are saved, and replayed by whichever tab sends that create.
      if (unsavedLocalChanges() || unsentWrites()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
  startPoll();
  if (state.writable)
    void import("./draft-uploads").then(({ keepDraftUploadsClean }) =>
      keepDraftUploadsClean(namespace, () => JSON.stringify(savedChanges()), {
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
/** One property poll; the poll query schedules the next. */
async function fetchProperties(): Promise<{ pending: number }> {
  const res = await fetch("/api/properties");
  if (!res.ok) throw new Error("Properties unavailable");
  const data = await res.json();
  const { issues, deleted, stale } = mergeProperties(data.entries);
  if (state.selected && deleted.includes(state.selected)) {
    const key = state.selected;
    navigate({ selected: null, panel: false });
    showNotification({
      text: `${key} was deleted in Jira`,
      detail: "It is no longer on your boards.",
    });
  }
  set({ propertySync: data.progress, ...(issues ? { issues } : {}) });
  for (const key of stale)
    // The focused description takes Jira's newer text too: it asks before replacing what is being typed.
    if (
      key === state.selected &&
      (!document.activeElement?.closest?.(".rich-editor") ||
        document.activeElement.id === "description")
    )
      void loadFull(key);
  return data.progress;
}

export async function loadFull(key: string, force = false) {
  if (!needsFull(key, force)) return;
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
/** Loads an issue's Jira record and keeps local field edits on top. */
async function fetchFull(key: string) {
  const res = await fetch(`/api/issues/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error("Could not load issue details");
  mergeFull(key, await res.json());
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
export async function retryLocalStorage() {
  if (localDataBlocked()) {
    app.send({ type: "reload" });
    await waitFor(app, settled);
  } else {
    queueSave();
    await flushLocalChanges();
  }
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
/** `clients` name each upload (see draft-uploads), so cleanup can find what it made by id. */
export async function addIssueFiles(key: string, files: File[], clients?: string[]) {
  const keep = localFiles(),
    // On a writable site the files go to Jira now, so a failed upload shows on the file (Retry, Discard) before anything looks saved.
    saved =
      state.writable && !isLocalIssue(key)
        ? await uploadNow(key, files, keep, clients)
        : await keep(files),
    issue = state.issues.get(key);
  if (issue)
    record(key, `attached files to ${key}`, () =>
      patchIssue(key, { attachments: [...(issue.attachments ?? []), ...saved] }),
    );
  return saved;
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
  return isLocalIssue(issue.key) && typeof location !== "undefined"
    ? appURL(issue)
    : jiraIssueURL(issue.key);
}
/** Opens the create composer; false when local storage refused it. */
export function beginCreate(draft: IssueDraft = {}): boolean {
  if (!state.canEdit) {
    set({ perf: "Retry local storage before creating an issue" });
    return false;
  }
  const prefs = viewSettings(state.board, state),
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
  return true;
}

export const isWatching = (issue: Issue) =>
  issue.watchers ? issue.watchers.some((u) => u.id === ME.id) : !!issue.watching;
export const boardOf = (key: string) =>
  state.boards.find((b) => b.id === state.issues.get(key)?.board);
/** The issue's status on its own board. */
export const statusOf = (i: Issue) => statusById(boardOf(i.key), i.status);

/** Submission id → the issue it created. */
const submissions = new Map<string, string>();

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
    showNotification({
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
    rewriteHistoricIssue(key, delivered);
    const next = delivered(issue);
    patchIssue(key, document ? { resources: next.resources } : { reminder: next.reminder });
    markChanged(key);
    touch(key);
    queueSave();
    showNotification({
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
    rewriteHistoricIssue(key, add);
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
    if (isLocalIssue(key) || !state.canEdit) return;
    const edits = editCount(key);
    try {
      const [remote, full] = await Promise.all([
        fetchJson<Issue[]>("/api/issues"),
        fetchJson<Full>(`/api/issues/${encodeURIComponent(key)}`),
      ]);
      const issue = remote.find((i) => i.key === key);
      if (!issue) throw new Error("Issue is no longer in the Jira mirror");
      // An edit made after the click is newer than the choice to restore: keep it and say so (sync check 6).
      if (editCount(key) !== edits) {
        showNotification({
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
          clearLocalEdits(key);
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
      showNotification({
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
          const status = statuses(board).find((s) => s.category === id);
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
    const s = statusById(boardOf(key), id);
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
      markChanged(key);
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
    const board = state.boards.find((b) => b.id === (draft.board ?? state.board));
    const status = statusById(board, draft.status) ?? statuses(board)[0];
    if (!board || !status || !summary.trim() || (draft.subIssues?.some(title => title.trim()) && !canHaveChildren(state, draft))) return;
    const prefix =
      [...state.issues.values()].find((i) => i.board === board.id)?.key.split("-")[0] ?? "LOCAL";
    const key = `${prefix}-NEW${nextSeq()}`;
    markCreated(key);
    if (draft.submission) submissions.set(draft.submission, key);
    const {
      descriptionDoc,
      related,
      subIssues,
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
        for (const [index, title] of (subIssues ?? []).entries()) {
          if (title.trim()) actions.create(title, {
            submission: draft.submission ? `${draft.submission}:child:${index}` : undefined,
            board: board.id,
            parent: key,
            project: issue.project,
            type: childTypes(state, issue)?.[0] ?? "Task",
          }, true);
        }
        // "Create more" keeps the composer open; otherwise open the issue, or stay on the board with a toast.
        if (!more) {
          navigate(open ? { selected: key, panel: true } : { selected: key });
          ui.send({ type: "overlay.close" });
        }
        // "Create more" keeps the composer open, so the toast is its only confirmation (Linear).
        if (more || !open) showNotification({ text: `Created ${key}`, key });
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
    if (state.writable) forgetLastEdit(`delete ${key}`);
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
  /** Turn a relation into another kind as one undoable edit (BJ-52, Linear's relation pill › Change to…). */
  changeRelation(key: string, target: string, from: string, to: string) {
    record([key, target], "change relation", () => {
      actions.relate(key, target, from, true);
      actions.relate(key, target, to);
    });
  },
};

