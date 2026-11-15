import { jiraAvatar } from "./avatar-url";
import type { User } from "./issue-model";

/** The name shown for an account Jira gives no name for (a hidden profile, a removed account, a malformed record). */
export const UNKNOWN_USER = "Unknown user";

/** A Jira account record (`assignee`, `creator`, a comment's `author`) as the app's user: never without a name. */
export const jiraUser = (u: any): User => ({
  id: u?.accountId ?? (typeof u === "string" ? u : ""),
  name: (typeof u?.displayName === "string" && u.displayName.trim()) || UNKNOWN_USER,
  avatar: jiraAvatar(u?.avatarUrls),
});

/** The first character of a person's or board's name, for an avatar or a space badge; "?" when there is no name. A whole
 *  character, so a name starting with an emoji or another astral character shows it, not half of it. */
export const initialOf = (name: string | undefined | null) => Array.from(name?.trim() ?? "")[0] ?? "?";
