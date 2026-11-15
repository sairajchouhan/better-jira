/** Jira's in-app notifications as Linear Inbox rows. Pure: the server maps the GraphQL feed, the client words and filters it. */
import { compareText } from "@/shared/compare";
import { priorityRank, truncate, type EqualOperator } from "./view-model";

export type InboxKind =
  | "assigned"
  | "unassigned"
  | "mentioned"
  | "comment"
  | "reaction"
  | "status"
  | "created"
  | "updated";
export type InboxActor = { name: string; avatar?: string };
/** One Jira notification: a row's own, or one of the earlier ones its group folds in. */
export type InboxNote = {
  id: string;
  actor: InboxActor | null;
  kind: InboxKind;
  /** Jira's own sentence, e.g. "Ana changed a task from To Do to Done". */
  message: string;
  /** Comment text, for comments, mentions and reactions. Its ADF stays on the server: every card shows this text, as
   *  Linear's (`bodyTextContent`), so the feed and its group pages don't carry the comment twice. */
  preview: string;
  time: string;
  /** Status name at notification time, as Jira sent it. */
  status: string;
  /** Where Jira's own notification leads: the comment (`focusedCommentId`), or the issue. */
  link: string;
  /** The comment it is about, when it is about one. */
  commentId: string;
  unread: boolean;
};
/** One row: Jira groups notifications per issue (groupId = the issue's ARI), like Linear. The row shows the group's main
 *  notification (Linear's `BW.prioritize`), which is the newest one unless a recent mention or assignment is in the group. */
export type InboxItem = Omit<InboxNote, "id"> & {
  id: string;
  /** The head notification. A new notification on the issue changes it, which resets local state kept for the old one. */
  head: string;
  key: string;
  title: string;
  /** The issue's address, without Jira's comment or assignment context. */
  url: string;
  /** The issue type, from Jira's sentence ("updated a story"): Jira's feed names it only there and in its icon. */
  issueType: string;
  /** Newest activity in the group: the row's time and order, as Jira's head. */
  time: string;
  category: "direct" | "watching";
  /** Notifications in the group, this one included (Jira's `groupSize`). */
  count: number;
  /** Who sent the group's other notifications, newest first: Jira's "+3 updates from Priya and others". */
  others: InboxActor[];
  /** The group's first page, as the feed already read it to rank the row: expanding the group shows it without a request. */
  group?: InboxGroupPage;
};
/** One page of a row's notifications (`/api/inbox/group`); `cursor` asks for the next one. */
export type InboxGroupPage = { notes: InboxNote[]; more: boolean; cursor?: string };
/** How many of a group's notifications its first page holds: the feed reads these to rank the row (Linear's prioritize looks
 *  at the recent ones), and the same page seeds the expanded group. */
export const GROUP_FIRST = 10;
/** Each later page, five at a time as Jira's bell expands a group. */
export const GROUP_PAGE = 5;
/** What an expanded group shows before "Show more": the head and five more, as Jira's bell (prod parity #15). */
export const GROUP_SHOWN = 1 + GROUP_PAGE;

/** One page of Jira's `notificationGroup`, `first` long: a short page, or one without a cursor, is the last. */
export function groupPage(
  nodes: unknown,
  pageInfo: { hasNextPage?: unknown; endCursor?: unknown } | null | undefined,
  first: number,
): InboxGroupPage {
  const notes = (Array.isArray(nodes) ? nodes : []).flatMap((n) => mapNote(n) ?? []);
  // Jira reports a next page after the last one too; an empty or short page ends it.
  return {
    notes,
    more: !!pageInfo?.hasNextPage && !!pageInfo.endCursor && notes.length === first,
    ...(pageInfo?.endCursor ? { cursor: String(pageInfo.endCursor) } : {}),
  };
}
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

