import { showNotification, INBOX_NOTIFICATION_ID } from "./app-notifications";
import { toasts } from "@/client/components/toast-queue";
/** Inbox state, ordered writes and undo. Each instance owns its caches and queues; IO enters through ports. */
import {
  InfiniteQueryObserver,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/query-core";
import {
  DEFAULT_VIEW,
  facetsOf,
  feedCategory,
  inboxOrder,
  hasFilters,
  sameInboxOrder,
  visibleItems,
  type FilterField,
  type InboxFeed,
  type InboxItem,
  type InboxOrder,
  type InboxView,
  type Local,
} from "@/shared/inbox-model";
import type { Issue, Status } from "./store";
export type Feed = InboxFeed & { writable: boolean };
export type Category = "all" | "direct" | "watching";
export type InboxPorts = {
  queryClient: QueryClient;
  get: () => { issues: Map<string, Issue>; clock: number };
  set: (patch: { perf: string }) => void;
  ui: {
    send: (event: { type: "overlay.open"; overlay: "snooze" }) => void;
  };
  statusOf: (key: string) => Status | undefined;
  read: <T>(name: string, fallback: T) => T;
  save: (name: string, value: object) => void;
  fetchPage: (query: URLSearchParams) => Promise<Feed>;
  send: (body: object) => Promise<{ groups?: string[] } | null>;
  openRow: (item: InboxItem, open: "side" | "page") => void;
  clearSelection: () => void;
  confirm: (message: string) => boolean;
};
export function createInboxStore(ports: InboxPorts) {
  const { queryClient, get, set, ui, statusOf, read, save, send } = ports;

  // --- local state: per head notification, plus the view's display options ---

  let local: Record<string, Local> | undefined, view: InboxView | undefined;
  let selectedId: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (l: () => void) => (
    listeners.add(l),
    () => void listeners.delete(l)
  );
  const localState = () => (local ??= read<Record<string, Local>>("local", {}));
  const viewState = () => (view ??= read("view", DEFAULT_VIEW));
  function storageChanged(name: string) {
    if (name === "local") local = undefined;
    else if (name === "view") view = undefined;
    else return;
    emit();
  }
  /** Changes each head's local state (`undefined` drops it), on top of what is stored now, so another tab's changes to other heads survive. */
  function putLocal(
    heads: string[],
    change: (old: Local | undefined, head: string) => Local | undefined,
  ) {
    const next = read<Record<string, Local> | null>("local", null) ?? {
      ...localState(),
    };
    for (const head of heads) {
      const value = change(next[head], head);
      if (value && Object.keys(value).length) next[head] = value;
      else delete next[head];
    }
    local = next;
    save("local", next);
    emit();
  }
  const setLocal = (heads: string[], patch: Local) =>
    putLocal(heads, (old) => ({ ...old, ...patch }));
  const dropLocal = (heads: string[], key: keyof Local) =>
    putLocal(heads, (old) => {
      const { [key]: _, ...rest } = old ?? {};
      return rest;
    });
  function changeView(patch: Partial<InboxView>) {
    view = { ...viewState(), ...patch };
    save("view", view);
    emit();
  }
  const toggleFilter = (field: FilterField, value: string) => {
    const values = viewState().filters[field] ?? [];
    changeView({
      filters: {
        ...viewState().filters,
        [field]: values.includes(value)
          ? values.filter((v) => v !== value)
          : [...values, value],
      },
    });
  };
  const clearFilters = () => changeView({ filters: {} });
  // --- data: TanStack Query, a page per Jira cursor; the server's SSE "inbox" message invalidates ["inbox"] ---

  const options = (category: Category) => ({
    queryKey: ["inbox", category],
    queryFn: async ({ pageParam }: { pageParam: string }): Promise<Feed> => {
      const query = new URLSearchParams(category === "all" ? {} : { category });
      if (pageParam) query.set("after", pageParam);
      const page = await ports.fetchPage(query);
      if (!pageParam) save(`feed-${category}`, page);
      return page;
    },
    // The last first page shows at once on reload, and is refetched straight away (Jira's feed takes about a second).
    initialData: () => {
      const page = read<Partial<Feed>>(`feed-${category}`, {});
      return page.items
        ? { pages: [page as Feed], pageParams: [""] }
        : undefined;
    },
    initialDataUpdatedAt: 0,
    initialPageParam: "",
    getNextPageParam: (last: Feed) => (last.more && last.cursor) || undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000, // backstop; the server's unseen-count poll pushes changes sooner
  });
  // One subscription lifecycle (and polling timer) per category, shared by every view.
  const feeds = new Map<Category, InfiniteQueryObserver<Feed, Error, InfiniteData<Feed, string>, string[], string>>();
  function feed(category: Category) {
    let observer = feeds.get(category);
    if (!observer) {
      observer = new InfiniteQueryObserver<Feed, Error, InfiniteData<Feed, string>, string[], string>(
        queryClient, options(category),
      );
      feeds.set(category, observer);
    }
    return observer;
  }
  /** Every loaded page's rows; a row Jira repeats on a later page keeps its first place. */
  function itemsOf(data?: InfiniteData<Feed, string>) {
    const seen = new Set<string>();
    return (data?.pages ?? [])
      .flatMap((p) => p.items)
      .filter((i) => !seen.has(i.id) && !!seen.add(i.id));
  }
  const firstPage = () =>
    queryClient.getQueryData<InfiniteData<Feed, string>>(["inbox", "all"])
      ?.pages[0];

  /** Filter facts for a row; priority, project and status come from the mirror when the issue is in it. */
  const facets = (item: InboxItem) =>
    facetsOf(
      item,
      get().issues.get(item.key),
      statusOf(item.key),
      projectNames(),
    );
  /** Key prefix → project name, from the mirror; rebuilt when the issues change. */
  let projectsFor: Map<string, Issue> | undefined,
    projects = new Map<string, string>();
  function projectNames() {
    const issues = get().issues;
    if (projectsFor !== issues) {
      projectsFor = issues;
      projects = new Map();
      for (const issue of issues.values())
        if (issue.project) projects.set(issue.project.key, issue.project.name);
    }
    return projects;
  }

  // --- undo: Linear's Z steps back through inbox actions ---

  type Undo = { label: string; run: () => void };
  const undos: Undo[] = [];
  /** The action the inbox's toast offers to undo: not always the newest, once U or ⌥U follow it. */
  let toastUndo: Undo | undefined;
  function remember(label: string, run: () => void) {
    const entry = { label, run };
    undos.push(entry);
    undos.splice(0, undos.length - 50);
    return entry;
  }
  /** Z undoes the newest action; the toast's Undo its own. */
  function undoInbox(entry = undos.at(-1)) {
    const at = entry ? undos.indexOf(entry) : -1;
    if (!entry || at < 0) return;
    undos.splice(at, 1);
    entry.run();
    if (entry === toastUndo) toasts.dismiss(INBOX_NOTIFICATION_ID);
    set({ perf: `Undid ${entry.label}` });
  }
  const undoInboxToast = () => undoInbox(toastUndo);

  // --- actions (also the keyboard shortcuts) ---

  let lastOrder: { inputs: unknown[]; order: InboxOrder } | undefined;
  /** The list's order from the feed's loaded pages, this browser's read, delete and snooze state, and the view.
   *  Memoised; when only the mirror changed (a Jira poll) and no row did, it returns the same order, so the list needn't re-render. */
  function orderOf(
    data: InfiniteData<Feed, string> | undefined,
    own: Record<string, Local>,
    v: InboxView,
    now: number,
    keep: string | null,
    issues = get().issues,
  ) {
    const inputs = [data, own, v, now, keep, issues],
      last = lastOrder;
    if (last?.inputs.every((x, i) => x === inputs[i])) return last.order;
    let order = inboxOrder(itemsOf(data), own, v, now, keep, facets);
    const onlyMirror =
      !!last && inputs.slice(0, 5).every((x, i) => x === last.inputs[i]);
    if (onlyMirror && sameInboxOrder(last!.order, order)) order = last!.order;
    lastOrder = { inputs, order };
    return order;
  }
  /** The rows on screen, in order: what the inbox's keys and actions act on. */
  function shownRows() {
    const v = viewState();
    return orderOf(
      queryClient.getQueryData<InfiniteData<Feed, string>>([
        "inbox",
        feedCategory(v),
      ]),
      localState(),
      v,
      get().clock,
      selectedId,
    ).rows;
  }
  const selectedRow = () => shownRows().find((r) => r.id === selectedId);

  /** The server takes 50 groups per call. */
  async function sendGroups(action: "read" | "unread", groups: string[]) {
    for (let i = 0; i < groups.length; i += 50)
      await send({ action, groups: groups.slice(i, i + 50) });
  }
  /** Per group: the newest read state asked for, and its queue of sends. A group's sends run one at a time and a stale one is skipped,
   *  so rapid U presses end where the last one did, here and in Jira; sent together they could land out of order (R2-inbox-D1). */
  const wanted = new Map<string, boolean>(),
    queues = new Map<string, Promise<unknown>>();
  /** Per head: the newest markRead call, the only one that drops the local override. */
  const marking = new Map<string, number>();
  let marks = 0;
  /** Shown at once; on a writable site Jira takes it and the local override goes once the feed agrees, or at once if Jira refuses.
   *  A `label` makes it undoable. `all` marks Jira's whole feed read, and the groups Jira changed join `groups` for the undo. */
  async function markRead(
    items: InboxItem[],
    value: boolean,
    label?: string,
    groups = items.map((i) => i.id),
    all = false,
  ) {
    if (!items.length) return;
    if (label)
      remember(label, () => void markRead(items, !value, undefined, groups));
    const heads = items.map((i) => i.head),
      mark = ++marks;
    for (const head of heads) marking.set(head, mark);
    setLocal(heads, { read: value });
    if (!firstPage()?.writable) return;
    const mine = [...groups];
    for (const group of mine) wanted.set(group, value);
    const job = Promise.all(mine.map((g) => queues.get(g))).then(async () => {
      if (all) {
        const changed = (await send({ action: "read-all" }))?.groups ?? [];
        groups.push(...changed.filter((g) => !groups.includes(g)));
      } else
        await sendGroups(
          value ? "read" : "unread",
          mine.filter((g) => wanted.get(g) === value),
        );
    });
    const queued = job.catch(() => {});
    for (const group of mine) queues.set(group, queued);
    try {
      await job;
      await queryClient.invalidateQueries({ queryKey: ["inbox"] });
    } catch (error) {
      set({ perf: `Could not update Jira: ${(error as Error).message}` });
    } finally {
      for (const group of mine)
        if (queues.get(group) === queued) {
          queues.delete(group);
          wanted.delete(group);
        }
      const latest = heads.filter((h) => marking.get(h) === mark);
      for (const head of latest) marking.delete(head);
      dropLocal(latest, "read");
    }
  }
  function selectRow(
    item: InboxItem | undefined,
    open: "side" | "page" = "side",
  ) {
    if (!item) return;
    selectedId = item.id;
    emit();
    if (item.unread) void markRead([item], true);
    ports.openRow(item, open);
  }
  function moveRow(direction: number) {
    const rows = shownRows(),
      at = rows.findIndex((r) => r.id === selectedId);
    selectRow(rows[at < 0 ? 0 : at + direction]);
  }
  const openRow = () => selectRow(selectedRow(), "page");
  /** Linear's U. */
  function toggleRead(row = selectedRow()) {
    if (row)
      void markRead(
        [row],
        row.unread,
        row.unread ? "mark as read" : "mark as unread",
      );
  }
  /** Linear's ⌥U: every row in the current view. With no tab or filter, Jira marks its whole feed. */
  function markAllRead() {
    const v = viewState();
    return markRead(
      shownRows().filter((r) => r.unread),
      true,
      "mark notifications as read",
      undefined,
      !v.priorityInbox && !hasFilters(v),
    );
  }
  /** Removes rows here, selects the next one as Linear does, and offers Linear's undo toast. Returns what the undo restores, so more rows can join it. */
  function hide(
    items: InboxItem[],
    patch: Local,
    label: string,
    toast: string,
  ) {
    if (!items.length) return;
    const before = new Map(items.map((i) => [i.head, localState()[i.head]])),
      was = selectedRow(),
      rows = shownRows();
    const gone = new Set(items.map((i) => i.id)),
      at = rows.findIndex((r) => r.id === selectedId),
      next =
        rows.slice(at + 1).find((r) => !gone.has(r.id)) ??
        rows.slice(0, at).findLast((r) => !gone.has(r.id));
    setLocal(
      items.map((i) => i.head),
      patch,
    );
    if (selectedId && gone.has(selectedId)) {
      if (next) selectRow(next);
      else {
        selectedId = null;
        emit();
        ports.clearSelection();
      }
    }
    toastUndo = remember(label, () => {
      putLocal([...before.keys()], (_, head) => before.get(head));
      if (was && gone.has(was.id)) selectRow(was);
    });
    showNotification({ text: toast, undo: undoInboxToast }, INBOX_NOTIFICATION_ID);
    return before;
  }
  /** Linear's E and ⌫. Jira notifications cannot be deleted, so this hides the row in this browser until the issue has new activity. */
  function deleteRow(item = selectedRow()) {
    if (item)
      hide(
        [item],
        { deleted: true },
        "delete notification",
        "Notification deleted",
      );
  }
  const closed = (item: InboxItem) =>
    ["Completed", "Canceled", "Duplicate"].includes(facets(item).statusType);
  /** Linear's Delete all: the whole feed, not just the loaded rows. The loaded ones go at once; older pages load and join the same undo (R2-inbox-D2). */
  async function deleteAll(which: "all" | "read" | "completed") {
    const matches = (r: InboxItem) =>
      which === "read" ? !r.unread : which === "completed" ? closed(r) : true;
    const what =
      which === "read"
        ? "read notifications"
        : which === "completed"
          ? "notifications for completed issues"
          : "notifications";
    const rows = shownRows();
    if (
      !rows.length ||
      !ports.confirm(
        `Delete all ${what}? Jira keeps them; this hides them in better-jira.`,
      )
    )
      return;
    const items = rows.filter(matches),
      toast =
        items.length === 1 ? "Notification deleted" : "Notifications deleted";
    const before = hide(
      items,
      { deleted: true },
      "delete notifications",
      toast,
    );
    const v = viewState(),
      observer = feed(feedCategory(v));
    let result = observer.getCurrentResult();
    // ponytail: 20 pages (about 1,000 notifications) at most; anything older still shows.
    for (let i = 0; i < 20 && result.hasNextPage && !result.isError; i++)
      result = await observer.fetchNextPage({ cancelRefetch: false });
    const rest = visibleItems(
      itemsOf(result.data),
      localState(),
      v,
      Date.now(),
      selectedId,
      facets,
    ).filter(matches);
    if (!rest.length) return;
    if (!before)
      return void hide(rest, { deleted: true }, "delete notifications", toast);
    for (const r of rest) before.set(r.head, localState()[r.head]);
    setLocal(
      rest.map((r) => r.head),
      { deleted: true },
    );
  }
  /** The row a snooze applies to: the right-clicked one, else the selected one. */
  let snoozeTarget: InboxItem | undefined,
    snoozeCustom = false;
  function openSnooze(item?: InboxItem, custom = false) {
    snoozeTarget = item;
    snoozeCustom = custom;
    ui.send({ type: "overlay.open", overlay: "snooze" });
  }
  function snoozeRow(until: number, item = snoozeTarget ?? selectedRow()) {
    snoozeTarget = undefined;
    if (item)
      hide(
        [item],
        { snoozed: until },
        "snooze notification",
        "Notification snoozed",
      );
  }
  const hasSelectedRow = () => !!selectedRow();
  /** Linear's ⌥1 and ⌥2: the priority inbox's tabs. */
  const showTab = (tab: InboxView["tab"]) => changeView({ tab });
  const priorityInbox = () => viewState().priorityInbox;
  /** Unseen is Jira's bell count; opening the inbox clears it, as opening the bell does. */
  let clearing = false;
  async function clearUnseen() {
    if (clearing || !firstPage()?.writable || !firstPage()?.unseen) return;
    clearing = true;
    try {
      await send({ action: "seen" });
      queryClient.setQueryData<InfiniteData<Feed, string>>(
        ["inbox", "all"],
        (d) =>
          d && {
            ...d,
            pages: d.pages.map((p, i) => (i ? p : { ...p, unseen: 0 })),
          },
      );
    } catch {
      /* the bell count is cosmetic here */
    } finally {
      clearing = false;
    }
  }

  return {
    subscribe,
    localState,
    viewState,
    selected: () => selectedId,
    restoreSelection: (id: string) => {
      selectedId = id;
      emit();
    },
    storageChanged,
    feed,
    itemsOf,
    facets,
    orderOf,
    selectedRow,
    dropLocal,
    markRead,
    changeView,
    toggleFilter,
    clearFilters,
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
    undoInbox,
    undoInboxToast,
    clearUnseen,
    startCustom: () => snoozeCustom,
  };
}
