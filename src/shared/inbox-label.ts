/** ⌘K's title for a selected notification, as Linear's notification group names it (startup-root.CnUSfl4j.js `OD.name`:
 *  `yg` with prefix `Notification` and title `${shortLabel}: ${identifier} ${title}`; live: "Notification ⋅ Due: RAJ-44 …"). */
import type { InboxItem } from "./inbox-model";

/**
 * Linear's `Notification.shortLabel` (startup-entry.CtZ_nZoH.js) for each Jira kind: the issue presenters' `getShortLabel()`
 * (`Od` Assigned, `kd` Unassigned, `Sd` Mentioned in comment, `Rf` Mentioned in issue, `Cd` New comment, `Td` Reacted to
 * comment, `Lf` New issue, `Yf` Due). A status change reads the issue's state type now: Completed, Canceled, Duplicate, else
 * Status updated. Jira's catch-all "updated" has no Linear presenter: "Updated".
 */
export function notificationLabel(
  note: Pick<InboxItem, "kind" | "message">,
  /** The issue's Linear status type now (the inbox filter's `statusType` facet). */
  statusType = "",
): string {
  switch (note.kind) {
    case "assigned":
      return "Assigned";
    case "unassigned":
      return "Unassigned";
    case "mentioned":
      // Jira says "mentioned you on a task" for a description mention and "in a comment" for a comment.
      return /\bmentioned you on\b/i.test(note.message) ? "Mentioned in issue" : "Mentioned in comment";
    case "comment":
      return "New comment";
    case "reaction":
      return "Reacted to comment";
    case "created":
      return "New issue";
    case "status":
      return ["Completed", "Canceled", "Duplicate"].includes(statusType) ? statusType : "Status updated";
    default:
      // Jira's due-date reminder ("You have 1 item due today") is Linear's issueDue; a changed due date is not.
      return /\bitems? due\b/i.test(note.message) ? "Due" : "Updated";
  }
}

/** The title after "Notification ⋅": the label, then the issue's key and title when the notification is about one. */
export function notificationTitle(item: Pick<InboxItem, "kind" | "message" | "key" | "title">, statusType = ""): string {
  const label = notificationLabel(item, statusType);
  return item.key ? `${label}: ${item.key} ${item.title}` : label;
}
