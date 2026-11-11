/** What a board offers to pick from: its statuses, the people an issue can be assigned to, and known labels. */
import type { Board, Issue, User } from "./store";

/** The board's statuses in column order. */
export const statuses = (board: Board | undefined) => board?.columns.flatMap((c) => c.statuses) ?? [];
export const statusById = (board: Board | undefined, id: unknown) =>
  statuses(board).find((s) => s.id === id);

/** The assignee choices every picker offers, Assign and Create alike: you first, then Jira's assignable users and anyone assigned an issue in the mirror, by name. */
export function assignableUsers(me: User, jiraUsers: User[], issues: Iterable<Issue>): User[] {
  const m = new Map<string, User>([[me.id, me]]);
  for (const u of jiraUsers) if (!m.has(u.id)) m.set(u.id, u);
  for (const i of issues) if (i.assignee && !m.has(i.assignee.id)) m.set(i.assignee.id, i.assignee);
  return [...m.values()].sort((a, b) =>
    a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name),
  );
}

/** Labels on these issues, then Jira's other labels, each once. */
export const knownLabels = (issues: Issue[], jiraLabels: string[]) => [
  ...new Set([...issues.flatMap((i) => i.labels), ...jiraLabels]),
];
