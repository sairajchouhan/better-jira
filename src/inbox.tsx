/** Linear's Inbox over Jira's in-app notifications. Read state goes to Jira; delete and snooze stay in this browser, because Jira's notification API has neither. */
import { InfiniteQueryObserver, type InfiniteData } from "@tanstack/query-core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { Avatar } from "./avatar";
import { statusById } from "./board-catalog";
import { Icon, StatusIcon, type IconName } from "./icons";
import {
  DEFAULT_VIEW,
  FILTER_FIELDS,
  describe,
  facetsOf,
  feedCategory,
  inboxOrder,
  missingIssueNote,
  shortAgo,
  snoozeChoices,
  snoozeTime,
  unreadCount,
  sameInboxOrder,
  visibleItems,
  type FilterField,
  type InboxFeed,
  type InboxItem,
  type InboxOrder,
  type InboxView,
  type Local,
} from "./inbox-model";
import { copyIssue, type CopyKind } from "./issue-copy";
import { Menu } from "./menu";
import { MenuSurface } from "./menu-surface";
import { shortcutLabel } from "./shortcuts";
import {
  boardOf,
  get,
  navigate,
  queryClient,
  set,
  toggleFavorite,
  ui,
  useStore,
  type Issue,
} from "./store";

type Feed = InboxFeed & { writable: boolean };
type Category = "all" | "direct" | "watching";

// --- local state: per head notification, plus the view's display options ---