/** `template` is Jira's `messageTemplateId`: a comment template is a comment whatever its sentence says (a bot's "added a note"). */
export function kindOf(type: string, message: string, template = ""): InboxKind {
  if (/\bunassigned\b/i.test(message)) return "unassigned";
  if (/\bassigned\b.*\bto you\b/i.test(message)) return "assigned";
  if (type === "mentioned" || /\bmentioned you\b/i.test(message)) return "mentioned";
  if (/\breacted\b/i.test(message)) return "reaction";
  if (template === "jira-issue-comment" || /\b(commented|replied)\b/i.test(message)) return "comment";
  if (/\bchanged\b.* from .+ to .+/i.test(message)) return "status";
  if (type === "created" && /\bcreated\b/i.test(message)) return "created";
  return "updated";
}

const actorOf = (a: any): InboxActor | null =>
  a?.displayName
    ? { name: str(a.displayName), ...(a.avatarURL ? { avatar: str(a.avatarURL) } : {}) }
    : null;
/** The comment a Jira link points at: `focusedCommentId=…` or `#comment-…`. */
export const commentIdOf = (link: string) =>
  link.match(/[?&]focusedCommentId=(\d+)/)?.[1] ?? link.match(/#comment-(\d+)/)?.[1] ?? "";

/** The issue page's id for the comment a notification is about: Linear links a comment as `#comment-<id>`. */
export const commentAnchor = (note: Pick<InboxNote, "commentId">) =>
  note.commentId ? `comment-${note.commentId}` : "";

/** One `InfluentsNotificationItem` (a feed head or a group child); null when it can't be read. */
export function mapNote(raw: any): InboxNote | null {
  const content = raw?.content;
  if (!raw?.notificationId || !content) return null;
  const link = str(content.url) || str(content.entity?.url),
    message = str(content.message),
    template = (Array.isArray(raw.analyticsAttributes) ? raw.analyticsAttributes : []).find(
      (a: any) => a?.key === "messageTemplateId",
    )?.value,
    data = (content.bodyItems ?? []).find((b: any) => b?.document?.data)?.document?.data;
  return {
    id: str(raw.notificationId),
    actor: actorOf(content.actor),
    kind: kindOf(str(content.type), message, str(template)),
    message,
    preview: adfText(data),
    time: str(raw.timestamp),
    status: str(content.entity?.status),
    link,
    commentId: commentIdOf(link),
    unread: raw.readState !== "read",
  };
}

/** Linear's mention window (`zW.PRIORITIZE_MENTION_NOTIFICATION_IN_LAST_HOURS`). */
const PRIORITY_WINDOW = 72 * 3_600_000;
/** Linear's `BW.prioritize` (startup-entry, 2026-11-14): unread before read, newest first, then a mention from the last 72 hours
 *  to the front (`zW.doesNotificationHaveIncreasedPriority`: `Dm.allMentionNotificationTypes` only, so an assignment stays in
 *  its place), and never a reaction in front of something else. */
export function prioritize<T extends Pick<InboxNote, "id" | "kind" | "time" | "unread">>(
  notes: T[],
  now = Date.now(),
): T[] {
  const pool = notes.some((n) => n.unread) ? notes.filter((n) => n.unread) : [...notes];
  pool.sort((a, b) => compareText(b.time, a.time) || compareText(a.id, b.id));
  const toFront = (i: number) => i > 0 && pool.unshift(...pool.splice(i, 1));
  toFront(
    pool.findIndex(
      (n) =>
        n.kind === "mentioned" && now - Date.parse(n.time) < PRIORITY_WINDOW,
    ),
  );
  if (pool.length > 1 && pool[0]!.kind === "reaction")
    toFront(pool.findIndex((n) => n.kind !== "reaction"));
  // Everything else follows newest first, so the list under the row reads like Jira's.
  const rest = notes
    .filter((n) => !pool.includes(n))
    .sort((a, b) => compareText(b.time, a.time));
  return [...pool, ...rest];
}

/** The distinct people behind `notes`, in order. */
function actorsOf(actors: (InboxActor | null)[]) {
  const seen = new Set<string>();
  return actors.flatMap((a) => (a && !seen.has(a.name) && seen.add(a.name) ? [a] : []));
}

/** Maps `notifications.notificationFeed` nodes; anything missing degrades to empty text rather than dropping the row.
 *  `children` holds each group's notifications (`notificationGroup`), when they were read, so the row can lead with Linear's
 *  main notification rather than Jira's newest. */
export function mapFeed(
  nodes: unknown,
  children: Record<string, unknown[]> = {},
  now = Date.now(),
): InboxItem[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node: any): InboxItem[] => {
    const head = node?.headNotification,
      content = head?.content,
      headNote = mapNote(head);
    if (!node?.groupId || !headNote) return [];
    const url = str(content.entity?.url) || str(content.url),
      pathKey = (content.path ?? [])
        .map((p: any) => str(p?.title))
        .find((t: string) => ISSUE_KEY.test(t)),
      key = pathKey ?? url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1] ?? "",
      states: unknown[] = Array.isArray(node.readStates) ? node.readStates : [],
      unread = states.length ? states.includes("unread") : head.readState !== "read",
      group = (children[str(node.groupId)] ?? []).flatMap((c) => mapNote(c) ?? []),
      notes = group.some((n) => n.id === headNote.id) ? group : [headNote, ...group],
      [main = headNote, ...rest] = group.length ? prioritize(notes, now) : [headNote],
      // The summary names whom Jira's bell names ("+1 update from Sahil", even when Sahil also leads): Jira's
      // `additionalActors`, in its order. The loaded notifications stand in only when Jira sent none.
      jiraActors = actorsOf((Array.isArray(node.additionalActors) ? node.additionalActors : []).map(actorOf)),
      others = jiraActors.length ? jiraActors : actorsOf(rest.map((n) => n.actor));
    const { id: _, ...shown } = main;
    return [
      {
        ...shown,
        // The row keeps Jira's group state and newest time: Jira reads and orders groups, not their notifications.
        id: str(node.groupId),
        head: headNote.id,
        key,
        title: str(content.entity?.title) || headNote.message,
        status: headNote.status,
        url: url.replace(/[?#].*$/, "") || url,
        issueType: issueTypeOf(headNote.message) || issueTypeOf(main.message),
        time: headNote.time,
        unread,
        category: head.category === "watching" ? "watching" : "direct",
        count: Math.max(Number(node.groupSize) || 1, notes.length),
        others,
      },
    ];
  });
}

