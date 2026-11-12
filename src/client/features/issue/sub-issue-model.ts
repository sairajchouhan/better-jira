import { type Issue } from "@/shared/issue-model";

import { priorityRank, type Ordering, type Property } from "@/shared/view-model";
export type SubIssueDisplay = {
  ordering: Exclude<Ordering, "statusAge">;
  completed: "all" | "day" | "week" | "month" | "none";
  nested: boolean;
  properties: Property[];
};
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
/** One index per immutable issues snapshot; shared by every parent and progress renderer. */
export function childrenByParent(issues: ReadonlyMap<string, Issue>): ChildrenIndex {
  const cached = indexes.get(issues);
  if (cached) return cached;
  const children = new Map<string, Issue[]>();
  for (const issue of issues.values()) {
    if (!issue.parent) continue;
    const siblings = children.get(issue.parent) ?? [];
    siblings.push(issue);
    children.set(issue.parent, siblings);
  }
  indexes.set(issues, children);
  return children;
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
