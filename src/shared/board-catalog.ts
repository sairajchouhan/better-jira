import { compareText } from "@/shared/compare";
import { type Board, type Issue, type Status, type User, type JiraOptions } from "@/shared/issue-model";
/** What a board offers to pick from: its statuses, the people an issue can be assigned to, and known labels. */
import { priorityRank } from "./view-model";
import { onBoard } from "./board-membership";


/** The board's statuses in column order. */
export const statuses = (board: Board | undefined) =>
  board?.columns.flatMap((c) => c.statuses) ?? [];
export const statusById = (board: Board | undefined, id: unknown) =>
  statuses(board).find((s) => s.id === id);
/** The board an issue reads its status from: one that holds it, else (a child in another project, kept on no configured board)
 *  any board whose columns know that status, as Jira's status ids are site-wide. */
export const statusBoard = (boards: readonly Board[], issue: Pick<Issue, "boards" | "status">, preferred?: Board) =>
  (preferred && onBoard(issue, preferred.id) ? preferred : undefined) ??
  boards.find((b) => onBoard(issue, b.id)) ??
  (preferred && statusById(preferred, issue.status) ? preferred : undefined) ??
  boards.find((b) => statusById(b, issue.status));
/** An issue's status: its board's (`statusBoard`), else the name and category Jira sent with it, so a child whose project's
 *  workflow no configured board shows still reads as done or started. Undefined when neither knows it. */
export const issueStatus = (
  boards: readonly Board[],
  issue: Pick<Issue, "boards" | "status" | "jiraStatus">,
  preferred?: Board,
): Status | undefined =>
  statusById(statusBoard(boards, issue, preferred), issue.status) ??
  (issue.jiraStatus?.id === issue.status ? issue.jiraStatus : undefined);

/** Everyone an issue can be assigned to: you first, then Jira's assignable users and anyone assigned an issue in the mirror, by name.
 *  The pickers group them with `assigneeGroups`. */
export function assignableUsers(me: User, jiraUsers: User[], issues: Iterable<Issue>): User[] {
  const m = new Map<string, User>([[me.id, me]]);
  for (const u of jiraUsers) if (!m.has(u.id)) m.set(u.id, u);
  for (const i of issues) if (i.assignee && !m.has(i.assignee.id)) m.set(i.assignee.id, i.assignee);
  return [...m.values()].sort((a, b) =>
    a.id === me.id ? -1 : b.id === me.id ? 1 : compareText(a.name, b.name),
  );
}

/**
 * The assignee picker's groups, in Linear's order (`Qun` in startup-root.CnUSfl4j.js): "Assigned users" (No assignee, you, then
 * the current assignee, drawn without a heading), "Suggested", "Team members", then "Users from other teams", which the picker
 * lists only once the search has two or more characters (`searchInputLength>1`, see `listsOtherPeople`).
 *
 * Linear's team members are the people in the issue's team. A Jira board has no member list, and Jira's assignable users are
 * everyone the permission scheme allows across the mirrored projects (on a company site, the whole company: Linear's other
 * teams). The people who are assigned the board's issues are the ones who work on it, so they are the team. With no board
 * (Linear's issue without a default team) everyone is listed, as "Members".
 */
export type AssigneeGroups = {
  /** No assignee (null), you, then the current assignee when it isn't you. */
  assigned: (User | null)[];
  suggested: User[];
  team: User[];
  teamHeading: "Space members" | "Members";
  others: User[];
};
export function assigneeGroups({
  me,
  current,
  suggested = [],
  jiraUsers,
  issues,
  board,
}: {
  me: User;
  current: User | null;
  /** People to offer under Suggested, such as those the view's assignee filter names. */
  suggested?: readonly User[];
  jiraUsers: readonly User[];
  issues: Iterable<Issue>;
  board: number | undefined;
}): AssigneeGroups {
  const listed = new Set([me.id]);
  const take = (users: Iterable<User>) => {
    const out: User[] = [];
    for (const u of users)
      if (!listed.has(u.id)) {
        listed.add(u.id);
        out.push(u);
      }
    return out;
  };
  const byName = (users: User[]) => users.sort((a, b) => compareText(a.name, b.name));
  const assigned = [null, me, ...take(current ? [current] : [])];
  const picked = take(suggested);
  const all = Array.from(issues);
  const team = byName(take(all.flatMap((i) => (i.assignee && (board === undefined || onBoard(i, board)) ? [i.assignee] : []))));
  const others = byName(take([...jiraUsers, ...all.flatMap((i) => (i.assignee ? [i.assignee] : []))]));
  return board === undefined
    ? { assigned, suggested: picked, team: byName([...team, ...others]), teamHeading: "Members", others: [] }
    : { assigned, suggested: picked, team, teamHeading: "Space members", others };
}
/** Linear lists people outside the team only once the search has more than one character. */
export const listsOtherPeople = (query: string) => query.trim().length > 1;

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
    .sort((a, b) => compareText(b.created ?? "", a.created ?? ""))
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
/** Linear's "No priority" row, offered only where the app can honour it. Jira refuses `priority: null` on a saved issue
 *  ("Specify the Priority (id or name) in the string format") although its editmeta calls the field optional, so a
 *  writable site's issues have no unset row; a read-only site keeps edits local and can clear it (R3-issue-fields-D1). */
export const clearPriorityRow = (writable: boolean) => (writable ? undefined : "No priority");
/** The Jira projects a board's new issues can go to: those its issues are in, with the board's own (its location) first
 *  when its issues are in it too. A board's filter need not show its location's project, so the location is offered only
 *  when the board shows it or the board is empty, which then still has one to create in. */
export function projectChoices(issues: Iterable<Issue>, board?: Pick<Board, "project">) {
  const shown = new Map(Array.from(issues).flatMap((i) => (i.project ? [[i.project.key, i.project] as const] : [])));
  const own = board?.project;
  if (!own || (shown.size > 0 && !shown.has(own.key))) return [...shown.values()];
  return [own, ...[...shown.values()].filter((p) => p.key !== own.key)];
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
    a.id === me.id ? -1 : b.id === me.id ? 1 : compareText(a.name, b.name),
  );
}
