/** Linear's Inbox over Jira's in-app notifications. Read state goes to Jira; delete and snooze stay in this browser. */
import { QueryObserver } from "@tanstack/query-core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Icon, StatusIcon, type IconName } from "./icons";
import {
  DEFAULT_VIEW,
  describe,
  shortAgo,
  snoozeChoices,
  visibleItems,
  type InboxFeed,
  type InboxItem,
  type InboxView,
  type Local,
} from "./inbox-model";
import { MENU_ITEM, MenuSurface } from "./menu-surface";
import { boardOf, get, navigate, queryClient, set, ui, useStore } from "./store";

type Feed = InboxFeed & { writable: boolean };
type Category = InboxView["category"];

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
function setLocal(heads: string[], patch: Local) {
  const next = { ...localState() };
  for (const head of heads) next[head] = { ...next[head], ...patch };
  local = next;
  save("local", next);
  emit();
}
function dropLocal(heads: string[], key: keyof Local) {
  const next = { ...localState() };
  for (const head of heads) {
    const { [key]: _, ...rest } = next[head] ?? {};
    if (Object.keys(rest).length) next[head] = rest;
    else delete next[head];
  }
  local = next;
  save("local", next);
  emit();
}
export function changeView(patch: Partial<InboxView>) {
  view = { ...viewState(), ...patch };
  save("view", view);
  emit();
}
const useLocal = () => useSyncExternalStore(subscribe, localState);
const useView = () => useSyncExternalStore(subscribe, viewState);
const useSelected = () => useSyncExternalStore(subscribe, () => selectedId);

// --- data: TanStack Query; the server's SSE "inbox" message invalidates ["inbox"] ---

const options = (category: Category) => ({
  queryKey: ["inbox", category],
  queryFn: async (): Promise<Feed> => {
    const res = await fetch(`/api/inbox${category === "all" ? "" : `?category=${category}`}`);
    if (!res.ok)
      throw new Error((await res.json().catch(() => null))?.error ?? "Inbox unavailable");
    return res.json();
  },
  staleTime: 30_000,
  refetchOnWindowFocus: true,
  refetchInterval: 5 * 60_000, // backstop; the server's unseen-count poll pushes changes sooner
});
function useFeed(category: Category) {
  const [observer] = useState(() => new QueryObserver(queryClient, options(category)));
  useEffect(() => observer.setOptions(options(category)), [observer, category]);
  return useSyncExternalStore(
    useCallback((l) => observer.subscribe(l), [observer]),
    () => observer.getCurrentResult(),
  );
}
const cached = (category: Category) => queryClient.getQueryData<Feed>(["inbox", category]);

/** The sidebar badge: unread rows, as Linear counts them. */
export function useInboxBadge() {
  const { data } = useFeed("all");
  const own = useLocal();
  useStore((s) => s.clock); // snoozes expire
  return data ? visibleItems(data.items, own, { ...DEFAULT_VIEW, unreadOnly: true }).length : 0;
}

// --- actions (also the keyboard shortcuts) ---

/** The rows on screen, in order; the list sets it as it renders. */
let rows: InboxItem[] = [];
const selectedRow = () => rows.find((r) => r.id === selectedId);

