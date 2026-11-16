/** The Inbox's state and actions: what shortcuts, the sidebar badge and the inbox screen share. The screen itself
 *  (routes/inbox.tsx) loads with its route. Read state goes to Jira; delete and snooze stay in this browser. */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { commentAnchor, unreadCount, type InboxItem } from "@/shared/inbox-model";
import { clearedComments, visitClears } from "@/shared/inbox-visit";
import { statusOf as issueStatusOf, get, set, useStore, issueBoardId, subscribe as onStore, type State } from "@/client/state/store";
import { keepIssue, keptOutcome, queryClient, subscribeKept } from "@/client/state/server-data";
import { navigate, router, showAnchorSoon, ui } from "@/client/features/navigation/app-navigation";
import { createInboxStore, type Category, type DeleteConfirmation, type Feed } from "@/client/state/inbox-store";
import type { InfiniteData } from "@tanstack/query-core";
import { readStored, writeStored } from "@/client/state/stored-state";

const storageKey = (name: string) =>
  `better-jira:inbox-${name}:v1:${get().namespace}`;
export const statusOf = (key: string) => {
  const issue = get().issues.get(key);
  return issue && issueStatusOf(issue);
};
/** A row whose issue isn't mirrored has no `issue=` in the URL; this keeps it selected over a reload (R2-inbox-D6). The store drops it outside the inbox. */
export const ROW_PARAM = "notification";
function keepRowInUrl(id: string | null) {
  const search = router.latestLocation.search as Record<string, string | undefined>;
  if ((search[ROW_PARAM] ?? null) === id) return;
  void router.navigate({ to: "/inbox", search: { ...search, [ROW_PARAM]: id ?? undefined }, replace: true } as never);
}
/** Set as the page goes away. A reload must not undo a read mid-write (R3-inbox-D2): `keepalive` lets the request finish, and
 *  a write cut off while leaving never settles here, so its local mark and pending entry stay for the next load to resend. */
let leaving = false;
globalThis.addEventListener?.("pagehide", () => {
  leaving = true;
});
async function send(body: object) {
  const res = await fetch("/api/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch((error: unknown) => {
    if (leaving) return new Promise<never>(() => {});
    throw error;
  });
  const reply = await res.json().catch(() => null);
  if (!res.ok) throw new Error(reply?.error ?? "Jira refused");
  return reply as { groups?: string[] } | null;
}

/** The bulk delete waiting for Linear's confirmation dialog (R3-inbox-D6); the inbox screen renders it. */
type Confirmation = DeleteConfirmation & { answer: (ok: boolean) => void };
let confirmation: Confirmation | null = null;
const confirmListeners = new Set<() => void>();
const subscribeConfirmation = (l: () => void) => (
  confirmListeners.add(l),
  () => void confirmListeners.delete(l)
);
/** The question waiting for an answer, if any. */
export const pendingConfirmation = () => confirmation;
export const useConfirmation = () => useSyncExternalStore(subscribeConfirmation, pendingConfirmation);

/** How reading the issue of a notification shown on its own went (`missingIssueNote` words it). */
export function useKeptOutcome(key: string) {
  const read = () => keptOutcome(key);
  return useSyncExternalStore(subscribeKept, read, read);
}
/** Opens a row: its issue beside the list, or the notification itself while its issue is not in the mirror. */
function openInboxRow(item: InboxItem, open: "side" | "page") {
  const issue = get().issues.get(item.key);
  if (issue) {
    keepRowInUrl(null);
    navigate({
      board: issueBoardId(issue),
      selected: issue.key,
      panel: true,
      view: open,
      inbox: true,
    });
    // A comment notification opens the issue at its comment, as Jira's link does (`focusedCommentId`).
    const anchor = commentAnchor(item);
    if (anchor) showAnchorSoon(anchor);
  } else {
    navigate({ selected: null, panel: false, inbox: true });
    keepRowInUrl(item.id);
    // An issue on no board opens here once the mirror keeps it (BJ-341); the notification shows meanwhile, and stays when
    // Jira has no such issue. A row chosen since wins.
    void keepIssue(item.key).then((issue) => {
      const search = router.latestLocation.search as Record<string, string | undefined>;
      if (issue && search[ROW_PARAM] === item.id) openInboxRow(item, open);
    });
  }
  requestAnimationFrame(() =>
    document
      .querySelector(`[data-inbox-row="${CSS.escape(item.id)}"]`)
      ?.scrollIntoView({ block: "nearest" }),
  );
}

export const inbox = createInboxStore({
  queryClient,
  get,
  set,
  ui,
  statusOf,
  read: (name, fallback) =>
    readStored(
      storageKey(name),
      (raw) => ({ ...fallback, ...(raw as object) }),
      fallback,
    ),
  save: (name, value) => {
    writeStored(
      storageKey(name),
      value,
      "Could not save inbox state in this browser",
    );
  },
  send,
  fetchPage: async (query) => {
    const res = await fetch(`/api/inbox${query.size ? `?${query}` : ""}`);
    if (!res.ok)
      throw new Error(
        (await res.json().catch(() => null))?.error ?? "Inbox unavailable",
      );
    return res.json();
  },
  openRow: openInboxRow,
  shown: () => get().inbox,
  fullPage: () => {
    const s = get();
    return s.inbox && s.panel && !!s.selected && s.view === "page";
  },
  clearSelection: () => {
    keepRowInUrl(null);
    navigate({ selected: null, panel: false, inbox: true });
  },
  confirm: (question) =>
    new Promise((resolve) => {
      confirmation?.answer(false);
      confirmation = {
        ...question,
        answer: (ok) => {
          confirmation = null;
          confirmListeners.forEach((l) => l());
          resolve(ok);
        },
      };
      confirmListeners.forEach((l) => l());
    }),
});
/** The issue open in the inbox's pane, if any. */
const paneIssue = (s: State) => (s.inbox && s.panel ? s.selected : null);
/** The pane's issue closed some other way than Escape (Back to the inbox's root), or the inbox was left: its row is no longer
 *  selected either, so the inbox shows its root ("N unread notifications"), not the row as a notification on its own (D1). */
