import { type Issue, type Status } from "@/shared/issue-model";
import { showNotification, INBOX_NOTIFICATION_ID } from "./app-notifications";
import { toasts } from "@/client/components/toast-queue";
/** Inbox state, ordered writes and undo. Each instance owns its caches and queues; IO enters through ports. */
import {
  InfiniteQueryObserver,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/query-core";
import { DEFAULT_PUSH, type PushSettings } from "@/shared/inbox-push";
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
  withoutFilter,
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
  /** Whether the open notification fills the page rather than the inbox's split view (Linear's `redirectToInboxRoot`). */
  fullPage: () => boolean;
  /** Runs `fn` after `ms`; returns its cancel. */
  later?: (fn: () => void, ms: number) => () => void;
};
/** Linear's `MarkNotificationAsRead` `A` (2026-11-14): the open notification is marked read 300 ms after it shows, so rows
 *  that J/K or the mouse pass through stay unread. Showing another notification, or none, before then cancels it. */
export const READ_DELAY = 300;
/** The longest wait `setTimeout` keeps (2^31 − 1 ms); a longer one fires at once. */
const MAX_WAIT = 2 ** 31 - 1;
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

  let local: Record<string, Local> | undefined,
    view: InboxView | undefined,
    push: PushSettings | undefined;
  let selectedId: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (l: () => void) => (
    listeners.add(l),
    () => void listeners.delete(l)
  );
  const localState = () => (local ??= read<Record<string, Local>>("local", {}));
  const viewState = () => (view ??= read("view", DEFAULT_VIEW));
  /** Desktop notifications' settings (Linear's Push notifications › Desktop), kept per account in this browser. */
  const pushState = () => (push ??= read("push", DEFAULT_PUSH));
  function changePush(patch: Partial<PushSettings>) {
    push = { ...pushState(), ...patch };
    save("push", push);
    emit();
  }
  function storageChanged(name: string) {
    if (name === "local") local = undefined;
    else if (name === "view") view = undefined;
    else if (name === "push") push = undefined;
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
  const dropLocal = (heads: string[], ...keys: (keyof Local)[]) =>
    putLocal(heads, (old) => {
      const rest = { ...old };
      for (const key of keys) delete rest[key];
      return rest;
    });
  /** What an undo of a delete or snooze puts back: the entry as it was, but the read mark as it is now. The read mark belongs
   *  to its write (`markRead`), which may have settled since; restoring an old one would strand it and count the row unread
   *  for good (QA round 4, D3). */
  const restoreLocal = (before: Map<string, Local | undefined>) =>
    putLocal([...before.keys()], (now, head) => {
      const { read: _, group: __, ...was } = before.get(head) ?? {};
      return {
        ...was,
        ...(now?.read !== undefined && { read: now.read }),
        ...(now?.group !== undefined && { group: now.group }),
      };
    });
  function changeView(patch: Partial<InboxView>) {
    view = { ...viewState(), ...patch };
    save("view", view);
    emit();
  }
  const toggleFilter = (field: FilterField, value: string) => {
    const values = viewState().filters[field] ?? [];
    const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    changeView(next.length ? { filters: { ...viewState().filters, [field]: next } } : withoutFilter(viewState(), field));
  };
  const clearFilters = () => changeView({ filters: {}, negated: [] });

  // --- find: Linear's ⌘F field over the list (startup-root `Idi`: "Find in view…", "Find in inbox…" in the priority inbox).
  // Not stored: the field opens empty each time the inbox does, as Linear's resets on a fresh visit. ---

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

  /** Linear's row names the issue as it is now (`notification.issue.title`, live: a rename shows at once), so a mirrored
   *  issue's title replaces the one Jira's notification carried; find, the row's name and Copy read the same (QA round 4, D6). */
  const liveTitles = (items: InboxItem[], issues: Map<string, Issue>) =>
    items.map((item) => {
      const title = issues.get(item.key)?.summary;
      return title && title !== item.title ? { ...item, title } : item;
    });
  let lastOrder: { inputs: unknown[]; order: InboxOrder } | undefined;
  /** The list's order from the feed's loaded pages, this browser's read, delete and snooze state, and the view.
   *  Memoised; when only the mirror changed (a Jira poll) and no row did, it returns the same order, so the list needn't re-render. */
  function orderOf(
    data: InfiniteData<Feed, string> | undefined,
    own: Record<string, Local>,
    v: ShownView,
    now: number,
    keep: string | null,
    issues = get().issues,
  ) {
    const inputs = [data, own, v, now, keep, issues],
      last = lastOrder;
    if (last?.inputs.every((x, i) => x === inputs[i])) return last.order;
    let order = inboxOrder(liveTitles(itemsOf(data), issues), own, v, now, keep, facets);
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
    // A read-only site keeps the mark for good, with its group, so new activity on the issue can end it (`tidyLocal`).
    if (firstPage()?.writable === false)
      return putLocal(heads, (old, head) => ({ ...old, read: value, group: items.find((i) => i.head === head)!.id }));
    for (const head of heads) marking.set(head, mark);
    // Unknown (no page yet) is a write resumed at boot; the server refuses it if the site is read-only.
    setLocal(heads, { read: value });
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
  /** Ends read marks that outlived their notification (QA round 4, D3): Linear's count is Jira's, so a mark counts only while
   *  it can still be true. On a writable site a mark lives only while its write is on the way (this tab's `marking`, or any
   *  tab's stored `pending`), so any other is left over. On a read-only site a mark is the only record, and it ends when the
   *  feed shows its group led by a newer notification. `feeds` are the loaded rows of every feed, and Jira's unread list. */
  function tidyLocal(feeds: Pick<InboxItem, "id" | "head">[]) {
    const own = localState(),
      writable = firstPage()?.writable;
    if (writable === undefined) return;
    let stale: string[];
    if (writable) {
      const pending = read<Pending>("pending", {});
      stale = Object.keys(own).filter(
        (head) => own[head]!.read !== undefined && !marking.has(head) && !pending[head],
      );
      if (stale.length) dropLocal(stale, "read", "group");
      return;
    }
    const heads = new Map<string, Set<string>>();
    for (const row of feeds) heads.set(row.id, (heads.get(row.id) ?? new Set()).add(row.head));
    stale = Object.keys(own).filter((head) => {
      const group = own[head]!.group,
        shown = group && heads.get(group);
      return !!shown && !shown.has(head);
    });
    if (stale.length) putLocal(stale, () => undefined);
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
    tidyLocal([]);
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
  /** Applies `patch` to rows here and remembers its undo. When the rows leave the list (`advance`), the next one is selected as
   *  Linear does; a `toast` offers Linear's undo. Returns what the undo restores, so more rows can join it. */
  function hide(
    items: InboxItem[],
    patch: Local,
    label: string,
    {
      toast,
      activate = selectRow,
      advance = true,
    }: { toast?: string; activate?: (item: InboxItem) => void; advance?: boolean },
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
    if (advance && selectedId && gone.has(selectedId)) {
      if (next) activate(next);
      else leaveRow();
    }
    const entry = remember(label, () => {
      restoreLocal(before);
      if (was && gone.has(was.id) && selectedId !== was.id) showRow(was);
    });
    if (toast) {
      toastUndo = entry;
      showNotification({ text: toast, undo: undoInboxToast }, INBOX_NOTIFICATION_ID);
    }
    return before;
  }
  /** Nothing selected: the inbox's root, with no notification open. */
  function leaveRow() {
    cancelRead();
    selectedId = null;
    emit();
    ports.clearSelection();
  }
  /** Linear's E and ⌫. Jira notifications cannot be deleted, so this hides the row in this browser until the issue has new activity. */
  function deleteRow(item = selectedRow()) {
    if (item)
      hide([item], { deleted: true }, "delete notification", { toast: "Notification deleted" });
  }
  const closed = (item: InboxItem) =>
    ["Completed", "Canceled", "Duplicate"].includes(facets(item).statusType);
  /** Loads the feed's older pages, as Linear holds every notification in memory. Ponytail: 20 pages (about 1,000
   *  notifications) at most; anything older stays unloaded. */
  async function loadAll(category: Category) {
    const observer = feed(category);
    let result = observer.getCurrentResult();
    for (let i = 0; i < 20 && result.hasNextPage && !result.isError; i++)
      result = await observer.fetchNextPage({ cancelRefetch: false });
    return result;
  }
  /** Linear's Delete all, Delete all read and Delete all completed (`zEn`, `LEn`, `FEn`): every notification in the inbox, or
   *  in the priority inbox's open tab (`XJ`), whatever the filters, find or unread-only show, as Linear's dialog says ("all
   *  notifications in your inbox", QA round 4, D13). Snoozed rows stay unless Show snoozed is on (`KJ`); "completed" never
   *  takes them and takes only read rows of done or canceled issues (Linear's `eEn`, R3-inbox-D4). The whole feed, not just
   *  the loaded rows: the loaded ones go at once; older pages load and join the same undo (R2-inbox-D2). A bulk delete is not
   *  a visit: when it removes the selected row, the next one is selected without being marked read (R3-inbox-D1). */
  async function deleteAll(which: "all" | "read" | "completed") {
    const v = shownView(),
      tab = v.priorityInbox ? v.tab : undefined,
      category: Category = tab ?? "all";
    const inScope = (items: InboxItem[], now: number) =>
      visibleItems(items, localState(), { ...DEFAULT_VIEW, showSnoozed: true, priorityInbox: !!tab, tab: tab ?? "direct" }, now, null, facets).filter((r) => {
        const snoozed = (localState()[r.head]?.snoozed ?? 0) > now;
        if (snoozed && (which === "completed" || !v.showSnoozed)) return false;
        return which === "read" ? !r.unread : which === "completed" ? !r.unread && closed(r) : true;
      });
    const loaded = () => itemsOf(queryClient.getQueryData<InfiniteData<Feed, string>>(["inbox", category]));
    if (
      (!inScope(loaded(), get().clock).length && !feed(category).getCurrentResult().hasNextPage) ||
      !(await ports.confirm(deleteQuestion(which, { priorityInbox: !!tab, tab: v.tab })))
    )
      return;
    const items = inScope(loaded(), get().clock),
      toast =
        items.length === 1 ? "Notification deleted" : "Notifications deleted";
    const before = hide(items, { deleted: true }, "delete notifications", { toast, activate: showRow });
    const rest = inScope(itemsOf((await loadAll(category)).data), Date.now());
    if (!rest.length) return;
    if (!before)
      return void hide(rest, { deleted: true }, "delete notifications", { toast, activate: showRow });
    for (const r of rest) before.set(r.head, localState()[r.head]);
    setLocal(
      rest.map((r) => r.head),
      { deleted: true },
    );
  }
  /** The snooze menu's row (the right-clicked one, else the selected one), the step it opens on, and whether a key opened it
   *  (Linear's `keyboardInvoked`, which names its search "Snooze notification until…"). */
  let snoozing: { item?: InboxItem; step?: "custom"; invoked?: "keyboard" } = {};
  function openSnooze(options: typeof snoozing = {}) {
    snoozing = options;
    ui.send({ type: "overlay.open", overlay: "snooze" });
  }
  const snoozeMenu = () => ({ ...snoozing, item: snoozing.item ?? selectedRow() });
  /** Linear's snooze (`mEn`): the next row is selected only while snoozed rows are hidden (`BEn`); with Show snoozed on, the row
   *  stays selected and shows its "Snoozed for" line. Only the full-page view toasts "Notification snoozed", and it goes back to
   *  the inbox's root (`redirectToInboxRoot`, `HEn`). */
  function snoozeRow(until: number, item = snoozing.item ?? selectedRow()) {
    snoozing = {};
    if (!item) return;
    const page = ports.fullPage();
    hide([item], { snoozed: until }, "snooze notification", {
      advance: !shownView().showSnoozed && !page,
      toast: page ? "Notification snoozed" : undefined,
    });
    if (page) leaveRow();
  }
  /** Linear's Unsnooze notification (`pEn`'s first sub-action on a snoozed row): the snooze goes, with Z to put it back. */
  function unsnoozeRow(item = snoozing.item ?? selectedRow()) {
    snoozing = {};
    const before = item && localState()[item.head];
    if (!item || !before?.snoozed) return;
    dropLocal([item.head], "snoozed");
    remember("unsnooze notification", () => restoreLocal(new Map([[item.head, before]])));
  }
  /** Rows whose snooze ran out come back unread, in Jira too, as Linear's do, and remember when (`unsnoozedAt`). */
  function wakeSnoozed(items: InboxItem[], now: number) {
    const due = items.filter((i) => (localState()[i.head]?.snoozed ?? Infinity) <= now);
    if (!due.length) return;
    putLocal(
      due.map((i) => i.head),
      (old) => {
        const { snoozed, ...rest } = old ?? {};
        return { ...rest, unsnoozed: snoozed };
      },
    );
    void markRead(due, false);
  }
  /** Runs `wake` when the next snooze in `own` runs out (Linear unsnoozes at the time it shows), and returns its cancel. A wait
   *  longer than `setTimeout` keeps (24.8 days, under "A month from now") is waited for in steps. */
  function wakeAt(own: Record<string, Local>, wake: () => void) {
    const next = Math.min(...Object.values(own).map((l) => (l.snoozed && l.snoozed > Date.now() ? l.snoozed : Infinity)));
    if (next === Infinity) return;
    let cancel = () => {};
    const arm = () => {
      const left = next - Date.now();
      cancel = (ports.later ?? timeout)(() => (next - Date.now() > 0 ? arm() : wake()), Math.min(Math.max(left, 0), MAX_WAIT));
    };
    arm();
    return () => cancel();
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
    pushState,
    changePush,
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
    snoozeMenu,
    snoozeRow,
    unsnoozeRow,
    wakeSnoozed,
    wakeAt,
    tidyLocal,
    hasSelectedRow,
    showTab,
    priorityInbox,
    undoInbox,
    undoInboxToast,
    clearUnseen,
  };
}
