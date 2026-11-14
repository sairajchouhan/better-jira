/** Jira's in-app notifications as Linear Inbox rows. Pure: the server maps the GraphQL feed, the client words and filters it. */
import { priorityRank } from "./view-model";

export type InboxKind =
  | "assigned"
  | "unassigned"
  | "mentioned"
  | "comment"
  | "reaction"
  | "status"
  | "created"
  | "updated";
/** One row: Jira groups notifications per issue (groupId = the issue's ARI), like Linear; the newest one heads it. */
export type InboxItem = {
  id: string;
  /** The head notification. A new notification on the issue changes it, which resets local state kept for the old one. */
  head: string;
  key: string;
  title: string;
  /** Status name at notification time, as Jira sent it. */
  status: string;
  url: string;
  actor: { name: string; avatar?: string } | null;
  kind: InboxKind;
  /** Jira's own sentence, e.g. "Ana changed a task from To Do to Done". */
  message: string;
  /** Comment text, for comments, mentions and reactions. */
  preview: string;
  time: string;
  unread: boolean;
  category: "direct" | "watching";
  count: number;
};
/** One page of Jira's feed; `cursor` asks for the next one. Jira can return a short or empty page before the end. */
export type InboxFeed = {
  unseen: number;
  items: InboxItem[];
  more: boolean;
  cursor?: string;
  /** On the unfiltered first page: every unread row in Jira, loaded or not. */
  unread?: { id: string; head: string }[];
};

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Plain text of an ADF document (or Jira's JSON string of one). */
export function adfText(doc: unknown): string {
  let node = doc;
  if (typeof node === "string") {
    try {
      node = JSON.parse(node);
    } catch {
      return node as string;
    }
  }
  const walk = (n: any): string =>
    !n || typeof n !== "object"
      ? ""
      : n.type === "text"
        ? str(n.text)
        : n.type === "mention"
          ? str(n.attrs?.text)
          : n.type === "emoji"
            ? str(n.attrs?.text) || str(n.attrs?.shortName)
            : (n.content ?? []).map(walk).join(n.type === "doc" ? " " : "");
  return walk(node).replace(/\s+/g, " ").trim();
}

export function kindOf(type: string, message: string): InboxKind {
  if (/\bunassigned\b/i.test(message)) return "unassigned";
  if (/\bassigned\b.*\bto you\b/i.test(message)) return "assigned";
  if (type === "mentioned" || /\bmentioned you\b/i.test(message)) return "mentioned";
  if (/\breacted\b/i.test(message)) return "reaction";
  if (/\b(commented|replied)\b/i.test(message)) return "comment";
  if (/\bchanged\b.* from .+ to .+/i.test(message)) return "status";
  if (type === "created" && /\bcreated\b/i.test(message)) return "created";
  return "updated";
}

/** Maps `notifications.notificationFeed` nodes; anything missing degrades to empty text rather than dropping the row. */
export function mapFeed(nodes: unknown): InboxItem[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node: any): InboxItem[] => {
    const head = node?.headNotification,
      content = head?.content;
    if (!node?.groupId || !head?.notificationId || !content) return [];
    const url = str(content.entity?.url) || str(content.url),
      pathKey = (content.path ?? [])
        .map((p: any) => str(p?.title))
        .find((t: string) => ISSUE_KEY.test(t)),
      key = pathKey ?? url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1] ?? "",
      message = str(content.message),
      states: unknown[] = Array.isArray(node.readStates) ? node.readStates : [];
    return [
      {
        id: str(node.groupId),
        head: str(head.notificationId),
        key,
        title: str(content.entity?.title) || message,
        status: str(content.entity?.status),
        url: url.replace(/\?.*$/, "") || url,
        actor: content.actor?.displayName
          ? {
              name: str(content.actor.displayName),
              ...(content.actor.avatarURL ? { avatar: str(content.actor.avatarURL) } : {}),
            }
          : null,
        kind: kindOf(str(content.type), message),
        message,
        preview: adfText(
          (content.bodyItems ?? []).find((b: any) => b?.document?.data)?.document?.data,
        ),
        time: str(head.timestamp),
        unread: states.length ? states.includes("unread") : head.readState !== "read",
        category: head.category === "watching" ? "watching" : "direct",
        count: Number(node.groupSize) || 1,
      },
    ];
  });
}

