/** Linear's Inbox over Jira's in-app notifications. Read state goes to Jira; delete and snooze stay in this browser, because Jira's notification API has neither. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { Avatar } from "./avatar";
import { Button, ButtonLink, IconButton } from "./button";
import { CountBadge } from "./count-badge";
import { EmptyState, LoadingState } from "./empty-state";
import { FutureTimeStep } from "./future-time-step";
import { FilterChip } from "./filter-chip";
import { Tabs } from "./tabs";
import { Text } from "./text";
import { Icon, StatusIcon, type IconName } from "./icons";
import {
  FILTER_FIELDS,
  describe,
  feedCategory,
  hasFilters,
  missingIssueNote,
  shortAgo,
  snoozeChoices,
  snoozeTime,
  unreadCount,
  type FilterField,
  type InboxItem,
  type InboxView,
} from "./inbox-model";
import { copyIssue, type CopyKind } from "./issue-copy";
import { Menu } from "./menu";
import { MenuSurface } from "./menu-surface";
import { shortcutLabel } from "./shortcuts";
import {
  statusOf as issueStatusOf,
  get,
  navigate,
  queryClient,
  set,
  toggleFavorite,
  ui,
  useStore,
  type Issue,
} from "./store";

import { createInboxStore, type Category } from "./inbox-store";
import { readStored, writeStored } from "./stored-state";
import { SelectRow, Toggle } from "./display-options";
const storageKey = (name: string) =>
  `better-jira:inbox-${name}:v1:${get().namespace}`;
const statusOf = (key: string) => {
  const issue = get().issues.get(key);
  return issue && issueStatusOf(issue);
};
/** A row whose issue isn't mirrored has no `issue=` in the URL; this keeps it selected over a reload (R2-inbox-D6). The store drops it outside the inbox. */
const ROW_PARAM = "notification";
function keepRowInUrl(id: string | null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set(ROW_PARAM, id);
  else url.searchParams.delete(ROW_PARAM);
  if (url.href !== location.href) history.replaceState(history.state, "", url);
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

const inbox = createInboxStore({
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
const {
  subscribe,
  localState,
  viewState,
  feed,
  itemsOf,
  facets,
  orderOf,
  dropLocal,
  markRead,
  clearUnseen,
} = inbox;
const useLocal = () => useSyncExternalStore(subscribe, localState);
const useView = () => useSyncExternalStore(subscribe, viewState);
const useSelected = () => useSyncExternalStore(subscribe, inbox.selected);
function useFeed(category: Category) {
  const observer = feed(category);
  return useSyncExternalStore(
    useCallback((l) => observer.subscribe(l), [observer]),
    () => observer.getCurrentResult(),
  );
}
/** Unread rows, as Linear counts them: every unread notification in Jira, not just the loaded pages. */
function useUnreadCount() {
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

const copyRow = (item: InboxItem, kind: CopyKind) =>
  copyIssue(kind, { key: item.key, summary: item.title } as Issue, item.url);

function useInboxOrder() {
  const v = useView();
  const { data } = useFeed(feedCategory(v));
  const own = useLocal();
  const selected = useSelected();
  return useStore((s) => orderOf(data, own, v, s.clock, selected, s.issues));
}
function useSelectedRow() {
  const selected = useSelected();
  return useInboxOrder().rows.find((row) => row.id === selected);
}
// --- UI ---

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
  const ink = item.unread ? "title" : "muted";
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
        if (
          e.key !== "Enter" ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
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
        <span className="flex min-w-0 items-center">
          {item.key && (
            <Text variant="small" color={ink} className="mr-1 shrink-0">
              {item.key}
            </Text>
          )}
          <Text variant="smallPlus" color={ink} wrap="truncate">
            {item.title}
          </Text>
          <span className="ml-auto flex shrink-0 items-center gap-[5px] pl-1.5">
            {item.unread && (
              <span
                data-unread-dot
                className="size-2 rounded-full bg-accent"
                aria-hidden
              />
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
        <span className="flex min-w-0 gap-1.5">
          <Text variant="mini" color="muted" wrap="truncate">
            {describe(item)}
          </Text>
          <Text variant="mini" color="muted" className="ml-auto shrink-0">
            {shortAgo(item.time, now)}
          </Text>
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
  statusType: [
    "Triage",
    "Backlog",
    "Unstarted",
    "Started",
    "Completed",
    "Canceled",
    "Duplicate",
  ],
};
/** Linear's filter menu: a submenu per field listing the values the rows have, with their counts; picking one toggles it. */
function filterEntries(base: InboxItem[], v: InboxView): ActionEntry[] {
  return FILTER_FIELDS.map(([field, name]) => {
    const counts = new Map<string, number>();
    for (const r of base) {
      const value = facets(r)[field];
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const value of v.filters[field] ?? [])
      counts.set(value, counts.get(value) ?? 0);
    const order = ORDER[field];
    const values = [...counts.keys()].sort((a, b) =>
      order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b),
    );
    return {
      name,
      icon: FIELD_ICON[field],
      children: values.map((value) => ({
        name: value,
        icon: v.filters[field]?.includes(value)
          ? ("check" as const)
          : undefined,
        shortcut: `${counts.get(value)} notification${counts.get(value) === 1 ? "" : "s"}`,
        run: () => toggleFilter(field, value),
      })),
    };
  });
}

function SnoozeMenu({ close }: { close: () => void }) {
  const [custom, setCustom] = useState(inbox.startCustom());
  return (
    // This command surface also hosts a searchable menu; Dialog would replace its command focus behavior.
    <MenuSurface
      label="Snooze notification until…"
      command
      width={360}
      close={close}
    >
      {custom ? (
        <FutureTimeStep
          label="Snooze until"
          submitLabel="Snooze"
          errorMessage="Choose a future snooze time"
          onBack={() => setCustom(false)}
          onPick={(at) => {
            close();
            snoozeRow(Date.parse(at));
          }}
        />
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

/** Linear keeps display controls in their own panel, separate from notification action menus. */
function InboxDisplayOptions({ close }: { close: () => void }) {
  const v = useView();
  return (
    <MenuSurface
      label="Display options"
      anchorId="inbox-display"
      width={300}
      close={close}
    >
      <Toggle
        label="Enable priority inbox"
        value={v.priorityInbox}
        onChange={() => changeView({ priorityInbox: !v.priorityInbox })}
      />
      <SelectRow
        label="Group unreads by"
        value={v.grouping}
        options={[
          ["none", "No grouping"],
          ["focus", "Focus"],
        ]}
        onChange={(value) =>
          changeView({ grouping: value as InboxView["grouping"] })
        }
      />
      <SelectRow
        label="Ordering"
        value={v.ordering}
        options={[
          ["newest", "Newest"],
          ["oldest", "Oldest"],
          ["priority", "Priority"],
        ]}
        onChange={(value) =>
          changeView({ ordering: value as InboxView["ordering"] })
        }
      />
      <Toggle
        label="Show snoozed"
        value={v.showSnoozed}
        onChange={() => changeView({ showSnoozed: !v.showSnoozed })}
      />
      <Toggle
        label="Show unread first"
        value={v.unreadFirst}
        onChange={() => changeView({ unreadFirst: !v.unreadFirst })}
      />
    </MenuSurface>
  );
}

function Menus({ base }: { base: InboxItem[] }) {
  const overlay = useStore((s) => s.overlay);

  const site = useStore((s) => s.site);
  const v = useView();
  const close = () => ui.send({ type: "overlay.close" });
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
              window.open(
                `${site}/jira/settings/personal/notifications`,
                "_blank",
                "noopener",
              ),
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
  if (overlay === "inbox-display") return <InboxDisplayOptions close={close} />;
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
          <FilterChip key={field} data-inbox-chip={field}>
            <FilterChip.Label>
              {name} {values.length > 1 ? "is any of" : "is"}
            </FilterChip.Label>
            <FilterChip.Value>{values.join(", ")}</FilterChip.Value>
            <FilterChip.Remove
              label={`Remove ${name} filter`}
              onClick={() =>
                changeView({ filters: { ...v.filters, [field]: [] } })
              }
            />
          </FilterChip>
        );
      })}
      <Button
        variant="muted"
        size="small"
        onClick={clearFilters}
        className="ml-auto"
      >
        Clear
      </Button>
    </div>
  );
}

/** The list pane: Linear's 416px column with its own 44px header. Older pages load as the end of the list scrolls into view. */
export function InboxList() {
  const v = useView();
  const feed = useFeed(feedCategory(v));
  const {
    data,
    error,
    isPending,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = feed;
  const { data: all } = useFeed("all");
  const selected = useSelected();
  const now = useStore((s) => s.clock);
  const items = itemsOf(data);
  // Filters and grouping read mirrored issues: a store change re-renders the list only when its rows change.
  const { base, groups, rows } = useInboxOrder();
  const [menu, setMenu] = useState<{
    item: InboxItem;
    point: { x: number; y: number };
  } | null>(null);
  const list = useRef<HTMLDivElement>(null),
    end = useRef<HTMLDivElement>(null);
  const unseen = all?.pages[0]?.unseen ?? 0;
  useEffect(() => {
    if (unseen) void clearUnseen();
  }, [unseen]);
  const pages = data?.pages.length ?? 0;
  // A reload keeps the open issue, or a row outside the mirror, in the URL: select its row again, so U, E and H act on it.
  const issueKey = useStore((s) => (s.inbox ? s.selected : null)),
    rowId = issueKey
      ? null
      : new URLSearchParams(location.search).get(ROW_PARAM);
  const known = items.some((r) =>
    issueKey ? r.key === issueKey : r.id === rowId,
  );
  useEffect(() => {
    if (inbox.selected() || (!issueKey && !rowId)) return;
    const row = rows.find((r) =>
      issueKey ? r.key === issueKey : r.id === rowId,
    );
    if (row) {
      inbox.restoreSelection(row.id);
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
  // Boolean selectors: another overlay opening elsewhere must not re-render the list.
  const actionsOpen = useStore((s) => s.overlay === "inbox-actions"),
    filterOpen = useStore((s) => s.overlay === "inbox-filter"),
    displayOpen = useStore((s) => s.overlay === "inbox-display");
  return (
    <section
      aria-label="Inbox"
      className="flex w-[416px] shrink-0 flex-col border-r-[0.5px] border-frame max-md:w-full"
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b-[0.5px] border-frame px-2">
        <Text as="h2" variant="smallPlus" color="base" className="px-2.5">
          Inbox
        </Text>
        <IconButton
          id="inbox-actions"
          label="Notification actions"
          aria-expanded={actionsOpen}
          onClick={() =>
            ui.send({ type: "overlay.open", overlay: "inbox-actions" })
          }
        >
          <Icon name="dots" />
        </IconButton>
        {v.priorityInbox && (
          <Tabs
            value={v.tab}
            onValueChange={(tab) => showTab(tab as InboxView["tab"])}
          >
            <Tabs.List aria-label="Priority inbox" className="ml-1">
              <Tabs.Tab value="direct" title="Priority (⌥1)">
                Priority
              </Tabs.Tab>
              <Tabs.Tab value="watching" title="Other (⌥2)">
                Other
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        )}
        <span className="flex-1" />
        <IconButton
          label={v.unreadOnly ? "Show read" : "Show unreads only"}
          aria-pressed={v.unreadOnly}
          onClick={() => changeView({ unreadOnly: !v.unreadOnly })}
        >
          <Icon name="inbox" />
        </IconButton>
        <IconButton
          id="inbox-filter"
          label="Add filter"
          tooltip="Filter"
          shortcut={shortcutLabel("filter")}
          aria-expanded={filterOpen}
          aria-pressed={hasFilters(v)}
          onClick={() =>
            ui.send({ type: "overlay.open", overlay: "inbox-filter" })
          }
        >
          <Icon name="filter" />
        </IconButton>
        <IconButton
          id="inbox-display"
          label="Display options"
          aria-expanded={displayOpen}
          onClick={() =>
            ui.send({ type: "overlay.open", overlay: "inbox-display" })
          }
        >
          <Icon name="display" />
        </IconButton>
      </header>
      <FilterChips v={v} />
      <div
        ref={list}
        role="list"
        className="min-h-0 flex-1 overflow-y-auto py-1.5"
      >
        {groups.map((group) => [
          group.label && (
            <Text
              as="div"
              variant="miniPlus"
              color="muted"
              key={`group-${group.label}`}
              data-inbox-group={group.label}
              className="flex gap-1.5 px-4 pt-3 pb-1"
            >
              {group.label}
              <CountBadge>{group.rows.length}</CountBadge>
            </Text>
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
        {!rows.length &&
          (error ? (
            <EmptyState
              role="status"
              className="h-full"
              title={error.message}
              actions={
                <Button
                  variant="secondary"
                  size="medium"
                  onClick={() => void refetch()}
                >
                  Retry
                </Button>
              }
            />
          ) : isPending || isFetchingNextPage ? (
            <LoadingState className="h-full">
              Loading notifications…
            </LoadingState>
          ) : (
            <EmptyState
              role="status"
              className="h-full"
              title={
                items.length && filtered
                  ? v.unreadOnly && !hasFilters(v)
                    ? "No unreads"
                    : "No matching notifications"
                  : "No notifications"
              }
            />
          ))}
        {rows.length > 0 && isFetchingNextPage && (
          <LoadingState className="py-2">
            Loading older notifications…
          </LoadingState>
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
  const row = useSelectedRow();
  if (!row) return null;
  return (
    <>
      <IconButton
        label="Snooze notification"
        shortcut={shortcutLabel("inbox-snooze")}
        onClick={() => openSnooze()}
      >
        <Icon name="clock" />
      </IconButton>
      <IconButton
        label="Delete notification"
        shortcut={shortcutLabel("inbox-backspace")}
        onClick={() => deleteRow()}
      >
        <Icon name="trash" />
      </IconButton>
    </>
  );
}

/** The right pane when no issue is open: Linear's empty state, or the notification itself when its issue is not in the mirror. */
export function InboxPane() {
  const row = useSelectedRow();
  const unread = useUnreadCount().count;
  if (row)
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3">
          <Text variant="mini" color="muted">
            {row.key}
          </Text>
          <InboxIssueActions />
          {COPY.slice(0, 2).map(([kind, id]) => (
            <IconButton
              key={kind}
              label={`Copy issue ${kind}`}
              shortcut={shortcutLabel(id)}
              onClick={() => void copyRow(row, kind)}
            >
              <Icon name={kind === "URL" ? "link" : "copy"} />
            </IconButton>
          ))}
          <span className="flex-1" />
          <ButtonLink variant="link" size="small" href={row.url} target="_blank" rel="noreferrer">
            Open in Jira <Icon name="external" />
          </ButtonLink>
        </div>
        <div className="mx-auto w-full max-w-[680px] p-8">
          <Text as="h1" variant="title2">
            {row.title}
          </Text>
          <Text as="p" variant="small" color="base" className="mt-3">
            {row.message}
          </Text>
          {row.preview && (
            <blockquote className="mt-3 rounded-lg border border-line px-3 py-2">
              <Text variant="small" color="base">
                {row.preview}
              </Text>
            </blockquote>
          )}
          <Text as="p" variant="mini" color="muted" className="mt-4">
            {missingIssueNote(
              row.key,
              new Set([...get().issues.keys()].map((k) => k.split("-")[0]!)),
            )}
          </Text>
        </div>
      </div>
    );
  return (
    <EmptyState
      className="min-w-0 max-md:hidden"
      title={
        unread > 0
          ? `${unread} unread notification${unread === 1 ? "" : "s"}`
          : "No notification selected"
      }
      icon={
        <svg
          className="text-fg-3"
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
      }
    />
  );
}
