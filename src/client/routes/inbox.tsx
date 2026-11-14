import { type Issue } from "@/shared/issue-model";
/** Linear's Inbox over Jira's in-app notifications. Read state goes to Jira; delete and snooze stay in this browser, because Jira's notification API has neither. */
import { useEffect, useRef, useState, type Ref } from "react";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { Avatar } from "@/client/components/avatar";
import { Button, ButtonLink, IconButton } from "@/client/components/button";
import { CountBadge } from "@/client/components/count-badge";
import { EmptyState, LoadingState } from "@/client/components/empty-state";
import { FutureTimeStep } from "@/client/features/reminders/future-time-step";
import { FilterChip } from "@/client/components/filter-chip";
import { FindField } from "@/client/components/find-field";
import { Tabs } from "@/client/components/tabs";
import { Text } from "@/client/components/text";
import { Icon, StatusIcon, TypeDot, type IconName } from "@/client/components/icons";
import { FILTER_FIELDS, describe, groupSummary, rowLabel, feedCategory, hasFilters, missingIssueNote, shortAgo, type FilterField, type InboxItem, type InboxView, snoozeMarks, type SnoozeMarks } from "@/shared/inbox-model";
import { CommentCard, InboxGroupUpdates } from "@/client/features/inbox/inbox-group";
import { TIME_PLACEHOLDER, TimeOptionRows } from "@/client/features/time-options/time-option-rows";
import { snoozedFor } from "@/shared/time-options";
import { SnoozedLine, UnsnoozedMark } from "@/client/features/inbox/snooze-marks";
import { fullTime } from "@/client/features/issue/issue-dates";
import { copyIssue, type CopyKind } from "@/client/features/issue/issue-copy";
import { Menu } from "@/client/components/menu";
import { MenuSurface } from "@/client/components/menu-surface";
import { ConfirmDialog } from "@/client/components/dialog";
import { hotkeyOf, runShortcut } from "@/client/features/navigation/shortcuts";
import { focusNode, useCommand } from "@/client/features/navigation/commands";
import { shortcutTitle } from "@/client/components/keycap";
import { get, isWatching, useStore } from "@/client/state/store";
import { preloadOnHover, ui } from "@/client/features/navigation/app-navigation";
import { SidebarToggle } from "@/client/features/navigation/breadcrumbs";
import { useSearch } from "@tanstack/react-router";
import { toggleFavorite } from "@/client/features/navigation/favorites";

import { usePush, changeView, toggleFilter, clearFilters, selectRow, toggleRead, markAllRead, deleteRow, deleteAll, openSnooze, snoozeMenu, snoozeRow, unsnoozeRow, showTab, inbox, statusOf, ROW_PARAM, useFeed, useSelected, useView, useShownView, useFind, openFind, setFind, closeFind, useLocal, useUnreadCount, orderOf, facets, itemsOf, clearUnseen, useConfirmation } from "@/client/features/inbox/inbox";
import { InboxIssuePane } from "./issue-view";
import { firstKey } from "@/client/state/jira-sync";
import { SelectRow, Toggle, ViewOptions } from "@/client/components/display-options";
import { PUSH_CATEGORIES, pushCategoryOn } from "@/shared/inbox-push";
import { disableDesktopNotifications, enableDesktopNotifications, pushPermission } from "@/client/features/inbox/desktop-notifications";

const copyRow = (item: InboxItem, kind: CopyKind) =>
  copyIssue(kind, { key: item.key, summary: item.title } as Issue, item.url);

