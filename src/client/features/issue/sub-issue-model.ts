import { type Board, type Issue } from "@/shared/issue-model";
import { statusById } from "@/shared/board-catalog";
import { isEpic, listedUnder, type TitleLineVariant } from "@/shared/epics";
import {
  ORDERINGS,
  PROPERTIES,
  pickLabels,
  priorityRank,
  type Ordering,
  type Property,
} from "@/shared/view-model";
/** The words of the line under an issue's title, per variant (shared/epics.ts titleParentOf), and of the menu its ring opens.
 *  A parent Task: Linear's "Sub-issue of" and Open sub-issue…. An epic: "In epic", and Linear's word for a project's issues
 *  ("Open project issues", startup-root `Xxn`) in Epic words, as an issue in an epic is not a sub-issue (user's call, BJ-289). */
export const PARENT_LINE = {
  "sub-issue": { label: "Sub-issue of", open: (key: string) => `Open sub-issues of ${key}` },
  epic: { label: "In epic", open: (key: string) => `Open epic issues of ${key}` },
} as const satisfies Record<TitleLineVariant, { label: string; open: (key: string) => string }>;
/** How an issue's own issues are worded: an epic's are its epic issues, any other parent's its sub-issues. */
export const childrenVariant = (parent: Pick<Issue, "type" | "level">): TitleLineVariant =>
  isEpic(parent) ? "epic" : "sub-issue";
export type SubIssueDisplay = {
  ordering: Exclude<Ordering, "statusAge">;
  completed: "all" | "day" | "week" | "month" | "none";
  nested: boolean;
  properties: Property[];
};
// Linear's sub-issue pane: ordering labels from its shared ordering spec ("Link count"),
// display properties from IssueDetailsPaneSidebar ("Links"); same tables as the board.
export const SUB_ISSUE_ORDERINGS = pickLabels(ORDERINGS, [
  "manual",
  "title",
  "status",
  "priority",
  "assignee",
  "estimate",
  "updated",
  "created",
  "due",
  "links",
] as const satisfies readonly SubIssueDisplay["ordering"][]);
export const SUB_ISSUE_PROPERTIES = pickLabels(PROPERTIES, [
  "priority",
  "id",
  "status",
  "labels",
  "milestone",
  "due",
  "links",
  "assignee",
  "pullRequests",
] as const);
export const defaultSubIssueDisplay = (): SubIssueDisplay => ({
  ordering: "manual",
  completed: "all",
  nested: true,
  properties: ["status", "assignee"],
});
export type SubIssueRow = { issue: Issue; depth: number; contextOnly: boolean };
type Status = (issue: Issue) => { category: string; order: number };
export type ChildrenIndex = ReadonlyMap<string, readonly Issue[]>;
const indexes = new WeakMap<ReadonlyMap<string, Issue>, ChildrenIndex>();
/** One index per immutable issues snapshot; shared by every parent and progress renderer. A parent issue lists its children,
 *  and an epic its issues, as Jira's epic page does (shared/epics.ts listedUnder, BJ-280); a sub-task stays under its parent. */
export function childrenByParent(issues: ReadonlyMap<string, Issue>): ChildrenIndex {
  const cached = indexes.get(issues);
  if (cached) return cached;
  const children = new Map<string, Issue[]>();
  const lookup = (key: string) => issues.get(key);
  for (const issue of issues.values()) {
    const parent = listedUnder(issue, lookup);
    if (!parent) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(issue);
    children.set(parent, siblings);
  }
  indexes.set(issues, children);
  return children;
}
/** An issue's status on its own board, as every sub-issue list, count and menu reads it; "new" when the board doesn't know it. */
export const statusOf = (boards: readonly Board[], child: Issue) => {
  const board = boards.find((b) => b.id === child.board),
    columns = board?.columns ?? [],
    result = statusById(board, child.status);
  return {
    name: result?.name ?? child.status,
    category: result?.category ?? "new",
    order: columns.findIndex((c) => c.statuses.some((s) => s.id === child.status)),
  };
};

export type SubIssueCount = { readonly done: number; readonly total: number };
/** Which sub-issues a count takes: Linear's board card counts the direct children (IssueList `wd`: `t.children`), its list row every
 *  level below (issueWidgetFieldPreferences `at`: `t.descendants`). */
