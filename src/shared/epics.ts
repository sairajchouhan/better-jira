import type { Board, Issue, PropertyActivity } from "./issue-model";
import { statusById } from "./board-catalog";

/**
 * Linear's Project is a Jira epic (decision 2026-11-14). Linear's `zBn` (startup-root) even
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

/** The hierarchy level of an issue's Jira parent: the mirror's copy, else the level Jira sent with it; undefined when unknown. */
type Parented = Pick<Issue, "parent" | "parentLevel">;
function parentLevel(issue: Parented, lookup: IssueLookup): number | undefined {
  if (!issue.parent) return undefined;
  const parent = lookup(issue.parent);
  return parent ? hierarchyLevel(parent) : issue.parentLevel;
}

/**
 * The issue's parent issue, as Linear means it (`issue.parent`, the "Sub-issue of" line, Set parent issue…): its Jira parent unless
 * that is an epic or above. An epic parent is the issue's project (`epicOf`) and an initiative is above projects, so neither is ever
 * its Parent: Linear keeps `parent` and `project` apart, and its Set parent (`hFn`, `mFn`) never touches the project. A parent the
 * mirror doesn't hold, with no level from Jira, stays a parent. Every Parent surface (sub-issue lists, the parent line, Parent
 * filter, grouping and nesting, ⌘K) reads this, never `issue.parent`.
 */
export function parentOf(issue: Parented, lookup: IssueLookup): string | undefined {
  const level = parentLevel(issue, lookup);
  return level !== undefined && level >= 1 ? undefined : issue.parent;
}

/** Whether an issue takes part in parent issues at all: an epic is a project and an initiative sits above projects, so neither
 *  has a parent issue nor is one (Linear's projects and initiatives aren't issues). An epic still lists its issues in its
 *  Sub-issues section (`listsSubIssues`). */
export const nestable = (issue: Leveled) => hierarchyLevel(issue) < 1;
/** Whether `parent` may be `child`'s parent issue: both are nestable. */
export const canNest = (parent: Leveled, child: Leveled) => nestable(parent) && nestable(child);

/**
 * The issue whose Sub-issues section lists this one: its parent issue (`parentOf`), or its epic when its Jira parent is one, as
 * Jira's epic page lists its child work items (BJ-280, the user's deviation from Linear's project page, .raj/done.md). Only the
 * section and its counts read this (sub-issue lists, progress, the peek, Open sub-issue): on the child the epic stays its Epic,
 * never its Parent. An initiative lists nothing. A sub-task stays under its own parent, nested below the epic's issue.
 */
export function listedUnder(issue: Parented, lookup: IssueLookup): string | undefined {
  const level = parentLevel(issue, lookup);
  return level !== undefined && level > 1 ? undefined : issue.parent;
}
/**
 * The issue the line under an issue's title names, that Open parent issue (⌘⇧↑) opens, and whose issues its ring and ⌘⇧→ open,
 * with the line's variant: its parent issue (`parentOf`), "sub-issue" ("Sub-issue of"), when it has one; else its epic, "epic"
 * ("In epic"), so an issue in an epic points back to the epic that lists it (BJ-289, the user's deviation from Linear,
 * .raj/done.md; it completes BJ-280's epic Sub-issues section). That is the issue whose Sub-issues section lists it
 * (`listedUnder`). A sub-task names its parent, never the epic; an epic or an initiative names none. Only the title line, ⌘⇧↑
 * and ⌘⇧→ read this: the epic stays out of the Parent property, Remove › Parent and every other Parent surface (`parentOf`).
 */
export function titleParentOf(issue: Leveled & Parented, lookup: IssueLookup): TitleParent | undefined {
  if (!nestable(issue)) return undefined;
  const parent = parentOf(issue, lookup);
  if (parent) return { key: parent, variant: "sub-issue" };
  const epic = listedUnder(issue, lookup);
  return epic ? { key: epic, variant: "epic" } : undefined;
}
/** Which line the title shows: "Sub-issue of" a parent Task, or "In epic" for an issue in an epic (an issue in an epic is not
 *  a sub-issue, user's call 2026-11-14). The client's PARENT_LINE words each. */