const storageKey = (name: string) => `better-jira:inbox-${name}:v1:${get().namespace}`;
function read<T>(name: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(storageKey(name)) ?? "{}") };
  } catch {
    return fallback;
  }
}
function save(name: string, value: object) {
  try {
    localStorage.setItem(storageKey(name), JSON.stringify(value));
  } catch {
    set({ perf: "Could not save inbox state in this browser" });
  }
}
let local: Record<string, Local> | undefined, view: InboxView | undefined;
let selectedId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const localState = () => (local ??= read<Record<string, Local>>("local", {}));
const viewState = () => (view ??= read("view", DEFAULT_VIEW));
// Another tab's write: drop the cache so the next read sees it.
globalThis.addEventListener?.("storage", (e) => {
  const { key } = e as StorageEvent;
  if (key === storageKey("local")) local = undefined;
  else if (key === storageKey("view")) view = undefined;
  else return;
  emit();
});
/** Changes each head's local state (`undefined` drops it), on top of what is stored now, so another tab's changes to other heads survive. */
function putLocal(
  heads: string[],
  change: (old: Local | undefined, head: string) => Local | undefined,
) {
  const next = read<Record<string, Local> | null>("local", null) ?? { ...localState() };
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
export function changeView(patch: Partial<InboxView>) {
  view = { ...viewState(), ...patch };
  save("view", view);
  emit();
}
export const toggleFilter = (field: FilterField, value: string) => {
  const values = viewState().filters[field] ?? [];
  changeView({
    filters: {
      ...viewState().filters,
      [field]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
    },
  });
};
export const clearFilters = () => changeView({ filters: {} });
const useLocal = () => useSyncExternalStore(subscribe, localState);
const useView = () => useSyncExternalStore(subscribe, viewState);
const useSelected = () => useSyncExternalStore(subscribe, () => selectedId);

// --- data: TanStack Query, a page per Jira cursor; the server's SSE "inbox" message invalidates ["inbox"] ---

const options = (category: Category) => ({
  queryKey: ["inbox", category],
  queryFn: async ({ pageParam }: { pageParam: string }): Promise<Feed> => {
    const query = new URLSearchParams(category === "all" ? {} : { category });
    if (pageParam) query.set("after", pageParam);
    const res = await fetch(`/api/inbox${query.size ? `?${query}` : ""}`);
    if (!res.ok)
      throw new Error((await res.json().catch(() => null))?.error ?? "Inbox unavailable");
    const page: Feed = await res.json();
    if (!pageParam) save(`feed-${category}`, page);
    return page;
  },
  // The last first page shows at once on reload, and is refetched straight away (Jira's feed takes about a second).
  initialData: () => {
    const page = read<Partial<Feed>>(`feed-${category}`, {});
    return page.items ? { pages: [page as Feed], pageParams: [""] } : undefined;
  },
  initialDataUpdatedAt: 0,
  initialPageParam: "",
  getNextPageParam: (last: Feed) => (last.more && last.cursor) || undefined,
  staleTime: 30_000,
  refetchOnWindowFocus: true,
  refetchInterval: 5 * 60_000, // backstop; the server's unseen-count poll pushes changes sooner
});
function useFeed(category: Category) {
  const [observer] = useState(
    () =>
      new InfiniteQueryObserver<Feed, Error, InfiniteData<Feed, string>, string[], string>(
        queryClient,
        options(category),
      ),
  );
  useEffect(() => observer.setOptions(options(category)), [observer, category]);
  return useSyncExternalStore(
    useCallback((l) => observer.subscribe(l), [observer]),
    () => observer.getCurrentResult(),
  );
}
/** Every loaded page's rows; a row Jira repeats on a later page keeps its first place. */
function itemsOf(data?: InfiniteData<Feed, string>) {
  const seen = new Set<string>();
  return (data?.pages ?? [])
    .flatMap((p) => p.items)
    .filter((i) => !seen.has(i.id) && !!seen.add(i.id));
}
const firstPage = () =>
  queryClient.getQueryData<InfiniteData<Feed, string>>(["inbox", "all"])?.pages[0];

const statusOf = (key: string) => {
  const issue = get().issues.get(key);
  return (
    issue &&
    statusById(boardOf(issue.key), issue.status)
  );
};
/** Filter facts for a row; priority, project and status come from the mirror when the issue is in it. */
const facets = (item: InboxItem) =>
  facetsOf(item, get().issues.get(item.key), statusOf(item.key), projectNames());
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

/** Unread rows, as Linear counts them: every unread notification in Jira, not just the loaded pages. */
function useUnreadCount() {
  const { data } = useFeed("all");
  const own = useLocal();
  const now = useStore((s) => s.clock); // snoozes expire
  return { count: unreadCount(data?.pages[0]?.unread, itemsOf(data), own, now), data, own, now };
}
/** The sidebar badge. It is always mounted, so it also brings back expired snoozes: unread, as Linear does, and in Jira too. */
export function useInboxBadge() {
  const { count, data, own, now } = useUnreadCount();
  useEffect(() => {
    const due = itemsOf(data).filter((i) => (own[i.head]?.snoozed ?? Infinity) <= now);
    if (!due.length) return;
    dropLocal(
      due.map((i) => i.head),
      "snoozed",
    );
    void markRead(due, false);
  }, [data, own, now]);
  return count;
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
export function undoInbox(entry = undos.at(-1)) {
  const at = entry ? undos.indexOf(entry) : -1;
  if (!entry || at < 0) return;
  undos.splice(at, 1);
  entry.run();
  if (entry === toastUndo) ui.send({ type: "toast.dismiss" });
  set({ perf: `Undid ${entry.label}` });
}
export const undoInboxToast = () => undoInbox(toastUndo);

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
) {
  const inputs = [data, own, v, now, keep, get().issues],
    last = lastOrder;
  if (last?.inputs.every((x, i) => x === inputs[i])) return last.order;
  let order = inboxOrder(itemsOf(data), own, v, now, keep, facets);
  const onlyMirror = !!last && inputs.slice(0, 5).every((x, i) => x === last.inputs[i]);
  if (onlyMirror && sameInboxOrder(last!.order, order)) order = last!.order;
  lastOrder = { inputs, order };
  return order;
}
/** The rows on screen, in order: what the inbox's keys and actions act on. */
function shownRows() {
  const v = viewState();
  return orderOf(
    queryClient.getQueryData<InfiniteData<Feed, string>>(["inbox", feedCategory(v)]),
    localState(),
    v,
    get().clock,
    selectedId,
  ).rows;
}
const selectedRow = () => shownRows().find((r) => r.id === selectedId);

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
  if (label) remember(label, () => void markRead(items, !value, undefined, groups));
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
/** A row whose issue isn't mirrored has no `issue=` in the URL; this keeps it selected over a reload (R2-inbox-D6). The store drops it outside the inbox. */
const ROW_PARAM = "notification";
function keepRowInUrl(id: string | null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set(ROW_PARAM, id);
  else url.searchParams.delete(ROW_PARAM);
  if (url.href !== location.href) history.replaceState(history.state, "", url);
}
export function selectRow(item: InboxItem | undefined, open: "side" | "page" = "side") {
  if (!item) return;
  selectedId = item.id;
  emit();
  if (item.unread) void markRead([item], true);
  const issue = get().issues.get(item.key);
  if (issue) {
    keepRowInUrl(null);
    navigate({ board: issue.board, selected: issue.key, panel: true, view: open, inbox: true });
  } else {
    navigate({ selected: null, panel: false, inbox: true });
    keepRowInUrl(item.id);
  }
  requestAnimationFrame(() =>
    document
      .querySelector(`[data-inbox-row="${CSS.escape(item.id)}"]`)
      ?.scrollIntoView({ block: "nearest" }),
  );
}
export function moveRow(direction: number) {
  const rows = shownRows(),
    at = rows.findIndex((r) => r.id === selectedId);
  selectRow(rows[at < 0 ? 0 : at + direction]);
}
export const openRow = () => selectRow(selectedRow(), "page");
/** Linear's U. */
export function toggleRead(row = selectedRow()) {
  if (row) void markRead([row], row.unread, row.unread ? "mark as read" : "mark as unread");
}
const hasFilters = (v: InboxView) => Object.values(v.filters).some((values) => values?.length);
/** Linear's ⌥U: every row in the current view. With no tab or filter, Jira marks its whole feed. */
export function markAllRead() {
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
function hide(items: InboxItem[], patch: Local, label: string, toast: string) {
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
      keepRowInUrl(null);
      navigate({ selected: null, panel: false, inbox: true });
    }
  }
  toastUndo = remember(label, () => {
    putLocal([...before.keys()], (_, head) => before.get(head));
    if (was && gone.has(was.id)) selectRow(was);
  });
  ui.send({ type: "toast.show", text: toast, undo: "inbox" });
  return before;
}
/** Linear's E and ⌫. Jira notifications cannot be deleted, so this hides the row in this browser until the issue has new activity. */
export function deleteRow(item = selectedRow()) {
  if (item) hide([item], { deleted: true }, "delete notification", "Notification deleted");
}
const closed = (item: InboxItem) =>
  ["Completed", "Canceled", "Duplicate"].includes(facets(item).statusType);
