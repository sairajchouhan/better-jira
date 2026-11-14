/** The Inbox's state and actions: what shortcuts, the sidebar badge and the inbox screen share. The screen itself
 *  (routes/inbox.tsx) loads with its route. Read state goes to Jira; delete and snooze stay in this browser. */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { commentAnchor, unreadCount, type InboxItem } from "@/shared/inbox-model";
import { clearedComments, visitClears } from "@/shared/inbox-visit";
import { statusOf as issueStatusOf, get, set, useStore } from "@/client/state/store";
import { queryClient } from "@/client/state/server-data";
import { navigate, router, showAnchor, ui } from "@/client/features/navigation/app-navigation";
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
export const useConfirmation = () =>
  useSyncExternalStore(subscribeConfirmation, () => confirmation);

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
  openRow: (item, open) => {
    const issue = get().issues.get(item.key);
    if (issue) {
      keepRowInUrl(null);
      navigate({
        board: issue.board,
        selected: issue.key,
        panel: true,
        view: open,
        inbox: true,
      });
      // A comment notification opens the issue at its comment, as Jira's link does (`focusedCommentId`).
      const anchor = commentAnchor(item);
      if (anchor) requestAnimationFrame(() => showAnchor(anchor));
    } else {
      navigate({ selected: null, panel: false, inbox: true });
      keepRowInUrl(item.id);
    }
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-inbox-row="${CSS.escape(item.id)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  },
  shown: () => get().inbox,
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
  snoozeRow,
  hasSelectedRow,
  showTab,
  priorityInbox,
} = inbox;
export const { itemsOf, facets, orderOf, clearUnseen, openFind, setFind, closeFind } = inbox;
const { subscribe, localState, viewState, feed, dropLocal, markRead } = inbox;
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
/** The sidebar badge. It is always mounted, so it also brings back expired snoozes: unread, as Linear does, and in Jira too. */
export function useInboxBadge() {
  const { count, data, own, now } = useUnreadCount();
  // Mounted once the account is known, so the stored writes a reload cut off are this account's.
  useEffect(() => inbox.resumeWrites(), []);
  useEffect(() => {
    const due = itemsOf(data).filter(
      (i) => (own[i.head]?.snoozed ?? Infinity) <= now,
    );
    if (!due.length) return;
    dropLocal(
      due.map((i) => i.head),
      "snoozed",
    );
    void markRead(due, false);
  }, [data, own, now]);
  return count;
}
