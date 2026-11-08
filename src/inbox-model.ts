/** Jira's in-app notifications as Linear Inbox rows. Pure: the server maps the GraphQL feed, the client words and filters it. */

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
export type InboxFeed = { unseen: number; items: InboxItem[]; more: boolean };

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
      return `${who} mentioned you${preview}`;
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

/** What the inbox keeps locally per head notification: Jira has no delete or snooze, and read-only sites keep read state here too. */
export type Local = { read?: boolean; deleted?: boolean; snoozed?: number };
export type InboxView = {
  category: "all" | "direct" | "watching";
  unreadOnly: boolean;
  showSnoozed: boolean;
  unreadFirst: boolean;
  oldest: boolean;
};
export const DEFAULT_VIEW: InboxView = {
  category: "all",
  unreadOnly: false,
  showSnoozed: false,
  unreadFirst: false,
  oldest: false,
};

/** Applies local state, then the view's filters and ordering. `keep` (the selected row) stays in unread-only after it is read. */
export function visibleItems(
  items: InboxItem[],
  local: Record<string, Local>,
  view: InboxView,
  now = Date.now(),
  keep?: string | null,
): InboxItem[] {
  const rows = items.flatMap((item) => {
    const own = local[item.head];
    if (own?.deleted) return [];
    if (own?.snoozed && own.snoozed > now && !view.showSnoozed) return [];
    const row = own?.read === undefined ? item : { ...item, unread: !own.read };
    if (view.category !== "all" && row.category !== view.category) return [];
    if (view.unreadOnly && !row.unread && row.id !== keep) return [];
    return [row];
  });
  return rows.sort(
    (a, b) =>
      (view.unreadFirst ? Number(b.unread) - Number(a.unread) : 0) ||
      (view.oldest ? a.time.localeCompare(b.time) : b.time.localeCompare(a.time)),
  );
}

/** Linear's snooze choices (its inbox snooze menu): tomorrow and next week at 8:00, a month from now. */
export function snoozeChoices(now = new Date()): { label: string; until: number }[] {
  const at = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(8, 0, 0, 0);
    return d.getTime();
  };
  const month = new Date(now);
  month.setMonth(month.getMonth() + 1);
  return [
    { label: "Tomorrow", until: at(1) },
    { label: "Next week", until: at(7) },
    { label: "A month from now", until: month.getTime() },
  ];
}
