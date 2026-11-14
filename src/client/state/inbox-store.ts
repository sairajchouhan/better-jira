import { type Issue, type Status } from "@/shared/issue-model";
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
  finding,
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
  type ShownView,
} from "@/shared/inbox-model";

export type Feed = InboxFeed & { writable: boolean };
export type Category = "all" | "direct" | "watching";
/** What a read write needs of a row: its Jira group and its head notification. Rows on unloaded pages have only these. */
export type InboxRow = Pick<InboxItem, "id" | "head">;
/** Linear's confirmation for the bulk deletes: a title and a description, confirmed with a red "Delete all". */
export type DeleteConfirmation = { title: string; description: string };
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
  confirm: (question: DeleteConfirmation) => Promise<boolean>;
  /** Whether the inbox is the screen: a row's delayed read lands only while its notification still shows. */
  shown: () => boolean;
  /** Runs `fn` after `ms`; returns its cancel. */
  later?: (fn: () => void, ms: number) => () => void;
};
/** Linear's `MarkNotificationAsRead` `A` (2026-11-14): the open notification is marked read 300 ms after it shows, so rows
 *  that J/K or the mouse pass through stay unread. Showing another notification, or none, before then cancels it. */
export const READ_DELAY = 300;
const timeout = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};
/** Linear's wording for each bulk delete's confirmation; the priority inbox names its tab. Linear's "completed" also covers
 *  reviews, which Jira has none of. */