/** Jira's sentence names the issue type ("updated a story", "changed a work item from …", "commented on an epic"). */
export function issueTypeOf(message: string): string {
  const m = message.match(
    /\b(?:updated|changed|assigned|unassigned|created|commented on|replied to|reacted to|mentioned you on|resolved|deleted|moved|linked|attached \w+ to) an? ([a-z][a-z-]*(?: item)?)\b/i,
  );
  const type = m?.[1]?.toLowerCase();
  return type && type !== "comment" ? type[0]!.toUpperCase() + type.slice(1) : "";
}

/** Old and new status of a status change. Jira's sentence is "… from A to B", and either name may hold " to ", so the
 *  status Jira sent (the new one) splits it. Jira's sentence and its status field may differ in case ("Ready to deploy" vs
 *  "Ready to Deploy"), so they match in any case, and the sentence keeps its own words. */
export function statusChange(note: Pick<InboxNote, "message" | "status">) {
  const m = note.message.match(/ from (.+)$/);
  if (!m) return null;
  const tail = m[1]!,
    end = ` to ${note.status}`;
  if (note.status && tail.toLowerCase().endsWith(end.toLowerCase()))
    return { from: tail.slice(0, -end.length), to: tail.slice(-note.status.length) };
  const at = tail.lastIndexOf(" to ");
  return at > 0 ? { from: tail.slice(0, at), to: tail.slice(at + 4) } : null;
}

/** Jira's group line, in its words: "+1 update from Hitesh Shetty", "+3 updates from Priya Chopra and others". */
export function groupSummary(item: Pick<InboxItem, "count" | "others">): string {
  const n = item.count - 1;
  if (n < 1) return "";
  const [first, ...more] = item.others;
  return `+${n} update${n === 1 ? "" : "s"}${first ? ` from ${first.name}${more.length ? " and others" : ""}` : ""}`;
}