function useInboxOrder() {
  const v = useShownView();
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

export function Row({
  item,
  selected,
  now,
  snoozedUntil,
  unsnoozedAt,
  onMenu,
}: {
  item: InboxItem;
  selected: boolean;
  now: number;
  onMenu: (item: InboxItem, point: { x: number; y: number }) => void;
} & SnoozeMarks) {
  const issue = useStore((s) => s.issues.get(item.key));
  const status = issue && statusOf(issue.key);
  const ink = item.unread ? "title" : "muted";
  const summary = groupSummary(item);
  return (
    <a
      href={item.link || item.url}
      data-inbox-row={item.id}
      data-unread={item.unread || undefined}
      aria-current={selected || undefined}
      aria-label={rowLabel(item, status?.name)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        selectRow(item);
      }}
      onPointerEnter={() => issue && preloadOnHover({ board: issue.board, selected: issue.key, panel: true, inbox: true })}
      onPointerLeave={() => preloadOnHover(null)}
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
      className={`mx-2 flex gap-3 rounded-lg px-2 ${snoozedUntil ? "h-[77px]" : "h-[55px]"} ${selected ? "bg-sel" : "hover:bg-(--row-hover)"}`}
    >
      <Actor item={item} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
        <span className="flex min-w-0 items-center">
          {/* Jira names the type in every notification; the app marks it with the issue view's type dot. */}
          {(issue?.type || item.issueType) && (
            <span className="mr-1.5 grid shrink-0 place-items-center">
              <TypeDot type={issue?.type || item.issueType} />
            </span>
          )}
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
            {/* Jira prints the status name; Linear shows its icon, so the name is the icon's tooltip. */}
            {status || item.status ? (
              <span title={status?.name ?? item.status} data-inbox-status>
                <StatusIcon status={status ?? { name: item.status, category: "" }} />
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex min-w-0 gap-1.5">
          <Text variant="mini" color="muted" wrap="truncate">
            {describe(item)}
          </Text>
          {/* Jira's "+3 updates from Priya Chopra and others", short here; the pane lists them. */}
          {summary && (
            <Text variant="mini" color="muted" className="shrink-0" title={summary} data-inbox-more>
              +{item.count - 1}
            </Text>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {unsnoozedAt && <UnsnoozedMark at={unsnoozedAt} now={now} />}
            <Text variant="mini" color="muted">
              <time dateTime={item.time} title={fullTime(item.time)}>
                {shortAgo(item.time, now)}
              </time>
            </Text>
          </span>
        </span>
        {snoozedUntil && <SnoozedLine until={snoozedUntil} now={now} />}
      </span>
    </a>
  );
}

const UNSNOOZE = "Unsnooze notification";
/** Linear's snooze sub-actions (`pEn.subActions`): on a snoozed row, "Unsnooze notification" leads with its "Snoozed for 2d" and a
 *  divider; then the time rows every time menu shares. One component for the H menu and the row menu's Snooze…. */
function SnoozeRows({
  item,
  query,
  close,
  onCustom,
}: {
  item: InboxItem | undefined;
  query: string;
  close: () => void;
  onCustom: () => void;
}) {
  const until = useLocal()[item?.head ?? ""]?.snoozed,
    now = useStore((s) => s.clock),
    // A search keeps Unsnooze only while it names it, as Linear's menu scores it (its typed times skip scoring).
    named = !query || UNSNOOZE.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <>
      {item && until && until > now && named && (
        <>
          <Menu.Item
            value={UNSNOOZE}
            icon={<Icon name="clock" />}
            hint={snoozedFor(until, now)}
            onSelect={() => {
              close();
              unsnoozeRow(item);
            }}
          >
            {UNSNOOZE}
          </Menu.Item>
          <Menu.Divider />
        </>
      )}
      <TimeOptionRows
        query={query}
        onPick={(at) => {
          close();
          snoozeRow(Date.parse(at), item);
        }}
        onCustom={onCustom}
      />
    </>
  );
}

const COPY: [CopyKind, string][] = [
  ["ID", "copy-id"],
  ["URL", "copy-url"],
  ["title", "copy-title"],
  ["title as link", "copy-link"],
];
/** Linear's row menu: read state, delete, snooze, favorite and copy. Favorite needs the issue in the mirror. */
function rowEntries(item: InboxItem, close: () => void): ActionEntry[] {
  const mirrored = get().issues.has(item.key),
    favorite = get().favorites.includes(item.key);
  return [
    {
      name: item.unread ? "Mark as read" : "Mark as unread",
      icon: "check",
      shortcut: hotkeyOf("inbox-read"),
      run: () => toggleRead(item),
    },
    {
      name: "Delete notification",
      icon: "trash",
      shortcut: hotkeyOf("inbox-backspace"),
      run: () => deleteRow(item),
    },
    {
      // Linear's contextual name (`pEn.name`: "Snooze…"), its search placeholder, and its typed times.
      name: "Snooze…",
      icon: "clock",
      shortcut: hotkeyOf("inbox-snooze"),
      placeholder: TIME_PLACEHOLDER,
      hoistFrom: Infinity,
      rows: (query) => (
        <SnoozeRows
          item={item}
          query={query}
          close={close}
          onCustom={() => {
            close();
            openSnooze({ item, step: "custom" });
          }}
        />
      ),
    },
    ...(mirrored
      ? [
          {
            name: favorite ? "Remove from favorites" : "Favorite",
            icon: (favorite ? "starred" : "star") as IconName,
            shortcut: hotkeyOf("favorite"),
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
        shortcut: hotkeyOf(id),
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
    const universe = field === "type" ? ["Assignments", "Mentions", "Comments and replies", "Reactions", "Status changes", "Subscriptions"]
      : field === "from" ? get().options.users.map((u) => u.name)
      : field === "project" ? [...get().issues.values()].flatMap((i) => i.project ? [i.project.name] : [])
      : ORDER[field] ?? [];
    for (const value of universe) if (!counts.has(value)) counts.set(value, 0);
    const order = ORDER[field];
    const values = [...counts.keys()].sort((a, b) =>
      order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b),
    );
    return {
      name,
      icon: FIELD_ICON[field],
      children: values.map((value) => ({
        name: value,
        checkbox: !!v.filters[field]?.includes(value),
        matchCount: counts.get(value),
        // Linear shows no count for a value nothing matches.
        hint: counts.get(value) ? `${counts.get(value)} notification${counts.get(value) === 1 ? "" : "s"}` : undefined,
        run: () => toggleFilter(field, value),
      })),
    };
  });
}

/** The H menu (and the pane's snooze button): Linear's snooze action on the row. A key names its search "Snooze notification
 *  until…" (`keyboardInvoked`); otherwise it reads Linear's "Try: 4 pm, 2 days, in 5 weeks…". */
function SnoozeMenu({ close }: { close: () => void }) {
  const [{ item, step, invoked }] = useState(snoozeMenu),
    [custom, setCustom] = useState(step === "custom"),
    [query, setQuery] = useState("");
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
            snoozeRow(Date.parse(at), item);
          }}
        />
      ) : (
        // Linear's snooze options are an action menu (IB): the first choice is highlighted, arrows move, typing filters.
        <Menu shouldFilter={false}>
          <Menu.Input
            autoFocus
            aria-label="Snooze time"
            placeholder={invoked === "keyboard" ? "Snooze notification until…" : TIME_PLACEHOLDER}
            value={query}
            onValueChange={setQuery}
          />
          <Menu.List>
            <SnoozeRows item={item} query={query} close={close} onCustom={() => setCustom(true)} />
          </Menu.List>
        </Menu>
      )}
    </MenuSurface>
  );
}

