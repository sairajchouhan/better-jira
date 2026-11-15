import { type Board, type Full, type Issue } from "@/shared/issue-model";
import type { KeptOutcome } from "@/shared/inbox-model";
/**
 * Reading the server's mirror of Jira. Reads go through TanStack Query, which dedupes loads in flight; the property poll
 * merges Jira's changes into the issues (keeping local edits on top, see local-edits.ts) and runs at once when the
 * server's event stream says Jira changed. Boards are added and removed here too, for every tab.
 */
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { defaultPreferences, parsePreferences } from "@/shared/view-model";
import { mergeFull, mergeProperties, needsFull } from "./local-edits";
import { navigate } from "@/client/features/navigation/app-navigation";
import { issuesDeletedInJira } from "./deleted-issues";
import { get, set, subscribe } from "./store";
import { firstSyncNote, syncProblem } from "./sync-problem";
import { rejoinBoards } from "@/shared/board-membership";

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
export function startPoll() {
  if (polling) void poll.refetch();
  else {
    queryClient.mount();
    // A failed poll means the server itself is gone; the next good one clears the warning.
    polling = poll.subscribe((result) => {
      const problem = syncProblem(undefined, true);
      if (result.isError && problem !== get().syncProblem) set({ syncProblem: problem });
    });
    listen();
    subscribe(listen);
    document.addEventListener("visibilitychange", listen);
  }
}
const eventHandlers = new Map<"views", () => void>();
/** Runs `handler` when the server's event stream sends `kind`: "views" when any tab saved, renamed or deleted a view. */
export const onServerEvent = (kind: "views", handler: () => void) => void eventHandlers.set(kind, handler);
/** The server pushes "changed" when Jira did, so the poll runs at once; the timer is only a backstop. A visible tab stays connected, naming its open issue,
 * which the server then checks every few seconds; a hidden tab disconnects, letting the server poll Jira slowly. */
let events: EventSource | undefined, eventsFor: string | undefined;
function listen() {
  const wanted = document.visibilityState === "visible" ? (get().selected ?? "") : undefined;
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
        : e.data === "views"
          ? eventHandlers.get("views")?.()
          : poll.refetch());
}
/** Boards added or removed on the server since load, by this tab or another: the list, the new boards' issues (a removed
 *  board's leave), and their default view. */
async function refreshBoards() {
  const [boards, remote] = await Promise.all([
    json<Board[]>("/api/boards"),
    json<Issue[]>("/api/issues"),
  ]);
  const known = new Set(get().boards.map((b) => b.id)),
    removed = new Set([...known].filter((id) => !boards.some((b) => b.id === id))),
    issues = rejoinBoards(get().issues, remote, known, removed),
    preferences = { ...get().preferences };
  for (const b of boards)
    preferences[b.id] ??= {
      ...defaultPreferences(),
      display: parsePreferences({ display: get().defaults[b.id] }).display,
    };
  set({ boards, issues, preferences });
  if (removed.has(get().board) && boards[0])
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
export const fetchJson = <T>(path: string, staleTime = 0) =>
  queryClient.fetchQuery<T>({ queryKey: [path], queryFn: () => json<T>(path), staleTime });
/** A JSON read; a refusal throws the server's own reason (a rejected token, an unreachable Jira), not the path. */
async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : `Could not load ${path}`);
  }
  return response.json();
}
/** One property poll; the poll query schedules the next. */
async function fetchProperties(): Promise<{ pending: number }> {
  const res = await fetch("/api/properties");
  if (!res.ok) throw new Error("Properties unavailable");
  const data = await res.json();
  const problem = syncProblem(data.sync, false),
    firstSync = firstSyncNote(data.sync);
  if (problem !== get().syncProblem) set({ syncProblem: problem });
  if (firstSync !== get().firstSync) set({ firstSync });
  const { issues, deleted, stale } = mergeProperties(data.entries);
  issuesDeletedInJira(deleted);
  set({ propertySync: data.progress, ...(issues ? { issues } : {}) });
  for (const key of stale)
    // The focused description takes Jira's newer text too: it asks before replacing what is being typed.
    if (
      key === get().selected &&
      (!document.activeElement?.closest?.(".rich-editor") ||
        document.activeElement.id === "description")
    )
      void loadFull(key);
  return data.progress;
}

export async function loadFull(key: string, force = false) {
  if (!needsFull(key, force)) return;
  const error = (text: string) => {
    if ((get().fullErrors.get(key) ?? "") !== text)
      set({ fullErrors: new Map(get().fullErrors).set(key, text) });
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
const fullPath = (key: string) => `/api/issues/${encodeURIComponent(key)}`;
/** An issue the tab lacks, opened by key (a link, an inbox row): reading it has the mirror keep it on no board (server mirror.ts
 *  `kept`, as Linear's `hydrateModel` loads a model its sync didn't bring), and the poll then brings it here (BJ-341).
 *  Undefined when Jira has no such issue or hides it from this account: Jira answers both with a 404 ("does not exist or you
 *  do not have permission to see it"), and so does the server. Rejects when it can't be read now (Jira or the server
 *  unreachable), so a passing failure is never told as not found (BJ-355). Asks while one read is out share it; the last
 *  read's outcome is kept (`gcTime`), as `keptOutcome` reads it with no observer. */
export async function keptIssue(key: string): Promise<Issue | undefined> {
  if (!get().issues.has(key) && !(await queryClient.fetchQuery({ queryKey: keptKey(key), queryFn: () => readKept(key), gcTime: Infinity })))
    return undefined;
  return get().issues.get(key);
}
const keptKey = (key: string) => ["kept", key] as const;
async function readKept(key: string) {
  const response = await fetch(fullPath(key));
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Could not read ${key} from Jira. Try again in a moment.`);
  await poll.refetch();
  return true;
}
/** `keptIssue`, with a failed read as undefined too, for a caller with its own fallback (⌘K opens Jira's page). */
export const keepIssue = (key: string) => keptIssue(key).catch(() => undefined);
/** How the last read of an issue the tab lacks went: still reading, couldn't be read, or else Jira has none (`missing`; also
 *  before any read, as for a notification reselected after a reload, which stayed only because its issue didn't open). */
export function keptOutcome(key: string): KeptOutcome {
  const read = queryClient.getQueryState(keptKey(key));
  return read?.fetchStatus === "fetching" ? "reading" : read?.status === "error" ? "unreachable" : "missing";
}
export const subscribeKept = (listener: () => void) => queryClient.getQueryCache().subscribe(listener);
/** Loads an issue's Jira record and keeps local field edits on top. The first read after a cold load takes the preloaded
 *  record when it is this issue's, and drops it otherwise, so a later read never gets an old answer. */
async function fetchFull(key: string) {
  const early = preloaded?.key === key ? preloaded.record : undefined;
  preloaded = undefined;
  mergeFull(key, await (early ?? json<Full>(fullPath(key))));
}
/** Linear's PageDataPreloader (`preloadTargetForPath`, `registerPreload`): an issue page opened cold starts that issue's
 *  record alongside the app's own load, instead of after it, so the issue's first read usually finds it arrived. */
let preloaded: { key: string; record: Promise<Full> } | undefined;
/** Whether the preloaded read of `key` found the issue: one no board holds is in the mirror once it has (BJ-341). */
export const preloadFound = (key: string) =>
  preloaded?.key === key ? preloaded.record.then(() => true, () => false) : Promise.resolve(false);
export function preloadFull(key: string) {
  const record = json<Full>(fullPath(key));
  record.catch(() => {}); // the issue's own read reports it
  preloaded = { key, record };
}