/** Linear's Delete all: the whole feed, not just the loaded rows. The loaded ones go at once; older pages load and join the same undo (R2-inbox-D2). */
export async function deleteAll(which: "all" | "read" | "completed") {
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
    !confirm(`Delete all ${what}? Jira keeps them; this hides them in better-jira.`)
  )
    return;
  const items = rows.filter(matches),
    toast = items.length === 1 ? "Notification deleted" : "Notifications deleted";
  const before = hide(items, { deleted: true }, "delete notifications", toast);
  const v = viewState(),
    observer = new InfiniteQueryObserver<Feed, Error, InfiniteData<Feed, string>, string[], string>(
      queryClient,
      options(feedCategory(v)),
    );
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
  if (!before) return void hide(rest, { deleted: true }, "delete notifications", toast);
  for (const r of rest) before.set(r.head, localState()[r.head]);
  setLocal(
    rest.map((r) => r.head),
    { deleted: true },
  );
}
/** The row a snooze applies to: the right-clicked one, else the selected one. */
let snoozeTarget: InboxItem | undefined,
  snoozeCustom = false;
export function openSnooze(item?: InboxItem, custom = false) {
  snoozeTarget = item;
  snoozeCustom = custom;
  ui.send({ type: "overlay.open", overlay: "snooze" });
}
export function snoozeRow(until: number, item = snoozeTarget ?? selectedRow()) {
  snoozeTarget = undefined;
  if (item) hide([item], { snoozed: until }, "snooze notification", "Notification snoozed");
}
export const hasSelectedRow = () => !!selectedRow();
/** Linear's ⌥1 and ⌥2: the priority inbox's tabs. */
export const showTab = (tab: InboxView["tab"]) => changeView({ tab });
export const priorityInbox = () => viewState().priorityInbox;
const copyRow = (item: InboxItem, kind: CopyKind) =>
  copyIssue(kind, { key: item.key, summary: item.title } as Issue, item.url);
/** Unseen is Jira's bell count; opening the inbox clears it, as opening the bell does. */
let clearing = false;
async function clearUnseen() {
  if (clearing || !firstPage()?.writable || !firstPage()?.unseen) return;
  clearing = true;
  try {
    await send({ action: "seen" });
    queryClient.setQueryData<InfiniteData<Feed, string>>(
      ["inbox", "all"],
      (d) => d && { ...d, pages: d.pages.map((p, i) => (i ? p : { ...p, unseen: 0 })) },
    );
  } catch {
    /* the bell count is cosmetic here */
  } finally {
    clearing = false;
  }
}