/** A notification's sentence: Linear's words (its notification presenters, 2026-11-08), carrying everything Jira's sentence
 *  says: the issue type ("assigned the story to you"), both statuses of a change, and where a mention is. */
export function describe(note: Pick<InboxNote, "actor" | "kind" | "message" | "preview" | "status">): string {
  const who = note.actor?.name ?? "Someone",
    preview = note.preview ? `: ${note.preview}` : "",
    type = issueTypeOf(note.message).toLowerCase();
  switch (note.kind) {
    case "assigned":
      return `${who} assigned the ${type || "issue"} to you`;
    case "unassigned":
      return `${who} unassigned your ${type || "issue"}`;
    case "mentioned":
      // Jira says "mentioned you on a task" for a description mention and "in a comment" for a comment.
      return /\bmentioned you on\b/i.test(note.message)
        ? `${who} mentioned you in ${type ? `the ${type}` : "an issue"} description`
        : `${who} mentioned you in a comment${preview}`;
    case "comment":
      return `${who} ${/\breplied\b/i.test(note.message) ? "replied" : "commented"}${preview}`;
    case "reaction":
      return `${who} reacted to${preview || " your comment"}`;
    case "status": {
      const change = statusChange(note),
        to = change?.to ?? note.status,
        // Linear's WAn.getStatusChangeText; the change itself is Jira's, which Linear shows only as the new state's icon.
        phrase = /cancel|won't|declined/i.test(to)
          ? "Marked as canceled"
          : /done|closed|resolved|complete/i.test(to)
            ? "Marked as completed"
            : "Status updated";
      return `${phrase} by ${who}${change ? `: ${change.from} → ${change.to}` : ""}`;
    }
    case "created":
      return `${who} created a new ${type || "issue"}`;
    default:
      return note.message || `${who} updated the issue`;
  }
}

/** How much of a comment a row's name reads: Linear cuts a comment to 100 characters with "…" where it names one in a line
 *  (`truncateLength:100` for a comment link's title; the row itself shows `Comment.notificationText`, its first blocks, on
 *  one truncated line). */
export const ROW_PREVIEW = 100;
/** A row's accessible name; a Jira system notification has no key, so no gap is left for one (R3-inbox-D7). `status` is the
 *  one the row's icon shows (the mirrored issue's current status), so a screen reader hears what the eye sees. The comment is
 *  cut to `ROW_PREVIEW` characters, so a long one doesn't make the row's name a thousand characters long. */
export const rowLabel = (item: InboxItem, status = item.status) =>
  [
    item.unread ? "Unread" : "Read",
    item.key,
    item.title,
    (item.issueType || status) && `· ${[item.issueType, status].filter(Boolean).join(", ")}`,
    describe({ ...item, preview: truncate(item.preview, ROW_PREVIEW) }),
    groupSummary(item) && `· ${groupSummary(item)}`,
  ]
    .filter(Boolean)
    .join(" ");

const UNITS: [string, number][] = [
  ["m", 1],
  ["h", 60],
  ["d", 1440],
  ["w", 10080],
  ["y", 525600],
];
/** Linear's list times ("now", "5m", "3h", "2d", "4w", "1y"), rounded to the nearest unit as Jira's bell is: 1.99 days old reads
 *  "2d" as Jira's "2 days ago" does, not "1d". */
export function shortAgo(iso: string, now = Date.now()): string {
  const m = (now - Date.parse(iso)) / 60_000;
  if (!(m >= 1)) return "now";
  for (let i = 0; i < UNITS.length; i++) {
    const [unit, size] = UNITS[i]!,
      value = Math.round(m / size),
      next = UNITS[i + 1];
    if (!next || value < next[1] / size) return `${value}${unit}`;
  }
  return "now";
}

/** How reading a notification's issue went when the mirror doesn't hold it (client server-data.ts `keptOutcome`). */
export type KeptOutcome = "reading" | "missing" | "unreachable";
/** The fallback pane's note, shown while the notification's issue isn't open. Any issue opens here once the mirror keeps it
 *  (BJ-341, BJ-355), so the pane stays only while it is read, when Jira has none this account can see (Jira's 404 covers
 *  both), or when Jira couldn't be reached. */