/** The row's second line, in Linear's words (its notification presenters, 2026-11-08). */
export function describe(item: InboxItem): string {
  const who = item.actor?.name ?? "Someone",
    preview = item.preview ? `: ${item.preview}` : "";
  switch (item.kind) {
    case "assigned":
      return `${who} assigned the issue to you`;
    case "unassigned":
      return `${who} unassigned your issue`;
    case "mentioned":
      // Jira says "mentioned you on a task" for a description mention and "in a comment" for a comment.
      return /\bmentioned you on\b/i.test(item.message)
        ? `${who} mentioned you in an issue description`
        : `${who} mentioned you${preview}`;
    case "comment":
      return `${who} commented${preview}`;
    case "reaction":
      return `${who} reacted to${preview || " your comment"}`;
    case "status": {
      const to = item.message.match(/ to (.+)$/)?.[1] ?? item.status;
      if (/cancel|won't|declined/i.test(to)) return `Marked as canceled by ${who}`;
      if (/done|closed|resolved|complete/i.test(to)) return `Marked as completed by ${who}`;
      return `Status updated by ${who}`;
    }
    case "created":
      return `${who} created a new issue`;
    default:
      return item.message || `${who} updated the issue`;
  }
}

/** A row's accessible name; a Jira system notification has no key, so no gap is left for one (R3-inbox-D7). */
export const rowLabel = (item: InboxItem) =>
  [item.unread ? "Unread" : "Read", item.key, item.title, describe(item)].filter(Boolean).join(" ");

/** Linear's list times: "now", "5m", "3h", "2d", "4w", "1y". */
export function shortAgo(iso: string, now = Date.now()): string {
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!(m >= 1)) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 10080) return `${Math.floor(m / 1440)}d`;
  if (m < 525600) return `${Math.floor(m / 10080)}w`;
  return `${Math.floor(m / 525600)}y`;
}

/** Linear's snooze times: "Sun, 8 Nov, 7:13 PM". */
export function snoozeTime(until: number): string {
  const d = new Date(until),
    f = (o: Intl.DateTimeFormatOptions) => d.toLocaleString("en", o);
  return `${f({ weekday: "short" })}, ${d.getDate()} ${f({ month: "short" })}, ${f({ hour: "numeric", minute: "2-digit" })}`;
}

/** The fallback pane's note. An issue the mirror lacks in a project it mirrors was deleted (or moved); otherwise it lives outside the boards. */
export const missingIssueNote = (key: string, mirroredProjects: Set<string>) =>
  mirroredProjects.has(key.split("-")[0]!)
    ? "This issue is no longer in your boards. It may have been deleted."
    : "This issue is outside your mirrored boards, so it opens in Jira.";

/** Linear's unread count: Jira's unread rows (all of them from `unread`, plus the loaded ones), plus rows being marked unread
 *  here (an undone ⌥U reaches unloaded rows: R3-inbox-D5), less this browser's deletes, snoozes and read marks. */
export function unreadCount(
  unread: { head: string }[] | undefined,
  items: InboxItem[],
  local: Record<string, Local>,
  now = Date.now(),
): number {
  const heads = new Set(unread?.map((u) => u.head));
  for (const i of items) if (i.unread) heads.add(i.head);
  for (const head in local) if (local[head]!.read === false) heads.add(head);
  let count = 0;
  for (const head of heads) {
    const own = local[head];
    if (!own?.deleted && !(own?.snoozed && own.snoozed > now) && !own?.read) count++;
  }
  return count;
}