/**
 * Linear keeps display controls in their own panel, separate from notification action menus: the shared ViewOptions
 * popover, under the button's start edge as Linear places it in a list pane with a right slot.
 */
function InboxDisplayOptions({ close }: { close: () => void }) {
  const v = useView();
  const [trigger] = useState(() => ({ current: document.getElementById("inbox-display") }));
  return (
    <ViewOptions.Popover label="Display options" trigger={trigger} placement="bottom-left" close={close}>
      <ViewOptions.Content>
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
      </ViewOptions.Content>
    </ViewOptions.Popover>
  );
}

/**
 * Linear's Settings › Notifications › Push notifications › Desktop (`Q3`: the channel's "Enable desktop notifications", "Only
 * deliver priority notifications" while the priority inbox is on, then its General notifications), in the same view-options
 * panel as Display options. Only the categories Jira's bell can fill are listed. Turning it on asks the browser.
 */
function DesktopNotificationOptions({ close }: { close: () => void }) {
  const push = usePush();
  const priority = useView().priorityInbox;
  const [trigger] = useState(() => ({ current: document.getElementById("inbox-actions") }));
  const enabled = push.enabled && pushPermission() === "granted";
  return (
    <ViewOptions.Popover label="Desktop notifications" trigger={trigger} placement="bottom-left" close={close}>
      <ViewOptions.Content>
        <Toggle
          label="Enable desktop notifications"
          value={enabled}
          onChange={() => void (enabled ? disableDesktopNotifications() : enableDesktopNotifications())}
        />
        {priority && (
          <Toggle
            label="Only deliver priority notifications"
            value={push.onlyPriority}
            onChange={() => inbox.changePush({ onlyPriority: !push.onlyPriority })}
          />
        )}
      </ViewOptions.Content>
      <ViewOptions.Content>
        <ViewOptions.SectionLabel>General notifications</ViewOptions.SectionLabel>
        {PUSH_CATEGORIES.map(([category, label]) => (
          <Toggle
            key={category}
            label={label}
            value={pushCategoryOn(push, category)}
            onChange={() =>
              inbox.changePush({
                categories: { ...push.categories, [category]: !pushCategoryOn(push, category) },
              })
            }
          />
        ))}
      </ViewOptions.Content>
    </ViewOptions.Popover>
  );
}