export const missingIssueNote = (outcome: KeptOutcome) =>
  ({
    reading: "Opening this issue…",
    missing: "Jira has no such issue, or you can't see it. It may have been deleted.",
    unreachable: "Couldn't reach Jira to open this issue. Select the notification again to retry.",
  })[outcome];

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
export type Local = {
  read?: boolean;
  deleted?: boolean;
  /** Snoozed until this time (Linear's `snoozedUntilAt`). */
  snoozed?: number;
  /** When the snooze ran out and the row came back (Linear's `unsnoozedAt`): an unread row marks it with a clock. */
  unsnoozed?: number;
};

/** The snooze marks a row shows. `snoozedUntil`: while it is snoozed, Linear's third line (`showsSnoozeRow`: `!!snoozedUntilAt`).
 *  `unsnoozedAt`: on an unread row back from snooze, Linear's clock (`unsnoozedAt && !readAt`). */
export type SnoozeMarks = { snoozedUntil?: number; unsnoozedAt?: number };
export function snoozeMarks(row: Pick<InboxItem, "unread">, own: Local | undefined, now: number): SnoozeMarks {
  return {
    snoozedUntil: own?.snoozed && own.snoozed > now ? own.snoozed : undefined,
    unsnoozedAt: row.unread ? own?.unsnoozed : undefined,
  };
}

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
  ["project", "Space"],
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
    project: issue?.project?.name ?? (prefix ? (projects?.get(prefix) ?? prefix) : "No space"),
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
  /** The fields whose filter is "is not": a row matches none of their values. Absent in views stored before it. */
  negated?: FilterField[];
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
/** The view as the list applies it: the stored view, plus the ⌘F find term, which is never stored with it. */
export type ShownView = InboxView & { find?: string };
/** lodash `deburr`'s letters that NFKD leaves whole. */
const DEBURR: Record<string, string> = { æ: "ae", ð: "d", ø: "o", þ: "th", ß: "ss", đ: "d", ħ: "h", ı: "i", ĳ: "ij", ł: "l", ŀ: "l", œ: "oe", ſ: "s" };
/** Linear's find folding (`UO`, startup-entry: lodash `deburr` of the NFKD form), lowercased first as `xmi.setFindTerm` does. */
export const foldFind = (text: string) =>
  text
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[æðøþßđħıĳłŀœſ]/g, (c) => DEBURR[c]!);
/** The words a find term asks for (`Notification.matchInlineFind`: the term split on spaces, every word somewhere in the text). */
export const findWords = (term = "") => foldFind(term).split(" ").filter(Boolean);
/** What a notification's find reads: Linear's `Notification.matchInlineFind` (startup-entry) takes its short label, the issue's
 *  identifier and title, the comment's text and the actor's name ("Linear" when there is none). Here the label is the row's
 *  sentence and Jira's own, the comment text is Jira's, and a system notification is Jira's. */
const findText = (item: Pick<InboxItem, "key" | "title">, note: Pick<InboxNote, "actor" | "kind" | "message" | "preview" | "status">) =>
  foldFind([describe(note), note.message, item.key, item.title, note.preview, note.actor?.name || "Jira"].join(" "));
const found = (text: string, words: string[]) => words.every((w) => text.includes(w));
/** A row as Linear's find shows it (useInboxNotificationsProvider `et`: a stack stays when any of its notifications matches, and
 *  leads with the main one of those that do), or null. Only the notifications the feed loaded can match: the row's own, and its
 *  group's first page. The group's count and its updates stay Jira's, so the open issue still lists every update. */
export function findInRow(item: InboxItem, words: string[], now = Date.now()): InboxItem | null {
  if (!words.length || found(findText(item, item), words)) return item;
  const matching = (item.group?.notes ?? []).filter((n) => found(findText(item, n), words));
  const [main] = prioritize(matching, now);
  if (!main) return null;
  const { id: _, status: __, unread: ___, ...shown } = main;
  return { ...item, ...shown };
}
/** Whether the view finds: a term with any word in it. */
export const finding = (view: ShownView) => findWords(view.find).length > 0;
/** The Jira feed the view reads: one category in the priority inbox, else both. Find looks through both tabs, as Linear's
 *  provider does (`dt`: `n.inline?.lastSearchTerm?.trim() ? "unfiltered" : t`). */
