import { type Board, type Issue, type User, type JiraOptions } from "@/shared/issue-model";
/** What a board offers to pick from: its statuses, the people an issue can be assigned to, and known labels. */
import { priorityRank } from "./view-model";


/** The board's statuses in column order. */
export const statuses = (board: Board | undefined) =>
  board?.columns.flatMap((c) => c.statuses) ?? [];
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

/**
 * Linear's team `frequentIssueLabels`: over the 100 most recently created issues, the three labels used most, most used first.
 * Ties keep first-seen order, as Linear's stable sort does.
 */
export function frequentLabels(issues: Issue[]): string[] {
  const counts = new Map<string, number>();
  const recent = issues
    .slice()
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))
    .slice(0, 100);
  for (const issue of recent) for (const l of issue.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);
}

/**
 * The label picker's sections, as Linear's labels action groups them: the issue's labels first (no heading); with none, the board's
 * frequently used labels ("Frequently used"); then every other label ("Workspace labels").
 */
export function labelSections(issues: Issue[], jiraLabels: string[], selected: string[]) {
  const frequent = selected.length ? [] : frequentLabels(issues);
  const shown = new Set([...selected, ...frequent]);
  return {
    selected: [...selected],
    frequent,
    rest: knownLabels(issues, jiraLabels).filter((l) => !shown.has(l)),
  };
}

/** Priority names in the same rank order in every property menu. */
export function priorityChoices(
  options: JiraOptions,
  issues: Iterable<Issue>,
  writable: boolean,
): string[] {
  return [
    ...new Set([
      ...(writable ? [] : ["Normal"]),
      ...options.priorities.map((p) => p.name),
      ...Array.from(issues).flatMap((i) => (i.priority ? [i.priority] : [])),
    ]),
  ].sort((a, b) => priorityRank(a) - priorityRank(b));
}
export function projectChoices(issues: Iterable<Issue>) {
  return [
    ...new Map(
      Array.from(issues).flatMap((i) => (i.project ? [[i.project.key, i.project] as const] : [])),
    ).values(),
  ];
}
export function milestoneChoices(
  options: JiraOptions,
  issues: Iterable<Issue>,
  project: string | undefined,
) {
  return [
    ...new Map([
      ...(options.versions[project ?? ""] ?? []).map((m) => [m.id, m] as const),
      ...Array.from(issues)
        .filter((i) => i.project?.key === project)
        .flatMap((i) => (i.milestones ?? []).map((m) => [m.id, m] as const)),
    ]).values(),
  ];
}
/** Everyone known to the mirror, retaining the authoritative current-user and Jira records. */
export function knownPeople(
  me: User,
  jiraUsers: User[],
  issues: Iterable<Issue>,
  extra: readonly User[] = [],
): User[] {
  const people = new Map<string, User>();
  for (const user of [
    me,
    ...jiraUsers,
    ...extra,
    ...Array.from(issues).flatMap((i) => [i.assignee, i.creator, ...(i.watchers ?? [])]),
  ])
    if (user && !people.has(user.id)) people.set(user.id, user);
  return [...people.values()].sort((a, b) =>
    a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name),
  );
}
