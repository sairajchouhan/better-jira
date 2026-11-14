/** Desktop notifications for new inbox rows: Linear's Settings › Notifications › Push notifications › Desktop, over our
 *  notification kinds. Pure; the browser side is features/inbox/desktop-notifications.tsx. */
import { describe, type InboxItem, type InboxKind, type InboxNote, type Local } from "./inbox-model";

/** Linear's notification categories (startup-entry `D`, `qie` labels, `_d` descriptions, 2026-11-14) that Jira's bell can
 *  fill, in Linear's order. Document changes, updates, reminders, loops, apps and billing have no Jira notification. */
export const PUSH_CATEGORIES = [
  ["assignments", "Assignments", "Assignments, unassignments, and membership changes"],
  ["statusChanges", "Status changes", "Changes to the status, priority, and blocking relationships of issues"],
  ["commentsAndReplies", "Comments and replies", "Comments, replies, and thread resolutions"],
  ["mentions", "Mentions", "Mentions in comments or content"],
  ["reactions", "Reactions", "Emoji reactions to your content"],
  ["subscriptions", "Subscriptions", "Issues, epics, initiatives, spaces, and views you're subscribed to"],
] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number][0];

/** Each Jira kind's Linear category: each notification type's `getNotificationCategory()` (`New comment` →
 *  commentsAndReplies, `Mentioned in comment` → mentions, `New issue` → subscriptions, `Status updated` → statusChanges). */
export const PUSH_CATEGORY: Record<InboxKind, PushCategory> = {
  assigned: "assignments",
  unassigned: "assignments",
  mentioned: "mentions",
  comment: "commentsAndReplies",
  reaction: "reactions",
  status: "statusChanges",
  created: "subscriptions",
  updated: "subscriptions",
};

export type PushSettings = {
  /** Linear's "Enable desktop notifications": off until turned on (`Zie`: desktop defaults to false). */
  enabled: boolean;
  /** Linear's "Only deliver priority notifications", which applies only while the priority inbox is on. */
  onlyPriority: boolean;
  /** A category's choice once made; unset ones follow `pushCategoryDefault`. */
  categories: Partial<Record<PushCategory, boolean>>;
};
export const DEFAULT_PUSH: PushSettings = { enabled: false, onlyPriority: false, categories: {} };

/** Linear's defaults per category for the desktop channel (`Xie`): all on but reactions. */
export const pushCategoryDefault = (category: PushCategory) => category !== "reactions";
export const pushCategoryOn = (settings: PushSettings, category: PushCategory) =>
  settings.categories[category] ?? pushCategoryDefault(category);

export type Push = { item: InboxItem; note: Pick<InboxNote, "id" | "kind" | "actor" | "message" | "preview" | "status" | "commentId"> };
type Context = {
  settings: PushSettings;
  /** Notifications this tab already knew: the first feed it fetched, and every one since. */
  known: ReadonlySet<string>;
  local: Record<string, Local>;
  priorityInbox: boolean;
  /** The signed-in account's display name: your own actions never notify you. */
  me: string;
  now: number;
};

/**
 * The notifications to push from a fresh feed: each one this tab hasn't seen before that is still unread (in Jira and
 * here), isn't hidden here (deleted or snoozed), isn't yours, and whose category is on. "Only deliver priority
 * notifications" keeps Jira's Direct rows while the priority inbox is on, as Linear's applies only then.
 */
export function newPushes(items: InboxItem[], ctx: Context): Push[] {
  const { settings, known, local, now } = ctx;
  if (!settings.enabled) return [];
  return items.flatMap((item) => {
    const own = local[item.head];
    if (!item.unread || own?.read || own?.deleted || (own?.snoozed ?? 0) > now) return [];
    if (settings.onlyPriority && ctx.priorityInbox && item.category !== "direct") return [];
    const notes: Push["note"][] = item.group?.notes.length
      ? item.group.notes.filter((n) => n.unread)
      : [{ ...item, id: item.head }];
    return notes
      .filter(
        (n) =>
          !known.has(n.id) &&
          n.actor?.name !== ctx.me &&
          pushCategoryOn(settings, PUSH_CATEGORY[n.kind]),
      )
      .map((note) => ({ item, note }));
  });
}

/** Every notification id a feed holds, the rows' heads and their loaded group notifications. */
export const noteIds = (items: InboxItem[]) =>
  items.flatMap((item) => [item.head, ...(item.group?.notes.map((n) => n.id) ?? [])]);

/** The desktop notification: the issue as its title, Linear's sentence as its body. */
export const pushContent = ({ item, note }: Push) => ({
  title: [item.key, item.title].filter(Boolean).join(" "),
  body: describe(note),
});