export type TitleLineVariant = "sub-issue" | "epic";
export type TitleParent = { key: string; variant: TitleLineVariant };
/** Whether an issue has a Sub-issues section of its own: a parent issue, and an epic, whose section lists its issues
 *  (`listedUnder`). An initiative sits above epics and lists none. */
export const listsSubIssues = (issue: Leveled) => hierarchyLevel(issue) <= 1;
/** The draft a new issue from `parent`'s Sub-issues section starts with: under a parent issue, its parent; under an epic, the
 *  epic, written as the Epic picker writes it (`epicPatch`), so it shows as the new issue's Epic, never as its parent. */
export const subIssueParent = (parent: Leveled & Pick<Issue, "key">): Pick<Issue, "parent"> =>
  isEpic(parent) ? epicPatch(parent.key) : { parent: parent.key };

/**
 * The epic an issue is in, as its project: its parent when that is an epic; for a sub-issue (a sub-task, or a parent issue the
 * mirror holds), its parent's epic. An epic is its own project, so it lists with its issues as a Linear project page lists the
 * project with them, and it is never in "No project". Initiatives sit above epics and are in none. A parent the mirror doesn't hold
 * is judged by the level Jira gave with it.
 */
export function epicOf(issue: Issue, lookup: IssueLookup, depth = 0): string | undefined {
  const level = hierarchyLevel(issue);
  if (level === 1) return issue.key;
  if (level > 1 || !issue.parent || depth > 8) return undefined; // a malformed parent cycle has no epic
  const above = parentLevel(issue, lookup);
  if (above === 1) return issue.parent;
  const parent = lookup(issue.parent);
  // Jira gives a sub-task its parent's epic; a parent issue's epic comes the same way.
  if (parent && hierarchyLevel(parent) < 1) return epicOf(parent, lookup, depth + 1);
  return undefined;
}

/** An epic's name, as Linear names a project: its title, or its key when the mirror doesn't hold it. */
export const epicName = (key: string, lookup: IssueLookup) => lookup(key)?.summary ?? key;

/**
 * Why this issue's project can't be set, or undefined when it can: only a standard issue goes into an epic, the one parent Jira
 * gives it. A sub-issue follows its parent (writing the epic would take its parent issue away), and an epic is a project itself
 * (Linear's `zBn` `disabledReason`). Pass `lookup` for an existing issue, so a parent issue counts as well as a sub-task type.
 */
export function epicLocked(issue: Leveled & Parented, lookup?: IssueLookup): string | undefined {
  const level = hierarchyLevel(issue);
  return level === 1
    ? "An epic can't be added to another epic in Jira."
    : level > 1
      ? "Initiatives sit above epics."
      : level < 0 || (lookup && parentOf(issue, lookup))
        ? "A sub-issue is in its parent's epic."
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

/**
 * Jira logs an issue's epic as its parent ("Parent", "IssueParentAssociation", legacy "Epic Link"), and this app's own epic edits
 * patch `parent` too. Linear keeps the project apart from the parent (`Qs` "added to project", not `Us` "set parent to"), so
 * Activity reads a parent change as an epic change when it is one: a key the mirror holds says so by its level; else a standard
 * issue's Jira parent is always an epic, and a sub-task's (or an epic's initiative) never is. The array is kept when none is.
 */
export function epicChanges(
  events: readonly PropertyActivity[],
  issue: Leveled,
  lookup: IssueLookup,
): readonly PropertyActivity[] {
  const isEpicChange = (event: PropertyActivity) => {
    if (event.field !== "parent") return false;
    const held = [event.before, event.after].flatMap((key) => (typeof key === "string" && lookup(key)) || []);
    return held.length ? held.some(isEpic) : hierarchyLevel(issue) === 0;
  };
  return events.some(isEpicChange)
    ? events.map((event) => (isEpicChange(event) ? { ...event, field: "epic" as const } : event))
    : events;
}