/** Linear's confirmation (`gi`) for Delete all, Delete all read and Delete all completed, in place of the browser's
 *  `confirm()` (R3-inbox-D6). */
function DeleteAllConfirm() {
  const ask = useConfirmation();
  if (!ask) return null;
  return (
    <ConfirmDialog
      title={ask.title}
      description={ask.description}
      confirmLabel="Delete all"
      onConfirm={() => ask.answer(true)}
      close={() => ask.answer(false)}
    />
  );
}

/** Linear's inbox Filter (CORE-17): left-aligned under its button with the "Add Filter…" search showing; each field's values are
 *  checkbox rows that keep the menu open. Read once, as it opens. */
function FilterMenu({ entries, close }: { entries: ActionEntry[]; close: () => void }) {
  const [anchor] = useState(() => document.getElementById("inbox-filter"));
  return <ActionMenu label="Filter" anchor={anchor} placeholder="Add Filter…" entries={entries} close={close} />;
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
            shortcut: hotkeyOf("inbox-read-all"),
            run: () => void markAllRead(),
          },
          { name: "Delete all", run: () => deleteAll("all") },
          {
            name: "Delete all read",
            shortcut: hotkeyOf("inbox-delete-read"),
            run: () => deleteAll("read"),
          },
          { name: "Delete all completed", run: () => deleteAll("completed") },
          {
            name: "Desktop notifications",
            run: () => ui.send({ type: "overlay.open", overlay: "inbox-push" }),
          },
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
    return <FilterMenu entries={filterEntries(base, v)} close={close} />;
  if (overlay === "inbox-display") return <InboxDisplayOptions close={close} />;
  if (overlay === "inbox-push") return <DesktopNotificationOptions close={close} />;
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

/** Linear's inbox find (Inbox `qt`). In the priority inbox it takes the tabs' place as "Find in inbox…" with a Close button,
 *  and the find looks through both tabs: the container grows into the row (`Jt.facetRowSearch`: flex-grow 1, no max-width)
 *  and the input is 32px, 6px round, on bgBorderThin with a labelFaint placeholder (`Jt.searchInput`). Otherwise it is
 *  ContentViewHeaderInlineSearch with no placeholder of its own, so "Find in view…": 160px at most, floating over the
 *  header's right end (top 6px, right 4px, z-index 10, over the buttons), with a Clear button while it holds text. */
function InboxFind({ ref, place }: { ref: Ref<HTMLInputElement>; place: "tabs" | "header" }) {
  const term = useFind().term;
  const tabs = place === "tabs";
  return (
    <FindField
      ref={ref}
      placeholder={tabs ? "Find in inbox…" : "Find in view…"}
      defaultValue={term}
      onValueChange={setFind}
      onClose={closeFind}
      className={tabs ? "ml-1 min-w-0 max-w-none flex-1" : "absolute top-1.5 right-1 z-10 w-[160px]"}
      inputClassName={tabs ? "h-8 rounded-[6px] border-(--bg-border) placeholder:text-fg-4" : undefined}
    >
      {tabs ? <FindField.Close /> : <FindField.Clear />}
    </FindField>
  );
}