export function deleteQuestion(
  which: "all" | "read" | "completed",
  view: Pick<InboxView, "priorityInbox" | "tab">,
): DeleteConfirmation {
  const inbox = view.priorityInbox
    ? `the ${view.tab === "direct" ? "Priority" : "Other"} inbox`
    : "your inbox";
  if (which === "completed") {
    const where = view.priorityInbox ? ` in ${inbox}` : "";
    return {
      title: `Delete all read notifications for completed issues${where}?`,
      description: `This will delete all read notifications${where} about issues that were marked as done or canceled.`,
    };
  }
  const what = which === "read" ? "read notifications" : "notifications";
  return {
    title: `Delete all ${what}?`,
    description: `This will delete all ${what} in ${inbox}.`,
  };
}
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

  // --- find: Linear's ⌘F field over the list (startup-root `Idi`, the inbox's "Find in inbox…"). Not stored: the field opens
  // empty each time the inbox does, as Linear's resets on a fresh visit. ---

  /** `open`: the field shows; it also shows while it holds a term. */
  let find = { open: false, term: "" };
  const findState = () => find;
  function putFind(next: typeof find) {
    if (next.open === find.open && next.term === find.term) return;
    find = next;
    emit();
  }
  const openFind = () => putFind({ ...find, open: true });
  const setFind = (term: string) => putFind({ open: true, term });
  /** Escape, the close button, or leaving the field empty: the term goes and the field hides. */
  const closeFind = () => putFind({ open: false, term: "" });
  let shown: { view: InboxView; term: string; value: ShownView } | undefined;
  /** The view the list applies: the stored one plus the find term; the same object while neither changes. */
  function shownView() {
    const v = viewState();
    if (shown?.view !== v || shown.term !== find.term)
      shown = { view: v, term: find.term, value: find.term ? { ...v, find: find.term } : v };
    return shown.value;
  }
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
    const v = shownView();
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
  /** Read writes not yet confirmed, by head, kept in storage: a reload mid-write sends them again (R3-inbox-D2). */
  type Pending = Record<string, { group: string; read: boolean }>;
  function editPending(change: (pending: Pending) => void) {
    const pending = read<Pending>("pending", {});
    change(pending);
    save("pending", pending);
  }
  /** Per head: the newest markRead call, the only one that drops the local override. */
  const marking = new Map<string, number>();
  let marks = 0;
  /** Shown at once; on a writable site Jira takes it and the local override goes once the feed agrees, or at once if Jira refuses.
   *  A `label` makes it undoable. `all` marks Jira's whole feed read but for its `except` heads (snoozed rows), and the groups
   *  Jira changed join `groups` for the undo. */
  async function markRead(
    items: InboxRow[],
    value: boolean,
    label?: string,
    groups = items.map((i) => i.id),
    all?: { except: string[] },
  ) {
    if (!items.length) return;
    if (label)
      remember(label, () => void markRead(items, !value, undefined, groups));
    const heads = items.map((i) => i.head),
      mark = ++marks;
    for (const head of heads) marking.set(head, mark);
    setLocal(heads, { read: value });
    // Unknown (no page yet) is a write resumed at boot; the server refuses it if the site is read-only.
    if (firstPage()?.writable === false) return;
    editPending((pending) => {
      for (const i of items) pending[i.head] = { group: i.id, read: value };
    });
    const mine = [...groups];
    for (const group of mine) wanted.set(group, value);
    const job = Promise.all(mine.map((g) => queues.get(g))).then(async () => {
      if (all) {
        const changed =
          (
            await send(
              all.except.length
                ? { action: "read-all", except: all.except }
                : { action: "read-all" },
            )
          )?.groups ?? [];
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
      editPending((pending) => {
        for (const head of latest) delete pending[head];
      });
      dropLocal(latest, "read");
    }
  }
  /** Sends the read writes a reload cut off, once per page load; the feed refetches when they land. */
  let resumed = false;
  function resumeWrites() {
    if (resumed) return;
    resumed = true;
    const pending = Object.entries(read<Pending>("pending", {}));
    for (const value of [true, false]) {
      const rows = pending
        .filter(([, p]) => p.read === value)
        .map(([head, p]) => ({ id: p.group, head }));
      if (rows.length) void markRead(rows, value);
    }
  }
  /** The pending delayed read (`READ_DELAY`) of the row that shows. */
  let pendingRead: { id: string; cancel: () => void } | undefined;
  function cancelRead(id?: string) {
    if (!pendingRead || (id !== undefined && pendingRead.id !== id)) return;
    pendingRead.cancel();
    pendingRead = undefined;
  }
  function reveal(item: InboxItem, open: "side" | "page") {
    selectedId = item.id;
    emit();
    ports.openRow(item, open);
  }
  /** Selects and opens a row without marking it read: undo and bulk deletes put the selection back or move it on, which is
   *  not a visit (R3-inbox-D1). It cancels the read of the row it replaces. */
  function showRow(item: InboxItem, open: "side" | "page" = "side") {
    cancelRead();
    reveal(item, open);
  }
  /** A visit, by key or click alike: Linear marks the notification read once it has shown for `READ_DELAY`. */
  function selectRow(
    item: InboxItem | undefined,
    open: "side" | "page" = "side",
  ) {
    if (!item) return;
    cancelRead();
    if (item.unread) {
      const cancel = (ports.later ?? timeout)(() => {
        pendingRead = undefined;
        // Linear's timer goes with the notification view: only the row still showing in the inbox is read.
        if (selectedId !== item.id || !ports.shown()) return;
        const row = selectedRow() ?? item;
        if (row.unread) void markRead([row], true);
      }, READ_DELAY);
      pendingRead = { id: item.id, cancel };
    }
    reveal(item, open);
  }
  function moveRow(direction: number) {
    const rows = shownRows(),
      at = rows.findIndex((r) => r.id === selectedId);
    selectRow(rows[at < 0 ? 0 : at + direction]);
  }
  const openRow = () => selectRow(selectedRow(), "page");
  /** Linear's U. */
  function toggleRead(row = selectedRow()) {
    // An explicit U wins over the pending read of the row it acts on.
    if (row) cancelRead(row.id);
    if (row)
      void markRead(
        [row],
        row.unread,
        row.unread ? "mark as read" : "mark as unread",
      );
  }
  /** Linear's ⌥U: every row in the current view. With no tab or filter, Jira marks its whole feed, unloaded rows too, but
   *  never a deleted one, nor a snoozed one unless snoozed rows show (Linear's `markAllAsRead(i, e => t || !e.snoozedUntilAt)`
   *  over the listed rows, R3-inbox-D3).
   *  Every unread row Jira listed is marked here at once, so the badge needn't wait for the refetch (R3-inbox-D5). */
  function markAllRead() {
    const v = shownView(),
      rows: InboxRow[] = shownRows().filter((r) => r.unread);
    const label = "mark notifications as read";
    if (v.priorityInbox || hasFilters(v) || finding(v)) return markRead(rows, true, label);
    const own = localState(),
      now = get().clock;
    // Deleted rows are gone from Linear's list, so its ⌥U never reaches them: they stay unread in Jira too (R3 G10).
    const except = Object.keys(own).filter(
      (head) => own[head]?.deleted || (!v.showSnoozed && (own[head]?.snoozed ?? 0) > now),
    );
    const skip = new Set([...rows.map((r) => r.head), ...except]);
    for (const u of firstPage()?.unread ?? [])
      if (!skip.has(u.head)) {
        rows.push(u);
        skip.add(u.head);
      }
    return markRead(rows, true, label, undefined, { except });
  }
  /** Removes rows here, selects the next one as Linear does, and offers Linear's undo toast. Returns what the undo restores, so more rows can join it. */
  function hide(
    items: InboxItem[],
    patch: Local,
    label: string,
    toast: string,
    activate: (item: InboxItem) => void = selectRow,
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
      if (next) activate(next);
      else {
        cancelRead();
        selectedId = null;
        emit();
        ports.clearSelection();
      }
    }
    toastUndo = remember(label, () => {
      putLocal([...before.keys()], (_, head) => before.get(head));
      if (was && gone.has(was.id)) showRow(was);
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
  /** Linear's Delete all, Delete all read and Delete all completed (`zEn`, `LEn`, `FEn`): the whole feed, not just the loaded rows.
   *  The loaded ones go at once; older pages load and join the same undo (R2-inbox-D2). "Completed" takes only read rows of
   *  done or canceled issues that aren't snoozed (Linear's `eEn`, R3-inbox-D4). A bulk delete is not a visit: when it removes
   *  the selected row, the next one is selected without being marked read (R3-inbox-D1). */
  async function deleteAll(which: "all" | "read" | "completed") {
    const v = shownView(),
      now = get().clock;
    const snoozed = (r: InboxItem) => (localState()[r.head]?.snoozed ?? 0) > now;
    const matches = (r: InboxItem) =>
      which === "read"
        ? !r.unread
        : which === "completed"
          ? !r.unread && !snoozed(r) && closed(r)
          : true;
    if (
      !shownRows().length ||
      // While find looks through both tabs, the question names the whole inbox.
      !(await ports.confirm(deleteQuestion(which, { ...v, priorityInbox: feedCategory(v) !== "all" })))
    )
      return;
    const items = shownRows().filter(matches),
      toast =
        items.length === 1 ? "Notification deleted" : "Notifications deleted";
    const before = hide(
      items,
      { deleted: true },
      "delete notifications",
      toast,
      showRow,
    );
    const observer = feed(feedCategory(v));
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
      return void hide(
        rest,
        { deleted: true },
        "delete notifications",
        toast,
        showRow,
      );
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
    cancelRead: () => cancelRead(),
    shownView,
    findState,
    openFind,
    setFind,
    closeFind,
    selected: () => selectedId,
    resumeWrites,
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