export type SubIssueScope = "children" | "descendants";
const counts = new WeakMap<ReadonlyMap<string, Issue>, WeakMap<readonly Board[], Map<string, SubIssueCount | null>>>();
/**
 * How many of `key`'s sub-issues are done, out of how many: Linear's sub-issue progress (`done/total`, done is `doneAt`, a status in
 * the done category). The sub-issues are the ones its Sub-issues section lists (`childrenByParent`), so an epic counts its issues
 * (BJ-280). Undefined when it has none. Cached per issues snapshot and boards, so every row and card reading it in one render pays
 * once, and the result is a stable reference for a store selector.
 */
export function subIssueCount(
  issues: ReadonlyMap<string, Issue>,
  boards: readonly Board[],
  key: string,
  scope: SubIssueScope,
): SubIssueCount | undefined {
  let byBoards = counts.get(issues);
  if (!byBoards) counts.set(issues, (byBoards = new WeakMap()));
  let cache = byBoards.get(boards);
  if (!cache) byBoards.set(boards, (cache = new Map()));
  const id = `${scope}:${key}`;
  if (!cache.has(id)) {
    const index = childrenByParent(issues);
    let done = 0,
      total = 0;
    const seen = new Set([key]),
      pending = [...(index.get(key) ?? [])];
    while (pending.length) {
      const issue = pending.pop()!;
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      total++;
      if (statusOf(boards, issue).category === "done") done++;
      if (scope === "descendants") pending.push(...(index.get(issue.key) ?? []));
    }
    cache.set(id, total ? { done, total } : null);
  }
  return cache.get(id) ?? undefined;
}

export function subIssueRows(
  parent: string,
  issues: Issue[] | ReadonlyMap<string, Issue>,
  display: SubIssueDisplay,
  status: Status,
  now = Date.now(),
  revealCompleted = false,
  manualOrder: readonly string[] = [],
) {
  const byKey = Array.isArray(issues) ? new Map(issues.map((i) => [i.key, i])) : issues;
  const index = childrenByParent(byKey);
  const children = new Map<string, Issue[]>();
  const positions = new Map(manualOrder.map((key, i) => [key, i]));
  const compare = (a: Issue, b: Issue) => {
    let cmp = 0;
    switch (display.ordering) {
      case "manual":
        if (positions.has(a.key) || positions.has(b.key)) return (positions.get(a.key) ?? Infinity) - (positions.get(b.key) ?? Infinity);
        cmp = (a.rank ?? "") < (b.rank ?? "") ? -1 : (a.rank ?? "") > (b.rank ?? "") ? 1 : 0;
        break;
      case "title":
        cmp = a.summary.localeCompare(b.summary);
        break;
      case "status":
        cmp = status(a).order - status(b).order;
        break;
      case "priority":
        cmp = priorityRank(a.priority) - priorityRank(b.priority);
        break;
      case "assignee":
        cmp = (a.assignee?.name ?? "~").localeCompare(b.assignee?.name ?? "~");
        break;
      case "estimate":
        cmp =
          a.estimate === undefined
            ? b.estimate === undefined
              ? 0
              : 1
            : b.estimate === undefined
              ? -1
              : a.estimate - b.estimate;
        break;
      case "updated":
        cmp = b.updated.localeCompare(a.updated);
        break;
      case "created":
        cmp = (b.created ?? "").localeCompare(a.created ?? "");
        break;
      case "due":
        cmp = !a.due ? (b.due ? 1 : 0) : !b.due ? -1 : a.due.localeCompare(b.due);
        break;
      case "links":
        cmp = (b.links?.length ?? 0) - (a.links?.length ?? 0);
        break;
    }
    return cmp || a.key.localeCompare(b.key, undefined, { numeric: true });
  };
  // Sort only reachable branches, and never mutate the shared snapshot index.
  const siblings = (key: string): Issue[] => {
    let sorted = children.get(key);
    if (!sorted) { sorted = [...(index.get(key) ?? [])].sort(compare); children.set(key, sorted); }
    return sorted;
  };
  const all: SubIssueRow[] = [],
    seen = new Set([parent]);
  const pending = siblings(parent)
    .slice()
    .reverse()
    .map((issue) => ({ issue, depth: 0 }));
  while (pending.length) {
    const { issue, depth } = pending.pop()!;
    if (seen.has(issue.key)) continue;
    seen.add(issue.key);
    all.push({ issue, depth, contextOnly: false });
    if (display.nested)
      for (const child of siblings(issue.key).slice().reverse())
        pending.push({ issue: child, depth: depth + 1 });
  }
  const cutoff =
    now - { day: 1, week: 7, month: 30, none: 0, all: Infinity }[display.completed] * 86400000;
  const passes = (issue: Issue) =>
    status(issue).category !== "done" ||
    display.completed === "all" ||
    (display.completed !== "none" &&
      Number.isFinite(Date.parse(issue.resolved ?? "")) &&
      Date.parse(issue.resolved!) >= cutoff);
  const accepted = new Set(all.filter((row) => passes(row.issue)).map((row) => row.issue.key));
  const hiddenCompleted = all.filter((row) => !passes(row.issue)).length;
  const required = new Set(accepted);
  // A completed ancestor remains as context for an incomplete descendant.
  if (display.nested)
    for (const key of accepted) {
      let node = byKey.get(key);
      const branch = new Set<string>();
      while (node?.parent && node.parent !== parent && !branch.has(node.parent)) {
        branch.add(node.parent);
        required.add(node.parent);
        node = byKey.get(node.parent);
      }
    }
  const rows = all
    .filter((row) => revealCompleted || required.has(row.issue.key))
    .map((row) => ({ ...row, contextOnly: !revealCompleted && !accepted.has(row.issue.key) }));
  return {
    rows,
    total: all.length,
    completed: all.filter((row) => status(row.issue).category === "done").length,
    hiddenCompleted,
  };
}