/** The list pane: Linear's 416px column with its own 44px header. Older pages load as the end of the list scrolls into view. */
export function InboxList() {
  const v = useView();
  const feed = useFeed(feedCategory(useShownView()));
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
  const own = useLocal();
  const items = itemsOf(data);
  // Filters and grouping read mirrored issues: a store change re-renders the list only when its rows change.
  const { base, groups, rows } = useInboxOrder();
  const [menu, setMenu] = useState<{
    item: InboxItem;
    point: { x: number; y: number };
  } | null>(null);
  const list = useRef<HTMLDivElement>(null),
    end = useRef<HTMLDivElement>(null),
    findRef = useRef<HTMLInputElement>(null);
  const find = useFind(),
    findShown = find.open || !!find.term;
  // ⌘F opens the field, or takes focus back to it with its term selected (Linear's focusSearchAction).
  useCommand("focus-find", () => {
    openFind();
    const taken = focusNode(findRef.current);
    if (taken) findRef.current!.select();
    return taken;
  });
  // The find goes with the inbox: it opens empty on the next visit, as Linear's resets on a fresh one.
  useEffect(() => closeFind, []);
  const unseen = all?.pages[0]?.unseen ?? 0;
  useEffect(() => {
    if (unseen) void clearUnseen();
  }, [unseen]);
  const pages = data?.pages.length ?? 0;
  // A reload keeps the open issue, or a row outside the mirror, in the URL: select its row again, so U, E and H act on it.
  const rowParam = useSearch({ strict: false, select: (search) => (search as Record<string, string | undefined>)[ROW_PARAM] });
  const issueKey = useStore((s) => (s.inbox ? s.selected : null)),
    rowId = issueKey
      ? null
      : (rowParam ?? null);
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
  // Linear's filtered empty state (Inbox `Bt`): what the filters and the find hide, and a way to clear them.
  const hidden = base.length - rows.length;
  // Boolean selectors: another overlay opening elsewhere must not re-render the list.
  const actionsOpen = useStore((s) => s.overlay === "inbox-actions"),
    filterOpen = useStore((s) => s.overlay === "inbox-filter"),
    displayOpen = useStore((s) => s.overlay === "inbox-display");
  return (
    <section
      aria-label="Inbox"
      className="flex w-[416px] shrink-0 flex-col border-r-[0.5px] border-frame max-md:w-full"
    >
      <header className="relative flex h-11 shrink-0 items-center gap-1 border-b-[0.5px] border-frame px-2">
        <SidebarToggle />
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
        {v.priorityInbox && findShown ? (
          <InboxFind ref={findRef} place="tabs" />
        ) : v.priorityInbox ? (
          <Tabs
            value={v.tab}
            onValueChange={(tab) => showTab(tab as InboxView["tab"])}
          >
            <Tabs.List aria-label="Priority inbox" className="ml-1">
              <Tabs.Tab value="direct" title={shortcutTitle("Priority", hotkeyOf("inbox-priority"))}>
                Priority
              </Tabs.Tab>
              <Tabs.Tab value="watching" title={shortcutTitle("Other", hotkeyOf("inbox-other"))}>
                Other
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        ) : null}
        {/* Linear's tab slot grows (Odi `L7.tabs`): the priority find fills the row up to the buttons on its own. */}
        {!(v.priorityInbox && findShown) && <span className="flex-1" />}
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
          shortcut={hotkeyOf("filter")}
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
        {findShown && !v.priorityInbox && <InboxFind ref={findRef} place="header" />}
      </header>
      <FilterChips v={v} />
      <div
        ref={list}
        role="list"
        data-scroll-restoration-id="inbox-list"
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
              {...snoozeMarks(item, own[item.head], now)}
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
              title={hidden > 0 ? "No matching notifications" : v.unreadOnly ? "No unreads" : "No notifications"}
              actions={
                hidden > 0 && (
                  <Button
                    variant="muted"
                    size="small"
                    icon={<Icon name="x" size={12} />}
                    onClick={() => {
                      clearFilters();
                      closeFind();
                    }}
                  >
                    Clear Filters
                  </Button>
                )
              }
            >
              {hidden > 0 && (
                <Text variant="mini" color="muted" data-inbox-hidden>
                  <Text variant="miniPlus" color="base">
                    {hidden} notification{hidden === 1 ? "" : "s"}
                  </Text>{" "}
                  hidden by filters
                </Text>
              )}
            </EmptyState>
          ))}
        {rows.length > 0 && isFetchingNextPage && (
          <LoadingState className="py-2">
            Loading older notifications…
          </LoadingState>
        )}
        <div ref={end} data-inbox-end aria-hidden className="h-px" />
      </div>
      <Menus base={base} />
      <DeleteAllConfirm />
      {menu && (
        <ActionMenu
          label="Notification options"
          point={menu.point}
          entries={rowEntries(menu.item, () => setMenu(null))}
          close={() => setMenu(null)}
        />
      )}
    </section>
  );
}