async function send(body: object) {
  const res = await fetch("/api/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Jira refused");
}
/** Shown at once; on a writable site Jira takes it and the local override goes once the feed agrees. */
async function markRead(items: InboxItem[], value: boolean) {
  if (!items.length) return;
  const heads = items.map((i) => i.head);
  setLocal(heads, { read: value });
  if (!cached("all")?.writable) return;
  try {
    await send({ action: value ? "read" : "unread", groups: items.map((i) => i.id) });
    await queryClient.invalidateQueries({ queryKey: ["inbox"] });
    dropLocal(heads, "read");
  } catch (error) {
    dropLocal(heads, "read");
    set({ perf: `Could not update Jira: ${(error as Error).message}` });
  }
}
export function selectRow(item: InboxItem | undefined, open: "side" | "page" = "side") {
  if (!item) return;
  selectedId = item.id;
  emit();
  if (item.unread) void markRead([item], true);
  const issue = get().issues.get(item.key);
  if (issue)
    navigate({ board: issue.board, selected: issue.key, panel: true, view: open, inbox: true });
  else navigate({ selected: null, panel: false, inbox: true });
  requestAnimationFrame(() =>
    document
      .querySelector(`[data-inbox-row="${CSS.escape(item.id)}"]`)
      ?.scrollIntoView({ block: "nearest" }),
  );
}
export function moveRow(direction: number) {
  const at = rows.findIndex((r) => r.id === selectedId);
  selectRow(rows[at < 0 ? 0 : at + direction]);
}
export const openRow = () => selectRow(selectedRow(), "page");
/** Linear's U. */
export function toggleRead() {
  const row = selectedRow();
  if (row) void markRead([row], row.unread);
}
/** Linear's ⌥U: every row in the current filter. */
export async function markAllRead() {
  const unread = rows.filter((r) => r.unread);
  setLocal(
    unread.map((r) => r.head),
    { read: true },
  );
  if (!cached("all")?.writable || !unread.length) return;
  try {
    const category = viewState().category;
    if (category === "all") await send({ action: "read-all" });
    else await send({ action: "read", groups: unread.map((r) => r.id) });
    await queryClient.invalidateQueries({ queryKey: ["inbox"] });
    dropLocal(
      unread.map((r) => r.head),
      "read",
    );
  } catch (error) {
    set({ perf: `Could not update Jira: ${(error as Error).message}` });
  }
}
/** Removes rows here and selects the next one, as Linear does after delete or snooze. */
function hide(items: InboxItem[], patch: Local) {
  if (!items.length) return;
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
      navigate({ selected: null, panel: false, inbox: true });
    }
  }
}
/** Linear's E. Jira notifications cannot be deleted, so this hides the row until the issue has new activity. */
export const deleteRow = () => hide(selectedRow() ? [selectedRow()!] : [], { deleted: true });
const completed = (item: InboxItem) => {
  const issue = get().issues.get(item.key),
    status =
      issue &&
      boardOf(issue.key)
        ?.columns.flatMap((c) => c.statuses)
        .find((s) => s.id === issue.status);
  return status
    ? status.category === "done"
    : /done|closed|resolved|complete|cancel/i.test(item.status);
};
export function deleteAll(which: "all" | "read" | "completed") {
  const items = rows.filter((r) =>
    which === "read" ? !r.unread : which === "completed" ? completed(r) : true,
  );
  const what =
    which === "read"
      ? "read notifications"
      : which === "completed"
        ? "notifications for completed issues"
        : "notifications";
  if (
    items.length &&
    confirm(`Delete all ${what}? Jira keeps them; this hides them in better-jira.`)
  )
    hide(items, { deleted: true });
}
export const snoozeRow = (until: number) =>
  hide(selectedRow() ? [selectedRow()!] : [], { snoozed: until });