const direct = new WeakMap<ReadonlyMap<string, Issue>, WeakMap<readonly Board[], Map<string, readonly Issue[]>>>();
/**
 * `parent`'s own sub-issues in its Sub-issues section's order (Linear's default: manual, completed shown), the one list that Open
 * sub-issue… menus and the issue page opened from that section (its counter, ↑/↓) step through. Cached per issues snapshot and
 * boards, so a store selector gets a stable reference.
 */
export function directSubIssues(
  issues: ReadonlyMap<string, Issue>,
  boards: readonly Board[],
  parent: string,
): readonly Issue[] {
  let byBoards = direct.get(issues);
  if (!byBoards) direct.set(issues, (byBoards = new WeakMap()));
  let cache = byBoards.get(boards);
  if (!cache) byBoards.set(boards, (cache = new Map()));
  let list = cache.get(parent);
  if (!list) {
    const status = (issue: Issue) => statusOf(boards, issue);
    list = subIssueRows(parent, issues, defaultSubIssueDisplay(), status)
      .rows.filter((row) => row.depth === 0)
      .map((row) => row.issue);
    cache.set(parent, list);
  }
  return list;
}

/**
 * `entries` with Move… where Linear's issue menu lists it (startup-root `aAr`: Ko(Copy…), Convert to…, Make a copy…, Move…
 * (`Lvr`), Open in, Ko(Favorite)): inside the Copy group right after Make a copy…, with no divider of its own; just above the
 * last entry when the menu has no Make a copy….
 */
export function withMoveEntry<T extends { name: string }>(entries: readonly T[], move: T): T[] {
  const copy = entries.findIndex((entry) => entry.name === "Make a copy…");
  const at = copy < 0 ? Math.max(0, entries.length - 1) : copy + 1;
  return [...entries.slice(0, at), move, ...entries.slice(at)];
}

/** Linear's Move… sub-actions for a sub-issue under manual ordering (startup-root `Ivr`), or a drop at `to` in the others. */
export type SubIssueMove = "top" | "up" | "down" | "bottom" | { to: number };
/** The siblings' order with `key` moved (Linear's Move to top / up / down / to bottom, or a drag), or null when it stays put
 *  (R3-relations-D4). */
export function movedOrder(siblings: readonly string[], key: string, move: SubIssueMove): string[] | null {
  const from = siblings.indexOf(key);
  if (from < 0) return null;
  const rest = siblings.filter((k) => k !== key);
  const to =
    move === "top" ? 0 : move === "bottom" ? rest.length : move === "up" ? from - 1 : move === "down" ? from + 1 : move.to;
  const at = Math.max(0, Math.min(rest.length, to));
  if (at === from) return null;
  rest.splice(at, 0, key);
  return rest;
}

/** A sub-issue drag lands beside a sibling, before or after it, never on a row or beside a row under another parent. */
export function canDropSubIssue(
  source: Pick<Issue, "key" | "parent"> | undefined,
  over: Pick<Issue, "key" | "parent"> | undefined,
  position: "before" | "after" | "on",
) {
  return !!source && !!over && position !== "on" && source.key !== over.key && source.parent === over.parent;
}

/** The slot among its siblings a sub-issue dropped before or after `over` takes (`movedOrder`'s `{ to }`). */
export function subIssueDropSlot(siblings: readonly string[], dragged: string, over: string, after: boolean) {
  return siblings.filter((key) => key !== dragged).indexOf(over) + (after ? 1 : 0);
}