/** Above the open issue, in its scroller: the notification's group ("+3 updates from …"), which unfolds into each of its
 *  notifications. */
export function InboxIssueGroup() {
  const row = useSelectedRow();
  if (!row || row.count < 2) return null;
  return (
    <div data-inbox-issue-group className="border-b border-line px-3 py-2">
      <InboxGroupUpdates key={row.id} row={row} mirrored />
    </div>
  );
}

/** Linear's notification actions in the open issue's header, while the inbox is open. */
export function InboxIssueActions() {
  const row = useSelectedRow();
  // Linear leads with the subscription toggle when the notification has an issue (BJ-47); null when it isn't mirrored.
  const subscribed = useStore((s) => {
    const issue = row && s.issues.get(row.key);
    return issue ? isWatching(issue) : null;
  });
  if (!row) return null;
  return (
    <>
      {subscribed !== null && (
        <IconButton
          label={subscribed ? "Unsubscribe from issue" : "Subscribe to issue"}
          shortcut={hotkeyOf("subscribe")}
          onClick={() => runShortcut("subscribe", row.key)}
        >
          <Icon name="bell" />
        </IconButton>
      )}
      <IconButton
        label="Snooze notification"
        shortcut={hotkeyOf("inbox-snooze")}
        onClick={() => openSnooze()}
      >
        <Icon name="clock" />
      </IconButton>
      <IconButton
        label="Delete notification"
        shortcut={hotkeyOf("inbox-backspace")}
        onClick={() => deleteRow()}
      >
        <Icon name="trash" />
      </IconButton>
    </>
  );
}

/** The `/inbox` route: the notification list, and the open issue (or the selected notification) beside it. */
export function InboxScreen() {
  const open = useStore((s) => (s.panel && s.selected ? s.issues.get(s.selected) : undefined));
  return (
    <>
      <InboxList />
      {open ? <InboxIssuePane key={firstKey(open.key)} issue={open} /> : <InboxPane />}
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
              shortcut={hotkeyOf(id)}
              onClick={() => void copyRow(row, kind)}
            >
              <Icon name={kind === "URL" ? "link" : "copy"} />
            </IconButton>
          ))}
          <span className="flex-1" />
          <ButtonLink variant="link" size="small" href={row.link || row.url} target="_blank" rel="noreferrer">
            Open in Jira <Icon name="external" />
          </ButtonLink>
        </div>
        <InboxNotification row={row} />
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

/** A notification whose issue is not in the mirror, in the pane: its issue, Jira's sentence, the comment (three lines, as the
 *  grouped cards), the group's earlier updates and why the issue isn't here. */
export function InboxNotification({ row }: { row: InboxItem }) {
  return (
    <div className="mx-auto w-full max-w-[680px] p-8">
      <Text as="h1" variant="title2">
        {row.title}
      </Text>
      <Text as="p" variant="small" color="muted" className="mt-1">
        {[row.issueType, row.key, row.status, row.category === "watching" ? "Watching" : "Direct"].filter(Boolean).join(" · ")}
      </Text>
      <Text as="p" variant="small" color="base" className="mt-3">
        {describe({ ...row, preview: "" })}{" "}
        <time dateTime={row.time} title={fullTime(row.time)} className="text-fg-3">
          {shortAgo(row.time)}
        </time>
      </Text>
      {row.preview && (
        <CommentCard href={row.link || undefined} className="mt-3">
          {row.preview}
        </CommentCard>
      )}
      <div className="mt-4">
        <InboxGroupUpdates key={row.id} row={row} mirrored={false} />
      </div>
      <Text as="p" variant="mini" color="muted" className="mt-4">
        {missingIssueNote(
          row.key,
          new Set([...get().issues.keys()].map((k) => k.split("-")[0]!)),
        )}
      </Text>
    </div>
  );
}