export const feedCategory = (view: ShownView) => (view.priorityInbox && !finding(view) ? view.tab : "all");

/** Applies local state, then the view's find, filters and ordering. `keep` (the selected row) stays in unread-only after it is read. */
export function visibleItems(
  items: InboxItem[],
  local: Record<string, Local>,
  view: ShownView,
  now = Date.now(),
  keep?: string | null,
  facets: (item: InboxItem) => Facets = (item) => facetsOf(item),
): InboxItem[] {
  const filters = Object.entries(view.filters).filter(([, values]) => values?.length) as [
    FilterField,
    string[],
  ][];
  const words = findWords(view.find),
    tab = feedCategory(view);
  const rows = items.flatMap((item) => {
    const own = local[item.head];
    if (own?.deleted) return [];
    if (own?.snoozed && own.snoozed > now && !view.showSnoozed) return [];
    const read = own?.read === undefined ? item : { ...item, unread: !own.read };
    if (tab !== "all" && read.category !== tab) return [];
    if (view.unreadOnly && !read.unread && read.id !== keep) return [];
    const row = findInRow(read, words, now);
    if (!row) return [];
    if (filters.length) {
      const f = facets(row);
      if (!filters.every(([field, values]) => values.includes(f[field]) !== !!view.negated?.includes(field))) return [];
    }
    return [row];
  });
  const rank = (r: InboxItem) => PRIORITY.indexOf(facets(r).priority);
  // Linear's `movedToInboxAt` (`unsnoozedAt ?? createdAt`): a row back from snooze sorts as if it arrived when it came back (BJ-264).
  const moved = (r: InboxItem) => local[r.head]?.unsnoozed ?? Date.parse(r.time);
  return rows.sort(
    (a, b) =>
      (view.unreadFirst ? Number(b.unread) - Number(a.unread) : 0) ||
      (view.ordering === "priority" ? rank(a) - rank(b) : 0) ||
      (view.ordering === "oldest" ? moved(a) - moved(b) : moved(b) - moved(a)),
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
/** The list as shown: `rows` in on-screen order (the keys' order too), in their `groups`; `base` is the rows before filters and
 *  find, for the filter menu's counts and the count the filters hide. */
export function inboxOrder(
  items: InboxItem[],
  local: Record<string, Local>,
  view: ShownView,
  now: number,
  keep: string | null,
  facets: (item: InboxItem) => Facets,
): InboxOrder {
  // Linear's `prefilteredItems`: the rows in the find's scope, before the filters and the find narrow them.
  const scope = { ...view, filters: {}, find: undefined, priorityInbox: feedCategory(view) !== "all" },
    base = visibleItems(items, local, scope, now, keep, facets),
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

/** Whether any inbox property filter has selected values. */
export const hasFilters = (view: InboxView) =>
  Object.values(view.filters).some((values) => values?.length);
/** A field's filter operator: "is" unless it is negated. */
export const filterOperator = (view: Pick<InboxView, "negated">, field: FilterField): EqualOperator =>
  view.negated?.includes(field) ? "isNot" : "is";
/** The view change that sets `field`'s operator. */
export const withOperator = (
  view: Pick<InboxView, "negated">,
  field: FilterField,
  op: EqualOperator,
): Pick<InboxView, "negated"> => {
  const rest = (view.negated ?? []).filter((f) => f !== field);
  return { negated: op === "isNot" ? [...rest, field] : rest };
};
/** The view change that drops `field`'s filter, its operator with it, so a later pick starts again at "is". */
export const withoutFilter = (
  view: Pick<InboxView, "filters" | "negated">,
  field: FilterField,
): Pick<InboxView, "filters" | "negated"> => ({
  filters: { ...view.filters, [field]: [] },
  ...withOperator(view, field, "is"),
});