export const hasSelectedRow = () => !!selectedRow();
/** Unseen is Jira's bell count; opening the inbox clears it, as opening the bell does. */
let clearing = false;
async function clearUnseen() {
  if (clearing || !cached("all")?.writable || !cached("all")?.unseen) return;
  clearing = true;
  try {
    await send({ action: "seen" });
    queryClient.setQueryData<Feed>(["inbox", "all"], (d) => d && { ...d, unseen: 0 });
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
  const [broken, setBroken] = useState(false);
  const icon = KIND_ICON[item.kind];
  return (
    <span className="relative mt-3 size-8 shrink-0">
      {item.actor?.avatar && !broken ? (
        <img
          src={item.actor.avatar}
          alt=""
          onError={() => setBroken(true)}
          className="size-8 rounded-full"
        />
      ) : (
        <span className="grid size-8 place-items-center rounded-full bg-sel text-[12px] text-fg-2">
          {item.actor?.name[0] ?? <Icon name="bell" />}
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

function Row({ item, selected, now }: { item: InboxItem; selected: boolean; now: number }) {
  const issue = useStore((s) => s.issues.get(item.key));
  const status =
    issue &&
    boardOf(issue.key)
      ?.columns.flatMap((c) => c.statuses)
      .find((s) => s.id === issue.status);
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

function Menus({ anchor }: { anchor: string }) {
  const overlay = useStore((s) => s.overlay);
  const v = useView();
  const close = () => ui.send({ type: "overlay.close" });
  const item = (label: string, run: () => void, hint?: string, checked?: boolean) => (
    <button
      key={label}
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={MENU_ITEM}
      onClick={() => {
        close();
        run();
      }}
    >
      <span className="flex-1">{label}</span>
      {checked && <Icon name="check" />}
      {hint && <kbd className="text-fg-3">{hint}</kbd>}
    </button>
  );
  const toggle = (label: string, key: "showSnoozed" | "unreadFirst") => (
    <label key={key} className={`${MENU_ITEM} justify-between`}>
      {label}
      <input
        type="checkbox"
        role="switch"
        checked={v[key]}
        onChange={(e) => changeView({ [key]: e.target.checked })}
        className="accent-[var(--accent)]"
      />
    </label>
  );
  if (overlay === "inbox-actions")
    return (
      <MenuSurface label="Notification actions" anchorId={anchor} fit close={close}>
        {item("Mark all as read", () => void markAllRead(), "⌥U")}
        {item("Delete all", () => deleteAll("all"))}
        {item("Delete all read", () => deleteAll("read"), "⇧⌫")}
        {item("Delete all completed", () => deleteAll("completed"))}
      </MenuSurface>
    );
  if (overlay === "inbox-filter")
    return (
      <MenuSurface label="Filter notifications" anchorId="inbox-filter" fit close={close}>
        {(
          [
            ["all", "All notifications"],
            ["direct", "Direct"],
            ["watching", "Watching"],
          ] as const
        ).map(([category, label]) =>
          item(label, () => changeView({ category }), undefined, v.category === category),
        )}
      </MenuSurface>
    );
  if (overlay === "inbox-display")
    return (
      <MenuSurface label="Display options" anchorId="inbox-display" width={300} close={close}>
        <label className={`${MENU_ITEM} justify-between`}>
          Ordering
          <select
            aria-label="Ordering"
            value={v.oldest ? "oldest" : "newest"}
            onChange={(e) => changeView({ oldest: e.target.value === "oldest" })}
            className="rounded bg-sel px-1.5 py-0.5 text-[12px] text-fg"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
        {toggle("Show snoozed", "showSnoozed")}
        {toggle("Show unread first", "unreadFirst")}
      </MenuSurface>
    );
  if (overlay === "snooze")
    return (
      <MenuSurface label="Snooze notification until…" command width={360} close={close}>
        {snoozeChoices().map((c) =>
          item(
            c.label,
            () => snoozeRow(c.until),
            new Date(c.until).toLocaleDateString("en", {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
          ),
        )}
      </MenuSurface>
    );
  return null;
}

/** The list pane: Linear's 416px column with its own 44px header. */
export function InboxList() {
  const v = useView();
  const { data, error, isPending, refetch } = useFeed(v.category);
  const { data: all } = useFeed("all");
  const own = useLocal();
  const selected = useSelected();
  const now = useStore((s) => s.clock);
  const unseen = all?.unseen ?? 0;
  useEffect(() => {
    if (unseen) void clearUnseen();
  }, [unseen]);
  // ponytail: module-level row cache so shortcuts act on what is on screen; a store field if a second list ever renders.
  rows = data ? visibleItems(data.items, own, v, now, selected) : [];
  const filtered = v.category !== "all" || v.unreadOnly;
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
          aria-label="Filter"
          title="Filter"
          aria-pressed={v.category !== "all"}
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
      <div role="list" className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {rows.map((item) => (
          <Row key={item.id} item={item} selected={item.id === selected} now={now} />
        ))}
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
            ) : isPending ? (
              "Loading notifications…"
            ) : data?.items.length && filtered ? (
              v.unreadOnly ? (
                "No unreads"
              ) : (
                "No matching notifications"
              )
            ) : (
              "No notifications"
            )}
          </div>
        )}
      </div>
      <Menus anchor="inbox-actions" />
    </section>
  );
}

/** The right pane when no issue is open: Linear's empty state, or the notification itself when its issue is not in the mirror. */
export function InboxPane() {
  const selected = useSelected();
  useLocal();
  const row = rows.find((r) => r.id === selected);
  const unread = rows.filter((r) => r.unread).length;
  if (row)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] text-fg-3">
          {row.key}
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
            This issue is outside your mirrored boards, so it opens in Jira.
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
