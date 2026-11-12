/** The Inbox's state and actions: what shortcuts, the sidebar badge and the inbox screen share. The screen itself
 *  (routes/inbox.tsx) loads with its route. Read state goes to Jira; delete and snooze stay in this browser. */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { unreadCount } from "@/shared/inbox-model";
import { statusOf as issueStatusOf, get, set, useStore } from "@/client/state/store";
import { queryClient } from "@/client/state/server-data";
import { navigate, router, ui } from "@/client/features/navigation/app-navigation";
import { createInboxStore, type Category } from "@/client/state/inbox-store";
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
async function send(body: object) {
  const res = await fetch("/api/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reply = await res.json().catch(() => null);
  if (!res.ok) throw new Error(reply?.error ?? "Jira refused");
  return reply as { groups?: string[] } | null;
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
  clearSelection: () => {
    keepRowInUrl(null);
    navigate({ selected: null, panel: false, inbox: true });
  },
  confirm: (message) => confirm(message),
});
globalThis.addEventListener?.("storage", (event) => {
  const key = (event as StorageEvent).key;
  for (const name of ["local", "view"])
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
export const { itemsOf, facets, orderOf, clearUnseen } = inbox;
const { subscribe, localState, viewState, feed, dropLocal, markRead } = inbox;
export const useLocal = () => useSyncExternalStore(subscribe, localState);
export const useView = () => useSyncExternalStore(subscribe, viewState);
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