// --- UI ---

const HEADER_BTN =
  "grid size-7 place-items-center rounded-full text-fg-2 hover:bg-hover aria-pressed:bg-sel aria-pressed:text-fg aria-expanded:bg-hover";
const KIND_ICON: Partial<Record<InboxItem["kind"], IconName>> = {
  mentioned: "at",
  comment: "comment",
  reaction: "smile",
  assigned: "user",
  unassigned: "user",
  status: "status",
};

function Actor({ item }: { item: InboxItem }) {
  const icon = KIND_ICON[item.kind];
  return (
    <span className="relative mt-3 size-8 shrink-0">
      {item.actor ? (
        <Avatar user={{ id: item.actor.name, ...item.actor }} size={32} />
      ) : (
        <span className="grid size-8 place-items-center rounded-full bg-sel text-[12px] text-fg-2">
          <Icon name="bell" />
        </span>
      )}
      {icon && (
        <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-panel text-fg-2 [&_svg]:size-2.5">
          <Icon name={icon} size={10} />
        </span>
      )}
    </span>
  );
}

function Row({
  item,
  selected,
  now,
  onMenu,
}: {
  item: InboxItem;
  selected: boolean;
  now: number;
  onMenu: (item: InboxItem, point: { x: number; y: number }) => void;
}) {
  const issue = useStore((s) => s.issues.get(item.key));
  const status = issue && statusOf(issue.key);
  const ink = item.unread ? "text-fg" : "text-fg-3";
  return (
    <a
      href={item.url}
      data-inbox-row={item.id}
      data-unread={item.unread || undefined}
      aria-current={selected || undefined}
      aria-label={`${item.unread ? "Unread" : "Read"} ${item.key} ${item.title} ${describe(item)}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        selectRow(item);
      }}
      onKeyDown={(e) => {
        // A clicked row keeps focus, and Enter on a link would click it again: open the full page, as Enter does elsewhere.
        if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        selectRow(item, "page");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(item, { x: e.clientX, y: e.clientY });
      }}
      className={`mx-2 flex h-[55px] gap-3 rounded-lg px-2 ${selected ? "bg-sel" : "hover:bg-hover"}`}
    >
      <Actor item={item} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
        <span className={`flex min-w-0 items-center text-[13px] ${ink}`}>
          {item.key && (
            <span className="mr-1 shrink-0 font-[450] tracking-[-0.26px]">{item.key}</span>
          )}
          <span className="truncate font-medium">{item.title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-[5px] pl-1.5">
            {item.unread && (
              <span data-unread-dot className="size-2 rounded-full bg-accent" aria-hidden />
            )}
            {status ? (
              <StatusIcon status={status} />
            ) : item.status ? (
              <span title={item.status}>
                <StatusIcon status={{ name: item.status, category: "" }} />
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex min-w-0 gap-1.5 text-[12px] font-[450] text-fg-3">
          <span className="truncate">{describe(item)}</span>
          <span className="ml-auto shrink-0">{shortAgo(item.time, now)}</span>
        </span>
      </span>
    </a>
  );
}

const COPY: [CopyKind, string][] = [
  ["ID", "copy-id"],
  ["URL", "copy-url"],
  ["title", "copy-title"],
  ["title as link", "copy-link"],
];
/** Linear's row menu: read state, delete, snooze, favorite and copy. Favorite needs the issue in the mirror. */
function rowEntries(item: InboxItem): ActionEntry[] {
  const mirrored = get().issues.has(item.key),
    favorite = get().favorites.includes(item.key);
  return [
    {
      name: item.unread ? "Mark as read" : "Mark as unread",
      icon: "check",
      shortcut: shortcutLabel("inbox-read"),
      run: () => toggleRead(item),
    },
    {
      name: "Delete notification",
      icon: "trash",
      shortcut: shortcutLabel("inbox-backspace"),
      run: () => deleteRow(item),
    },
    {
      name: "Snooze",
      icon: "clock",
      shortcut: shortcutLabel("inbox-snooze"),
      children: [
        ...snoozeChoices().map((c) => ({
          name: c.label,
          shortcut: snoozeTime(c.until),
          run: () => snoozeRow(c.until, item),
        })),
        { name: "Custom…", run: () => openSnooze(item, true) },
      ],
    },
    ...(mirrored
      ? [
          {
            name: favorite ? "Remove from favorites" : "Favorite",
            icon: (favorite ? "starred" : "star") as IconName,
            shortcut: shortcutLabel("favorite"),
            divider: true,
            run: () => toggleFavorite(item.key),
          },
        ]
      : []),
    {
      name: "Copy",
      icon: "copy",
      divider: !mirrored,
      children: COPY.map(([kind, id]) => ({
        name: `Copy ${kind}`,
        shortcut: shortcutLabel(id),
        run: () => void copyRow(item, kind),
      })),
    },
  ];
}

const FIELD_ICON: Record<FilterField, IconName> = {
  type: "bell",
  from: "user",
  project: "layers",
  priority: "priority",
  statusType: "status",
};
const ORDER: Partial<Record<FilterField, string[]>> = {
  priority: ["No priority", "Urgent", "High", "Medium", "Low"],
  statusType: ["Triage", "Backlog", "Unstarted", "Started", "Completed", "Canceled", "Duplicate"],
};
/** Linear's filter menu: a submenu per field listing the values the rows have, with their counts; picking one toggles it. */
function filterEntries(base: InboxItem[], v: InboxView): ActionEntry[] {
  return FILTER_FIELDS.map(([field, name]) => {
    const counts = new Map<string, number>();
    for (const r of base) {
      const value = facets(r)[field];
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const value of v.filters[field] ?? []) counts.set(value, counts.get(value) ?? 0);
    const order = ORDER[field];
    const values = [...counts.keys()].sort((a, b) =>
      order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b),
    );
    return {
      name,
      icon: FIELD_ICON[field],
      children: values.map((value) => ({
        name: value,
        icon: v.filters[field]?.includes(value) ? ("check" as const) : undefined,
        shortcut: `${counts.get(value)} notification${counts.get(value) === 1 ? "" : "s"}`,
        run: () => toggleFilter(field, value),
      })),
    };
  });
}

/** A display option: a label with its switch or select. A panel row, not a menu row. */
const OPTION_ROW =
  "flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-[13px] hover:bg-sel";

function SnoozeMenu({ close }: { close: () => void }) {
  const [custom, setCustom] = useState(snoozeCustom);
  const [value, setValue] = useState("");
  // The dialog's own error, not the footer's status line: it goes with the dialog (R2-inbox-D7).
  const [error, setError] = useState("");
  return (
    <MenuSurface label="Snooze notification until…" command width={360} close={close}>
      {custom ? (
        <form
          className="flex flex-wrap items-center gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const until = new Date(value).getTime();
            if (!(until > Date.now())) return setError("Choose a future snooze time");
            close();
            snoozeRow(until);
          }}
        >
          <input
            type="datetime-local"
            aria-label="Snooze until"
            required
            autoFocus
            value={value}
            onChange={(e) => (setValue(e.target.value), setError(""))}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "snooze-error" : undefined}
            className="flex-1 rounded border border-line-2 bg-transparent px-2 py-1 text-[13px] text-fg"
          />
          <button type="submit" className="rounded bg-accent px-3 py-1 text-[13px] text-white">
            Snooze
          </button>
          {error && (
            <p id="snooze-error" role="alert" className="basis-full text-[12px] text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        // Linear's snooze options are an action menu (IB): the first choice is highlighted, arrows move, typing filters.
        <Menu>
          <Menu.Input autoFocus placeholder="Snooze until…" />
          <Menu.List>
            <Menu.Empty>No match</Menu.Empty>
            {snoozeChoices().map((c) => (
              <Menu.Item
                key={c.label}
                value={c.label}
                data-snooze={c.label}
                hint={snoozeTime(c.until)}
                onSelect={() => {
                  close();
                  snoozeRow(c.until);
                }}
              >
                {c.label}
              </Menu.Item>
            ))}
            <Menu.Item value="Custom…" onSelect={() => setCustom(true)}>
              Custom…
            </Menu.Item>
          </Menu.List>
        </Menu>
      )}
    </MenuSurface>
  );
}

function Menus({ base }: { base: InboxItem[] }) {
  const overlay = useStore((s) => s.overlay);
  useStore((s) => (s.overlay === "inbox-filter" ? s.issues : null)); // the filter menu's counts read mirrored issues
  const site = useStore((s) => s.site);
  const v = useView();
  const close = () => ui.send({ type: "overlay.close" });
  const toggle = (label: string, key: "showSnoozed" | "unreadFirst" | "priorityInbox") => (
    <label key={key} className={OPTION_ROW}>
      {label}
      <input
        type="checkbox"
        role="switch"
        // Focus starts inside the menu, so Escape closes it.
        data-autofocus={key === "priorityInbox" || undefined}
        checked={v[key]}
        onChange={(e) => changeView({ [key]: e.target.checked })}
        className="accent-[var(--accent)]"
      />
    </label>
  );
  const select = <K extends "grouping" | "ordering">(
    label: string,
    key: K,
    choices: [InboxView[K], string][],
  ) => (
    <label className={OPTION_ROW}>
      {label}
      <select
        aria-label={label}
        value={v[key]}
        onChange={(e) => changeView({ [key]: e.target.value })}
        className="rounded bg-sel px-1.5 py-0.5 text-[12px] text-fg"
      >
        {choices.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  if (overlay === "inbox-actions")
    return (
      <ActionMenu
        label="Notification actions"
        anchor={document.getElementById("inbox-actions")}
        entries={[
          {
            name: "Mark all as read",
            shortcut: shortcutLabel("inbox-read-all"),
            run: () => void markAllRead(),
          },
          { name: "Delete all", run: () => deleteAll("all") },
          {
            name: "Delete all read",
            shortcut: shortcutLabel("inbox-delete-read"),
            run: () => deleteAll("read"),
          },
          { name: "Delete all completed", run: () => deleteAll("completed") },
          // Jira's own notification settings: better-jira has none of its own.
          {
            name: "Go to settings",
            run: () =>
              window.open(`${site}/jira/settings/personal/notifications`, "_blank", "noopener"),
          },
        ]}
        close={close}
      />
    );
  if (overlay === "inbox-filter")
    return (
      <ActionMenu
        label="Filter"
        anchor={document.getElementById("inbox-filter")}
        align="end"
        highlight
        entries={filterEntries(base, v)}
        close={close}
      />
    );
  if (overlay === "inbox-display")
    return (
      <MenuSurface label="Display options" anchorId="inbox-display" width={300} close={close}>
        {toggle("Enable priority inbox", "priorityInbox")}
        {select("Group unreads by", "grouping", [
          ["none", "No grouping"],
          ["focus", "Focus"],
        ])}
        {select("Ordering", "ordering", [
          ["newest", "Newest"],
          ["oldest", "Oldest"],
          ["priority", "Priority"],
        ])}
        {toggle("Show snoozed", "showSnoozed")}
        {toggle("Show unread first", "unreadFirst")}
      </MenuSurface>
    );
  if (overlay === "snooze") return <SnoozeMenu close={close} />;
  return null;
}

/** Linear's filter chips under the header: "Field is value", "is any of" for several; × removes one, Clear removes all. */
function FilterChips({ v }: { v: InboxView }) {
  const active = FILTER_FIELDS.filter(([field]) => v.filters[field]?.length);
  if (!active.length) return null;
  return (
    <div
      aria-label="Active filters"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b-[0.5px] border-frame px-3 py-1.5"
    >
      {active.map(([field, name]) => {
        const values = v.filters[field]!;
        return (
          <span
            key={field}
            data-inbox-chip={field}
            className="flex h-6 items-center gap-1 rounded-full border-[0.5px] border-line-2 pr-1 pl-2 text-[12px] text-fg-3"
          >
            {name} {values.length > 1 ? "is any of" : "is"}
            <span className="text-fg-2">{values.join(", ")}</span>
            <button
              aria-label={`Remove ${name} filter`}
              onClick={() => changeView({ filters: { ...v.filters, [field]: [] } })}
              className="grid size-4 place-items-center rounded-full hover:bg-hover hover:text-fg"
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        );
      })}
      <button onClick={clearFilters} className="ml-auto text-[12px] text-fg-3 hover:text-fg">
        Clear
      </button>
    </div>
  );
}

/** The list pane: Linear's 416px column with its own 44px header. Older pages load as the end of the list scrolls into view. */
export function InboxList() {
  const v = useView();
  const feed = useFeed(feedCategory(v));
  const { data, error, isPending, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  const { data: all } = useFeed("all");
  const own = useLocal();
  const selected = useSelected();
  const now = useStore((s) => s.clock);
  const items = itemsOf(data);
  // Filters and grouping read mirrored issues: a store change re-renders the list only when its rows change.
  const { base, groups, rows } = useStore(() => orderOf(data, own, v, now, selected));
  const [menu, setMenu] = useState<{ item: InboxItem; point: { x: number; y: number } } | null>(
    null,
  );
  const list = useRef<HTMLDivElement>(null),
    end = useRef<HTMLDivElement>(null);
  const unseen = all?.pages[0]?.unseen ?? 0;
  useEffect(() => {
    if (unseen) void clearUnseen();
  }, [unseen]);
  const pages = data?.pages.length ?? 0;
  // A reload keeps the open issue, or a row outside the mirror, in the URL: select its row again, so U, E and H act on it.
  const issueKey = useStore((s) => (s.inbox ? s.selected : null)),
    rowId = issueKey ? null : new URLSearchParams(location.search).get(ROW_PARAM);
  const known = items.some((r) => (issueKey ? r.key === issueKey : r.id === rowId));
  useEffect(() => {
    if (selectedId || (!issueKey && !rowId)) return;
    const row = rows.find((r) => (issueKey ? r.key === issueKey : r.id === rowId));
    if (row) {
      selectedId = row.id;
      emit();
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Re-select the issue when its mirror row becomes available.
  }, [issueKey, rowId, known]);
  useEffect(() => {
    if (!end.current || !hasNextPage || isFetchingNextPage) return;
    // A fresh observer reports at once, so a short or fully filtered page keeps loading while the end stays in view.
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && void fetchNextPage(),
      { root: list.current, rootMargin: "200px" },
    );
    observer.observe(end.current);
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Reobserve the load sentinel after a page appends rows.
  }, [hasNextPage, isFetchingNextPage, pages, fetchNextPage]);
  const filtered = hasFilters(v) || v.unreadOnly;
  return (
    <section
      aria-label="Inbox"
      className="flex w-[416px] shrink-0 flex-col border-r-[0.5px] border-frame max-md:w-full"
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b-[0.5px] border-frame px-2">
        <h2 className="px-2.5 text-[13px] font-medium text-fg-2">Inbox</h2>
        <button
          id="inbox-actions"
          aria-label="Notification actions"
          aria-expanded={useStore((s) => s.overlay === "inbox-actions")}
          onClick={() => ui.send({ type: "overlay.open", overlay: "inbox-actions" })}
          className={HEADER_BTN}
        >
          <Icon name="dots" />
        </button>
        {v.priorityInbox && (
          <span role="tablist" aria-label="Priority inbox" className="ml-1 flex gap-1">
            {(
              [
                ["direct", "Priority", "Alt+1"],
                ["watching", "Other", "Alt+2"],
              ] as const
            ).map(([tab, label, key]) => (
              <button
                key={tab}
                role="tab"
                aria-selected={v.tab === tab}
                title={`${label} (${key.replace("Alt+", "⌥")})`}
                onClick={() => showTab(tab)}
                className="h-7 rounded-full px-2.5 text-[12px] font-medium text-fg-3 aria-selected:bg-sel aria-selected:text-fg"
              >
                {label}
              </button>
            ))}
          </span>
        )}
        <span className="flex-1" />
        <button
          aria-label={v.unreadOnly ? "Show read" : "Show unreads only"}
          title={v.unreadOnly ? "Show read" : "Show unreads only"}
          aria-pressed={v.unreadOnly}
          onClick={() => changeView({ unreadOnly: !v.unreadOnly })}
          className={HEADER_BTN}
        >
          <Icon name="inbox" />
        </button>
        <button
          id="inbox-filter"
          aria-label="Add filter"
          title={`Add filter (${shortcutLabel("filter")})`}
          aria-pressed={hasFilters(v)}
          onClick={() => ui.send({ type: "overlay.open", overlay: "inbox-filter" })}
          className={HEADER_BTN}
        >
          <Icon name="filter" />
        </button>
        <button
          id="inbox-display"
          aria-label="Display options"
          title="Display options"
          onClick={() => ui.send({ type: "overlay.open", overlay: "inbox-display" })}
          className={HEADER_BTN}
        >
          <Icon name="display" />
        </button>
      </header>
      <FilterChips v={v} />
      <div ref={list} role="list" className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {groups.map((group) => [
          group.label && (
            <div
              key={`group-${group.label}`}
              data-inbox-group={group.label}
              className="flex gap-1.5 px-4 pt-3 pb-1 text-[12px] font-medium text-fg-3"
            >
              {group.label}
              <span className="font-[450]">{group.rows.length}</span>
            </div>
          ),
          ...group.rows.map((item) => (
            <Row
              key={item.id}
              item={item}
              selected={item.id === selected}
              now={now}
              onMenu={(item, point) => setMenu({ item, point })}
            />
          )),
        ])}
        {!rows.length && (
          <div role="status" className="grid h-full place-items-center text-[13px] text-fg-3">
            {error ? (
              <span className="text-center">
                {error.message}
                <button
                  className="mt-2 block w-full text-fg-2 underline"
                  onClick={() => void refetch()}
                >
                  Retry
                </button>
              </span>
            ) : isPending || isFetchingNextPage ? (
              "Loading notifications…"
            ) : items.length && filtered ? (
              v.unreadOnly && !hasFilters(v) ? (
                "No unreads"
              ) : (
                "No matching notifications"
              )
            ) : (
              "No notifications"
            )}
          </div>
        )}
        {rows.length > 0 && isFetchingNextPage && (
          <div role="status" className="py-2 text-center text-[12px] text-fg-3">
            Loading older notifications…
          </div>
        )}
        <div ref={end} data-inbox-end aria-hidden className="h-px" />
      </div>
      <Menus base={base} />
      {menu && (
        <ActionMenu
          label="Notification options"
          point={menu.point}
          entries={rowEntries(menu.item)}
          close={() => setMenu(null)}
        />
      )}
    </section>
  );
}

/** Linear's notification actions in the open issue's header, while the inbox is open. */
export function InboxIssueActions() {
  useSelected();
  useLocal();
  if (!selectedRow()) return null;
  return (
    <>
      <button
        aria-label="Snooze notification"
        title={`Snooze notification (${shortcutLabel("inbox-snooze")})`}
        onClick={() => openSnooze()}
        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
      >
        <Icon name="clock" />
      </button>
      <button
        aria-label="Delete notification"
        title={`Delete notification (${shortcutLabel("inbox-backspace")})`}
        onClick={() => deleteRow()}
        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
      >
        <Icon name="trash" />
      </button>
    </>
  );
}

/** The right pane when no issue is open: Linear's empty state, or the notification itself when its issue is not in the mirror. */
export function InboxPane() {
  const selected = useSelected();
  const unread = useUnreadCount().count;
  const row = shownRows().find((r) => r.id === selected);
  if (row)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3 text-[12px] text-fg-3">
          {row.key}
          <InboxIssueActions />
          {COPY.slice(0, 2).map(([kind, id]) => (
            <button
              key={kind}
              aria-label={`Copy issue ${kind}`}
              title={`Copy issue ${kind} (${shortcutLabel(id)})`}
              onClick={() => void copyRow(row, kind)}
              className="grid size-7 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
            >
              <Icon name={kind === "URL" ? "link" : "copy"} />
            </button>
          ))}
          <span className="flex-1" />
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-fg"
          >
            Open in Jira <Icon name="external" />
          </a>
        </div>
        <div className="mx-auto w-full max-w-[680px] p-8">
          <h1 className="text-[24px] leading-8 font-medium text-fg">{row.title}</h1>
          <p className="mt-3 text-[13px] text-fg-2">{row.message}</p>
          {row.preview && (
            <blockquote className="mt-3 rounded-lg border border-line px-3 py-2 text-[13px] text-fg-2">
              {row.preview}
            </blockquote>
          )}
          <p className="mt-4 text-[12px] text-fg-3">
            {missingIssueNote(
              row.key,
              new Set([...get().issues.keys()].map((k) => k.split("-")[0]!)),
            )}
          </p>
        </div>
      </div>
    );
  return (
    <div className="grid min-w-0 flex-1 place-items-center max-md:hidden">
      <div className="flex flex-col items-center gap-4 text-fg-3">
        <svg
          width="105"
          height="100"
          viewBox="0 0 105 100"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M12 58 24 12a8 8 0 0 1 8-6h41a8 8 0 0 1 8 6l12 46v28a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" />
          <path d="M12 58h24l5 9h23l5-9h24" />
        </svg>
        <span className="text-[13px]">
          {unread > 0
            ? `${unread} unread notification${unread === 1 ? "" : "s"}`
            : "No notification selected"}
        </span>
      </div>
    </div>
  );
}
