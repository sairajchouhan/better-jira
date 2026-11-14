import type { Board, Issue } from "./issue-model";
import { statusById } from "./board-catalog";

/**
 * Linear's Project is a Jira epic (decision 2026-11-14, .raj/features/project-menu.md). Linear's `zBn` (startup-root) even
 * lists "epic" among the Project action's keywords. An issue is in an epic through Jira's `parent` link (work Jira's legacy
 * Epic Link field carries the same key). The Jira project stays what it is, Linear's team: nothing here ever changes it.
 */

type Leveled = Pick<Issue, "type" | "level">;
/** Where an issue sits in Jira's hierarchy: Jira's level for its type (the mirror's `level`), else by the type's name, as the
 *  fixture and local issues carry no level. Initiative 2, Epic 1, Sub-task -1, every other type 0. */
export function hierarchyLevel(issue: Leveled): number {
  if (typeof issue.level === "number") return issue.level;
  const type = (issue.type ?? "").toLowerCase();
  return type === "epic" ? 1 : type === "initiative" ? 2 : /^sub-?task$/.test(type) ? -1 : 0;
}
export const isEpic = (issue: Leveled) => hierarchyLevel(issue) === 1;

export type IssueLookup = (key: string) => Issue | undefined;
const indexes = new WeakMap<readonly Issue[], Map<string, Issue>>();
/** A key lookup over a list of issues, built once per list (a filter pass asks it for every issue). */
export function lookupIn(issues: readonly Issue[]): IssueLookup {
  let index = indexes.get(issues);
  if (!index) indexes.set(issues, (index = new Map(issues.map((i) => [i.key, i]))));
  return (key) => index.get(key);
}

/**
 * The epic an issue is in, as its project: its parent when that is an epic; for a sub-task, its parent's epic. An epic is its
 * own project, so it lists with its issues as a Linear project page lists the project with them, and it is never in "No project".
 * Initiatives sit above epics and are in none. A parent the mirror doesn't hold is judged by the level Jira gave with it.
 */
export function epicOf(issue: Issue, lookup: IssueLookup): string | undefined {
  const level = hierarchyLevel(issue);
  if (level === 1) return issue.key;
  if (level > 1 || !issue.parent) return undefined;
  const parent = lookup(issue.parent);
  const parentLevel = parent ? hierarchyLevel(parent) : issue.parentLevel;
  if (parentLevel === 1) return issue.parent;
  if (level < 0 && parentLevel === 0 && parent?.parent) {
    const grand = lookup(parent.parent);
    if ((grand ? hierarchyLevel(grand) : parent.parentLevel) === 1) return parent.parent;
  }
  return undefined;
}

/** An epic's name, as Linear names a project: its title, or its key when the mirror doesn't hold it. */
export const epicName = (key: string, lookup: IssueLookup) => lookup(key)?.summary ?? key;

/**
 * Why this issue's project can't be set, or undefined when it can: only a standard issue goes into an epic, the one parent Jira
 * gives it. A sub-task follows its parent, and an epic is a project itself (Linear's `zBn` `disabledReason`).
 */
export function epicLocked(issue: Leveled): string | undefined {
  const level = hierarchyLevel(issue);
  return level === 1
    ? "An epic is a project; Jira can't put it in another epic."
    : level > 1
      ? "Initiatives sit above projects."
      : level < 0
        ? "A sub-issue is in its parent's project."
        : undefined;
}

/** The edit that puts an issue in `epic`, or takes it out of its epic for null: Jira's parent link, nothing else. */
export const epicPatch = (epic: string | null): Pick<Issue, "parent"> => ({ parent: epic ?? undefined });

export type EpicChoice = { key: string; name: string; done: boolean };
/**
 * The project picker's epics (Linear's `zBn` sub-actions), the one list behind ⇧P, the right-click Project submenu and the
 * composer: the board's epics in the issue's Jira project (Jira links a parent only within it), by name, completed ones last
 * (`sortPriority: isDone`). A completed epic shows only when it is the current one or the search is longer than two characters
 * or names it exactly, as Linear hides completed projects; the current epic shows even when the mirror doesn't hold it.
 * `suggested` (the composer's view filter names them, `filterOverrides.project.secondary`) come first, in the filter's order,
 * done or not, as `zBn` lists them before the rest.
 */
export function epicChoices(
  issues: Iterable<Issue>,
  board: Board | undefined,
  {
    project,
    current,
    query = "",
    suggested = [],
  }: { project?: string; current?: string; query?: string; suggested?: readonly string[] } = {},
): EpicChoice[] {
  const q = query.trim().toLowerCase();
  const first = (key: string) => {
    const at = suggested.indexOf(key);
    return at < 0 ? Infinity : at;
  };
  const epics = Array.from(issues)
    .filter((i) => isEpic(i) && (i.key === current || !project || !i.project || i.project.key === project))
    .map((i) => ({
      key: i.key,
      name: i.summary,
      done: statusById(board, i.status)?.category === "done",
    }))
    .filter((e) => !e.done || e.key === current || suggested.includes(e.key) || q.length > 2 || e.name.toLowerCase() === q)
    .sort(
      (a, b) =>
        (first(a.key) === first(b.key) ? 0 : first(a.key) < first(b.key) ? -1 : 1) ||
        Number(a.done) - Number(b.done) ||
        a.name.localeCompare(b.name),
    );
  return current && !epics.some((e) => e.key === current)
    ? [{ key: current, name: current, done: false }, ...epics]
    : epics;
}