/** What the inbox keeps locally per head notification: Jira has no delete or snooze, and read-only sites keep read state here too. */
export type Local = { read?: boolean; deleted?: boolean; snoozed?: number };

/** What Linear's inbox filter can ask of a row, from the notification and, when the issue is mirrored, the issue. */
export type Facets = {
  type: string;
  from: string;
  project: string;
  priority: string;
  statusType: string;
};
export type FilterField = keyof Facets;
/** Linear's filter menu, in its order. */
export const FILTER_FIELDS: [FilterField, string][] = [
  ["type", "Notification type"],
  ["from", "From"],
  ["project", "Project"],
  ["priority", "Issue priority"],
  ["statusType", "Issue status type"],
];
/** Linear's notification types for each Jira kind; Jira's generic changes are what Linear calls subscriptions. */
const TYPE: Record<InboxKind, string> = {
  assigned: "Assignments",
  unassigned: "Assignments",
  mentioned: "Mentions",
  comment: "Comments and replies",
  reaction: "Reactions",
  status: "Status changes",
  created: "Subscriptions",
  updated: "Subscriptions",
};
const PRIORITY = ["Urgent", "High", "Medium", "Low", "No priority"];

/** Linear's status types for a Jira status: its category first, the name for what categories cannot tell. */
export function statusType({ name, category }: { name: string; category: string }): string {
  if (/duplicate/i.test(name)) return "Duplicate";
  if (/cancel|won't|declined|archived/i.test(name)) return "Canceled";
  if (category === "done" || (!category && /done|closed|resolved|complete/i.test(name)))
    return "Completed";
  if (/triage/i.test(name)) return "Triage";
  if (/backlog/i.test(name)) return "Backlog";
  if (category === "indeterminate" || (!category && /progress|review|doing/i.test(name)))
    return "Started";
  return name || category ? "Unstarted" : "";
}

/** `projects` names a key prefix's project, from the mirror, so a row whose issue isn't mirrored joins its project's rows (R2-inbox-D5). */
export function facetsOf(
  item: InboxItem,
  issue?: { priority?: string; project?: { name: string } | null },
  status?: { name: string; category: string },
  projects?: Map<string, string>,
): Facets {
  const prefix = item.key.split("-")[0]!;
  return {
    type: TYPE[item.kind],
    from: item.actor?.name ?? "Jira",
    project: issue?.project?.name ?? (prefix ? (projects?.get(prefix) ?? prefix) : "No project"),
    priority: PRIORITY[issue ? priorityRank(issue.priority) : 4]!,
    statusType: statusType(status ?? { name: item.status, category: "" }),
  };
}

export type InboxView = {
  /** Linear's priority inbox: Priority and Other tabs, which are Jira's Direct and Watching. */
  priorityInbox: boolean;
  tab: "direct" | "watching";
  unreadOnly: boolean;
  showSnoozed: boolean;
  unreadFirst: boolean;
  ordering: "newest" | "oldest" | "priority";
  grouping: "none" | "focus";
  /** Each field matches any of its values; fields combine with AND, as in Linear. */
  filters: Partial<Record<FilterField, string[]>>;
};
export const DEFAULT_VIEW: InboxView = {
  priorityInbox: false,
  tab: "direct",
  unreadOnly: false,
  showSnoozed: false,
  unreadFirst: false,
  ordering: "newest",
  grouping: "none",
  filters: {},
};
/** The Jira feed the view reads: one category in the priority inbox, else both. */
export const feedCategory = (view: InboxView) => (view.priorityInbox ? view.tab : "all");

/** Applies local state, then the view's filters and ordering. `keep` (the selected row) stays in unread-only after it is read. */
export function visibleItems(
  items: InboxItem[],
  local: Record<string, Local>,
  view: InboxView,
  now = Date.now(),
  keep?: string | null,
  facets: (item: InboxItem) => Facets = (item) => facetsOf(item),
): InboxItem[] {
  const filters = Object.entries(view.filters).filter(([, values]) => values?.length) as [
    FilterField,
    string[],
  ][];
  const rows = items.flatMap((item) => {
    const own = local[item.head];
    if (own?.deleted) return [];
    if (own?.snoozed && own.snoozed > now && !view.showSnoozed) return [];
    const row = own?.read === undefined ? item : { ...item, unread: !own.read };
    if (view.priorityInbox && row.category !== view.tab) return [];
    if (view.unreadOnly && !row.unread && row.id !== keep) return [];
    if (filters.length) {
      const f = facets(row);
      if (!filters.every(([field, values]) => values.includes(f[field]))) return [];
    }
    return [row];
  });
  const rank = (r: InboxItem) => PRIORITY.indexOf(facets(r).priority);
  return rows.sort(
    (a, b) =>
      (view.unreadFirst ? Number(b.unread) - Number(a.unread) : 0) ||
      (view.ordering === "priority" ? rank(a) - rank(b) : 0) ||
      (view.ordering === "oldest" ? a.time.localeCompare(b.time) : b.time.localeCompare(a.time)),
  );
}

type Focus = {
  label: string;
  match?: (row: InboxItem, f: Facets) => boolean;
  /** A child shows as its own group from this many rows; below it, its rows stay in the parent. */
  min?: number;
  children?: Focus[];
  mergeTrailingSingletons?: boolean;
};
const CLOSED = new Set(["Completed", "Canceled", "Duplicate"]);
/** Linear's "Focus" grouping (useInboxNotificationsProvider, 2026-11-08), keeping the groups Jira's notifications can fill. */
const FOCUS: Focus[] = [
  { label: "Urgent", match: (_, f) => f.priority === "Urgent" && !CLOSED.has(f.statusType) },
  {
    label: "Mentions & replies",
    children: [{ label: "Mentions", match: (r) => r.kind === "mentioned", min: 5 }],
  },
  {
    label: "Other",
    match: () => true,
    mergeTrailingSingletons: true,
    children: [
      { label: "Comments", match: (r) => r.kind === "comment", min: 2 },
      {
        label: "Assignments",
        match: (r) => r.kind === "assigned" || r.kind === "unassigned",
        min: 6,
      },
      { label: "Reactions", match: (r) => r.kind === "reaction", min: 6 },
      { label: "Completed", match: (_, f) => f.statusType === "Completed", min: 10 },
      { label: "Canceled", match: (_, f) => f.statusType === "Canceled", min: 10 },
      { label: "Duplicates", match: (_, f) => f.statusType === "Duplicate", min: 6 },
    ],
  },
];
export type InboxGroup = { label: string; rows: InboxItem[] };
/** Linear's "Group unreads by: Focus": unread rows in focus groups, read rows last under "Read"; one group alone is "Unread". */
export function focusGroups(
  rows: InboxItem[],
  facets: (item: InboxItem) => Facets = (item) => facetsOf(item),
): InboxGroup[] {
  const unread = rows.filter((r) => r.unread),
    read = rows.filter((r) => !r.unread);
  if (!unread.length) return [{ label: "", rows }];
  const own = new Map<Focus, InboxItem[]>();
  const matches = (n: Focus, r: InboxItem, f: Facets): boolean =>
    n.match ? n.match(r, f) : (n.children ?? []).some((c) => matches(c, r, f));
  const place = (r: InboxItem, f: Facets, nodes: Focus[]): Focus | undefined => {
    for (const n of nodes)
      if (matches(n, r, f)) return (n.children && place(r, f, n.children)) || n;
  };
  for (const r of unread) {
    const n = place(r, facets(r), FOCUS);
    if (n) own.set(n, [...(own.get(n) ?? []), r]);
  }
  const all = (n: Focus): InboxItem[] => [
    ...(own.get(n) ?? []),
    ...(n.children ?? []).flatMap(all),
  ];
  const meets = (n: Focus) => all(n).length >= (n.min ?? 1);
  const allSmall = (n: Focus) => (n.children ?? []).every((c) => !meets(c));
  const single = (n: Focus): Focus => {
    const filled = (n.children ?? []).filter((c) => all(c).length);
    return own.get(n)?.length || filled.length !== 1 ? n : single(filled[0]!);
  };
  const groups: InboxGroup[] = [];
  const push = (label: string, items: InboxItem[]) =>
    items.length && groups.push({ label, rows: unread.filter((r) => items.includes(r)) });
  const emit = (n: Focus) => {
    if (allSmall(n)) return void push(single(n).label, all(n));
    const children = n.children ?? [];
    // Linear folds two or more trailing one-row groups back into the parent.
    const trailing = new Set<Focus>();
    for (const c of [...children].reverse()) {
      const count = all(c).length;
      if (!count) continue;
      if (count > 1 || meets(c)) break;
      trailing.add(c);
    }
    const merge = n.mergeTrailingSingletons && trailing.size > 1 ? trailing : undefined;
    const rest: Focus[] = [];
    for (const c of children)
      if (meets(c)) emit(c);
      else if (merge && !merge.has(c)) push(single(c).label, all(c));
      else rest.push(c);
    const filled = rest.filter((c) => all(c).length);
    const label = !own.get(n)?.length && filled.length === 1 ? single(filled[0]!).label : n.label;
    push(label, [...(own.get(n) ?? []), ...rest.flatMap(all)]);
  };
  FOCUS.forEach(emit);
  if (groups.length === 1) groups[0]!.label = "Unread";
  if (read.length) groups.push({ label: "Read", rows: read });
  return groups;
}

export type InboxOrder = { base: InboxItem[]; groups: InboxGroup[]; rows: InboxItem[] };
/** The list as shown: `rows` in on-screen order (the keys' order too), in their `groups`; `base` is the rows before filters, for the filter menu's counts. */
export function inboxOrder(
  items: InboxItem[],
  local: Record<string, Local>,
  view: InboxView,
  now: number,
  keep: string | null,
  facets: (item: InboxItem) => Facets,
): InboxOrder {
  const base = visibleItems(items, local, { ...view, filters: {} }, now, keep, facets),
    shown = visibleItems(items, local, view, now, keep, facets),
    groups = view.grouping === "focus" ? focusGroups(shown, facets) : [{ label: "", rows: shown }];
  return { base, groups, rows: groups.flatMap((g) => g.rows) };
}
const sameRows = (a: InboxItem[], b: InboxItem[]) =>
  a.length === b.length && a.every((r, i) => r.id === b[i]!.id && r.unread === b[i]!.unread);
/** Whether two orders show the same rows in the same groups. */
export const sameInboxOrder = (a: InboxOrder, b: InboxOrder) =>
  sameRows(a.base, b.base) &&
  a.groups.length === b.groups.length &&
  a.groups.every((g, i) => g.label === b.groups[i]!.label && sameRows(g.rows, b.groups[i]!.rows));

/** Linear's snooze presets (generateDefaultTimeOptions, 2026-11-08): this evening only while it is an hour or more away; then "Custom…". */
export function snoozeChoices(now = new Date()): { label: string; until: number }[] {
  const day = (days: number, hour: number, months = 0) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + months, d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const hour = now.getTime() + 3_600_000,
    evening = day(0, 18),
    monday = day(7 - ((now.getDay() + 6) % 7), 9);
  return [
    { label: "An hour from now", until: hour },
    { label: "In 3 hours", until: now.getTime() + 3 * 3_600_000 },
    ...(evening >= hour ? [{ label: "This evening", until: evening }] : []),
    { label: "Tomorrow", until: day(1, 9) },
    { label: "Next week", until: monday },
    { label: "A month from now", until: day(0, 9, 1) },
  ].sort((a, b) => a.until - b.until);
}

/** Whether any inbox property filter has selected values. */
export const hasFilters = (view: InboxView) =>
  Object.values(view.filters).some((values) => values?.length);