export function followPane(before: State, after: State, store: { selectedRow: () => InboxItem | undefined; forgetSelection: () => void }) {
  if (!before.inbox) return;
  const was = paneIssue(before);
  const closed = !!was && !paneIssue(after) && !after.selected && store.selectedRow()?.key === was;
  if (!after.inbox || closed) store.forgetSelection();
}
let seen = get();
onStore(() => {
  const before = seen;
  seen = get();
  followPane(before, seen, inbox);
});
globalThis.addEventListener?.("storage", (event) => {
  const key = (event as StorageEvent).key;
  for (const name of ["local", "view", "push"])
    if (key === storageKey(name)) inbox.storageChanged(name);
});
export const {
  changeView,
  toggleFilter,
  clearFilters,
  undoInbox,
  undoInboxToast,
  selectRow,
  moveRow,
  openRow,
  toggleRead,
  markAllRead,
  deleteRow,
  deleteAll,
  openSnooze,
  snoozeMenu,
  snoozeRow,
  unsnoozeRow,
  hasSelectedRow,
  bulkApplies,
  selectedRow,
  leaveRow,
  showTab,
  priorityInbox,
} = inbox;
export const { itemsOf, facets, orderOf, clearUnseen, openFind, setFind, closeFind } = inbox;
const { subscribe, localState, viewState, feed, markRead, wakeSnoozed } = inbox;
export const usePush = () => useSyncExternalStore(subscribe, inbox.pushState);

// --- Opening an issue outside the inbox reads its notifications (Linear's MarkNotificationAsRead `z`, `j` and `M`) ---

/** Per issue key, the comments seen in it this session: Jira reads a whole group, so the row waits until each of its
 *  comment notifications' comments has been seen. */
const seenComments = new Map<string, Set<string>>();
/** The issue's rows in every feed loaded so far (both tabs of the priority inbox too). */
function rowsOf(key: string) {
  const rows = new Map<string, InboxItem>();
  for (const category of ["all", "direct", "watching"] as const)
    for (const row of itemsOf(queryClient.getQueryData<InfiniteData<Feed, string>>(["inbox", category])))
      if (row.key === key && !rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()];
}
/** The issue showed in a focused window, outside the inbox: its rows with nothing left unread (`visitClears`) are read in
 *  Jira, by the same path as U. Not undoable, as Linear's isn't. */
export function visitIssue(key: string) {
  const own = localState(),
    seen = seenComments.get(key) ?? new Set<string>(),
    rows = rowsOf(key).filter((row) => visitClears(row, own[row.head], seen));
  if (rows.length) void markRead(rows, true);
}
/** A comment of the issue was seen (`createSeenTracker`). */
export function commentSeen(key: string, comment: { id: string; parentId?: string }) {
  let seen = seenComments.get(key);
  if (!seen) seenComments.set(key, (seen = new Set()));
  for (const id of clearedComments(comment)) seen.add(id);
  visitIssue(key);
}
export const useLocal = () => useSyncExternalStore(subscribe, localState);
export const useView = () => useSyncExternalStore(subscribe, viewState);
/** The view the list applies: the stored view plus the ⌘F find term. */
export const useShownView = () => useSyncExternalStore(subscribe, inbox.shownView);
export const useFind = () => useSyncExternalStore(subscribe, inbox.findState);
export const useSelected = () => useSyncExternalStore(subscribe, inbox.selected);
export function useFeed(category: Category) {
  const observer = feed(category);
  return useSyncExternalStore(
    useCallback((l) => observer.subscribe(l), [observer]),
    () => observer.getCurrentResult(),
  );
}
/** Unread rows, as Linear counts them: every unread notification in Jira, not just the loaded pages. */
export function useUnreadCount() {
  const { data } = useFeed("all");
  const own = useLocal();
  const now = useStore((s) => s.clock); // snoozes expire
  return {
    count: unreadCount(data?.pages[0]?.unread, itemsOf(data), own, now),
    data,
    own,
    now,
  };
}
/** The sidebar badge. It is always mounted, so it also brings back expired snoozes (`wakeSnoozed`). */
export function useInboxBadge() {
  const { count, data, own, now } = useUnreadCount();
  // Mounted once the account is known, so the stored writes a reload cut off are this account's.
  useEffect(() => inbox.resumeWrites(), []);
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A snooze stored into the past (another tab, a reload) wakes at once.
  useEffect(() => wakeSnoozed(itemsOf(data), now), [data, own, now]);
  // A snooze wakes at its time, not at the next tick of the minute clock (QA round 4, D11).
  useEffect(() => inbox.wakeAt(own, () => wakeSnoozed(itemsOf(data), Date.now())), [data, own]);
  // Read marks that outlived their notification go as the feed changes, so the badge stays Jira's count (D3).
  useEffect(() => inbox.tidyLocal(loadedRows(data?.pages[0]?.unread)), [data]);
  return count;
}
/** Every row the loaded feeds hold, both tabs of the priority inbox too, and Jira's unread list. */
function loadedRows(unread: { id: string; head: string }[] = []) {
  return [
    ...(["all", "direct", "watching"] as const).flatMap((category) =>
      itemsOf(queryClient.getQueryData<InfiniteData<Feed, string>>(["inbox", category])),
    ),
    ...unread,
  ];
}
