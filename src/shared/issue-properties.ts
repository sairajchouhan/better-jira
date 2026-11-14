import { jiraPullRequestStatus, type PullRequest } from "./pull-requests";
import { matchRank as textRank } from "./search-rank";
import { listsSubIssues } from "./epics";
export type History = {
  created: string | number;
  items: { fieldId?: string; field?: string; from?: string | null; to?: string | null }[];
};

/** Jira's bulk history uses epoch milliseconds; individual history uses ISO strings. */
function timestamp(value: string | number): number {
  return typeof value === "number" ? (value < 1e11 ? value * 1000 : value) : Date.parse(value);
}

export function statusDates(
  created: string,
  current: string,
  histories: History[],
  categoryOf: (id: string) => string | undefined,
) {
  const changes = histories
    .flatMap((h) =>
      h.items
        .filter((i) => (i.fieldId === "status" || i.field === "status") && i.from !== i.to)
        .map((i) => ({ at: timestamp(h.created), from: i.from, to: i.to })),
    )
    .filter((c) => Number.isFinite(c.at))
    .sort((a, b) => a.at - b.at);
  const latest = changes.at(-1);
  const statusSince = !latest
    ? created
    : latest.to === current
      ? new Date(latest.at).toISOString()
      : undefined;
  const firstStarted = changes.find((c) => c.to && categoryOf(c.to) === "indeterminate");
  return {
    statusSince,
    started: firstStarted
      ? new Date(firstStarted.at).toISOString()
      : !changes.length && categoryOf(current) === "indeterminate"
        ? created
        : undefined,
  };
}

/** The pull requests Jira's Development field (its dev summary, returned with every search result) reports: how many, and the
 *  state Jira summarises them by (`overall.state`: one PR's own state; for several, the state Jira ranks first). Unknown formats
 *  stay unknown. An empty development summary means Jira reports no linked PRs. */
export function pullRequestSummary(value: unknown): { count: number; status?: PullRequest["status"] } | undefined {
  let data: any = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // The field can be a Java-map wrapper with a genuine JSON value under `json=`.
      const marker = data.indexOf("json=");
      if (marker < 0) return undefined;
      const raw = data.slice(marker + 5).trimStart();
      let depth = 0,
        quoted = false,
        escaped = false,
        end = -1;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') quoted = false;
          continue;
        }
        if (c === '"') quoted = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          end = i + 1;
          break;
        }
      }
      if (end < 0) return undefined;
      try {
        data = JSON.parse(raw.slice(0, end));
      } catch {
        return undefined;
      }
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  if (!Object.keys(data).length) return { count: 0 };
  const summary = data.cachedValue?.summary ?? data.summary;
  if (summary && typeof summary === "object" && !summary.pullrequest) return { count: 0 };
  const overall = summary?.pullrequest?.overall;
  const count = overall?.count;
  if (!(typeof count === "number" && Number.isInteger(count) && count >= 0)) return undefined;
  const status = jiraPullRequestStatus(overall.state);
  return status && count ? { count, status } : { count };
}

/** Types an existing issue can switch to with Jira's edit: its project's types at its hierarchy level (live Jira rejects Subtask ↔ Task).
 *  Without Jira's type list (local mode), the types already seen in the project. */
export function typeChoices(
  current: string | undefined,
  jiraTypes: { name: string; hierarchyLevel: number }[] | undefined,
  seen: string[],
): string[] {
  const level = jiraTypes?.find((t) => t.name === current)?.hierarchyLevel;
  if (level !== undefined)
    return jiraTypes!.filter((t) => t.hierarchyLevel === level).map((t) => t.name);
  return [...new Set([...(current ? [current] : []), ...seen])];
}

type Hierarchy = {
  writable: boolean;
  options: { types?: Record<string, { name: string; hierarchyLevel: number }[]> };
};
type Typed = { type?: string; project?: { key: string } | null };
/** Where an issue's type sits in Jira's hierarchy (Epic 1, Task 0, Subtask -1). Undefined in local mode, which Jira's rules don't bind. */
const levelOf = (s: Hierarchy, issue: Typed) =>
  s.writable
    ? s.options.types?.[issue.project?.key ?? ""]?.find((t) => t.name === issue.type)
        ?.hierarchyLevel
    : undefined;
/** Jira takes `parent` for `child` only one hierarchy level up, in the same project. */
export function canParent(s: Hierarchy, parent: Typed, child: Typed) {
  const above = levelOf(s, parent),
    below = levelOf(s, child);
  return (
    above === undefined ||
    below === undefined ||
    (above === below + 1 && parent.project?.key === child.project?.key)
  );
}
/** Types a new child of `parent` can take: its project's types one level down, none under a Subtask. Undefined when unknown. */
export function childTypes(s: Hierarchy, parent: Typed) {
  const level = levelOf(s, parent);
  return level === undefined
    ? undefined
    : s.options
        .types![parent.project!.key]!.filter((t) => t.hierarchyLevel === level - 1)
        .map((t) => t.name);
}
/** Whether Jira has a type one level below `issue`, so it can be any issue's Jira parent (an epic's are its project's issues). */
export const canHaveChildren = (s: Hierarchy, issue: Typed) => childTypes(s, issue)?.length !== 0;
/** Whether `issue`'s Sub-issues section can add to it: Jira takes children under it, and it isn't above an epic. An epic's
 *  section lists and adds its issues, as Jira's epic page does (shared/epics.ts listsSubIssues, BJ-280). */
export const canHaveSubIssues = (s: Hierarchy, issue: Typed) =>
  listsSubIssues({ type: issue.type, level: levelOf(s, issue) }) && canHaveChildren(s, issue);
/** Jira can't create a Subtask without a parent or take its parent away. */
export const needsParent = (s: Hierarchy, issue: Typed) => (levelOf(s, issue) ?? 0) < 0;

/** How well an issue matches a search, best first (search-rank's scale over its key, title or both); -1 no match. */
export function matchRank(query: string, issue: { key: string; summary: string }) {
  if (!query.trim()) return 5;
  const ranks = [issue.key, issue.summary, `${issue.key} ${issue.summary}`]
    .map((text) => textRank(text, query))
    .filter((r) => r >= 0);
  return ranks.length ? Math.min(...ranks) : -1;
}
