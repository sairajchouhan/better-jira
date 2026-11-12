import { type Issue, type User } from "@/shared/issue-model";


/** Linear's My issues tabs (`assigned`, `created`, `subscribed`, `activity`); a user's profile shows the same lists. */
export const PERSON_TABS = [
  ["assigned", "Assigned"],
  ["created", "Created"],
  ["subscribed", "Subscribed"],
  ["activity", "Activity"],
] as const;
export type PersonTab = (typeof PERSON_TABS)[number][0];
export const isPersonTab = (tab: unknown): tab is PersonTab => PERSON_TABS.some(([t]) => t === tab);

/** The issues a person's tab lists; `me` is the signed-in user, whose own watching the mirror knows without the list. */
export function personIssues(user: string, tab: PersonTab, me: string): (i: Issue) => boolean {
  const assigned = (i: Issue) => i.assignee?.id === user;
  const created = (i: Issue) => i.creator?.id === user;
  const subscribed = (i: Issue) =>
    i.watchers ? i.watchers.some((w) => w.id === user) : user === me && !!i.watching;
  if (tab === "assigned") return assigned;
  if (tab === "created") return created;
  if (tab === "subscribed") return subscribed;
  // ponytail: Activity is issues the person created, holds or changed a property on; comment authors aren't mirrored,
  // and Linear's grouping by activity date isn't drawn.
  return (i) => assigned(i) || created(i) || !!i.activity?.some((a) => a.actor.id === user);
}

/** Everyone the mirror names on an issue (assignees, creators, watchers), by name: Open user's choices. */
export function peopleOf(issues: Iterable<Issue>): User[] {
  const found = new Map<string, User>();
  for (const i of issues)
    for (const u of [i.assignee, i.creator, ...(i.watchers ?? [])]) if (u?.id && !found.has(u.id)) found.set(u.id, u);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
