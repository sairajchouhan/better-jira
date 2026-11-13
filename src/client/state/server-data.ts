import { type Board, type Full, type Issue } from "@/shared/issue-model";
/**
 * Reading the server's mirror of Jira. Reads go through TanStack Query, which dedupes loads in flight; the property poll
 * merges Jira's changes into the issues (keeping local edits on top, see local-edits.ts) and runs at once when the
 * server's event stream says Jira changed. Boards are added and removed here too, for every tab.
 */
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { defaultPreferences, parsePreferences } from "@/shared/view-model";
import { mergeFull, mergeProperties, needsFull } from "./local-edits";
import { navigate } from "@/client/features/navigation/app-navigation";
import { showNotification } from "./app-notifications";
import { get, set, subscribe } from "./store";

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
    issues = new Map(get().issues),
    preferences = { ...get().preferences };
  for (const issue of remote)
    if (!known.has(issue.board) && !issues.has(issue.key)) issues.set(issue.key, issue);
  const removed = new Set([...known].filter((id) => !boards.some((b) => b.id === id)));
  if (removed.size) for (const [key, issue] of issues) if (removed.has(issue.board)) issues.delete(key);
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
async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}
/** One property poll; the poll query schedules the next. */
async function fetchProperties(): Promise<{ pending: number }> {
  const res = await fetch("/api/properties");
  if (!res.ok) throw new Error("Properties unavailable");
  const data = await res.json();
  const { issues, deleted, stale } = mergeProperties(data.entries);
  const { selected } = get();
  if (selected && deleted.includes(selected)) {
    const key = selected;
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
export function preloadFull(key: string) {
  const record = json<Full>(fullPath(key));
  record.catch(() => {}); // the issue's own read reports it
  preloaded = { key, record };
}
