import type { Board, Issue, IssueDraft } from "./store";
import { statusById } from "./board-catalog";

export type Grouping =
  | "none"
  | "status"
  | "category"
  | "assignee"
  | "project"
  | "priority"
  | "label"
  | "parent"
  | "type";
export type Ordering =
  | "manual"
  | "title"
  | "status"
  | "priority"
  | "assignee"
  | "updated"
  | "created"
  | "due"
  | "links"
  | "statusAge"
  | "estimate";
export type Property =
  | "id"
  | "status"
  | "assignee"
  | "creator"
  | "priority"
  | "project"
  | "due"
  | "labels"
  | "links"
  | "created"
  | "updated"
  | "type"
  | "comments"
  | "milestone"
  | "statusAge"
  | "pullRequests";
export type Field =
  | "status"
  | "assignee"
  | "creator"
  | "priority"
  | "labels"
  | "project"
  | "type"
  | "parent"
  | "relations"
  | "created"
  | "updated"
  | "due"
  | "resolved"
  | "content"
  | "links"
  | "milestone"
  | "watchers"
  | "statusAge"
  | "pullRequests"
  | "started"
  | "estimate"
  | "projectLead";
export type Operator =
  | "is"
  | "isNot"
  | "contains"
  | "notContains"
  | "before"
  | "after"
  | "within"
  | "next"
  | "empty"
  | "notEmpty"
  | "gt"
  | "lt";
export type Rule = { id: string; field: Field; op: Operator; values: string[] };
export type FilterGroup = { id: string; join: "and" | "or"; children: (Rule | FilterGroup)[] };
export type Display = {
  layout: "board" | "list";
  columns: Grouping;
  rows: Grouping;
  ordering: Ordering;
  descending: boolean;
  groupDescending: boolean;
  completedRecency: boolean;
  completedIssues: "all" | "day" | "week" | "month" | "none";
  subIssues: boolean;
  emptyGroups: boolean;
  nested: "matching" | "all" | "none";
  properties: Property[];
  openIn: "side" | "page";
};
export type Scope = "all" | "active" | "backlog";
export type Preferences = {
  display: Display;
  filters: FilterGroup;
  scope: Scope;
  hidden: Record<string, string[]>;
  collapsed: Record<string, string[]>;
};
export const GROUPINGS: [Grouping, string][] = [
  ["none", "No grouping"],
  ["status", "Status"],
  ["category", "Status type"],
  ["assignee", "Assignee"],
  ["project", "Project"],
  ["priority", "Priority"],
  ["label", "Label"],
  ["parent", "Parent issue"],
  ["type", "Issue type"],
];
export const ORDERINGS: [Ordering, string][] = [
  ["manual", "Manual"],
  ["title", "Title"],
  ["status", "Status"],
  ["priority", "Priority"],
  ["assignee", "Assignee"],
  ["updated", "Updated"],
  ["created", "Created"],
  ["due", "Due date"],
  ["links", "Link count"],
  ["statusAge", "Time in status"],
];
export const PROPERTIES: [Property, string][] = [
  ["id", "ID"],
  ["status", "Status"],
  ["assignee", "Assignee"],
  ["creator", "Creator"],
  ["priority", "Priority"],
  ["project", "Project"],
  ["due", "Due date"],
  ["labels", "Labels"],
  ["links", "Links"],
  ["created", "Created"],
  ["updated", "Updated"],
  ["type", "Issue type"],
  ["comments", "Comments"],
];
export const FIELDS: [Field, string][] = [
  ["status", "Status"],
  ["assignee", "Assignee"],
  ["creator", "Creator"],
  ["priority", "Priority"],
  ["labels", "Labels"],
  ["relations", "Relations"],
  ["created", "Created date"],
  ["updated", "Updated date"],
  ["due", "Due date"],
  ["resolved", "Completed date"],
  ["project", "Project"],
  ["content", "Content"],
  ["links", "Links"],
  ["type", "Issue type"],
  ["parent", "Parent issue"],
];
PROPERTIES.push(
  ["milestone", "Milestone"],
  ["statusAge", "Time in status"],
  ["pullRequests", "Pull requests"],
);
FIELDS.push(
  ["milestone", "Milestone"],
  ["watchers", "Subscribers"],
  ["started", "Started date"],
  ["statusAge", "Time in current status"],
  ["pullRequests", "Pull requests"],
);
ORDERINGS.push(["estimate", "Estimate"]);
FIELDS.push(["estimate", "Estimate"]);
FIELDS.push(["projectLead", "Project lead"]);
export const OPERATORS: [Operator, string][] = [
  ["is", "is"],
  ["isNot", "is not"],
  ["contains", "contains"],
  ["notContains", "does not contain"],
  ["before", "before"],
  ["after", "after"],
  ["within", "in the last days"],
  ["next", "in the next days"],
  ["empty", "is empty"],
  ["notEmpty", "is not empty"],
];
export const isDate = (field: Field) =>
  ["created", "updated", "due", "resolved", "started"].includes(field);
OPERATORS.push(["gt", "greater than"], ["lt", "less than"]);
export const isNumeric = (field: Field) =>
  field === "statusAge" || field === "pullRequests" || field === "estimate";
/** Linear's operators per kind: choices are/aren't one of a list, text contains, dates and numbers compare. Status and type are never empty. */
export const operatorsFor = (field: Field) => {
  const ops: Operator[] = isNumeric(field)
    ? [
        "is",
        "isNot",
        "gt",
        "lt",
        ...(field === "statusAge" ? [] : (["empty", "notEmpty"] as const)),
      ]
    : isDate(field)
      ? ["is", "isNot", "before", "after", "within", "next", "empty", "notEmpty"]
      : field === "content"
        ? ["contains", "notContains"]
        : field === "links"
          ? ["contains", "notContains", "empty", "notEmpty"]
          : [
              "is",
              "isNot",
              // Jira always sets a status and an issue type.
              ...(field === "status" || field === "type" ? [] : (["empty", "notEmpty"] as const)),
            ];
  return OPERATORS.filter(([op]) => ops.includes(op));
};
/** Display settings equal, ignoring the order properties were toggled in. */
export const sameDisplay = (a: Display, b: Display) =>
  JSON.stringify({ ...a, properties: [...a.properties].sort() }) ===
  JSON.stringify({ ...b, properties: [...b.properties].sort() });
export const newId = () => crypto.randomUUID();
export const defaultDisplay = (): Display => ({
  layout: "board",
  columns: "status",
  rows: "none",
  ordering: "manual",
  descending: false,
  groupDescending: false,
  completedRecency: false,
  completedIssues: "all",
  subIssues: true,
  emptyGroups: false,
  nested: "matching",
  properties: ["id", "status", "assignee", "priority", "type", "labels", "comments", "updated"],
  openIn: "side",
});
export const defaultPreferences = (): Preferences => ({
  display: defaultDisplay(),
  filters: { id: "root", join: "and", children: [] },
  scope: "all",
  hidden: {},
  collapsed: {},
});

/** Treat saved settings as versioned input. Invalid or stale values fall back independently. */
export function parsePreferences(value: unknown): Preferences {
  const base = defaultPreferences();
  if (!value || typeof value !== "object") return base;
  if (["all", "active", "backlog"].includes((value as Preferences).scope))
    base.scope = (value as Preferences).scope;
  for (const key of ["hidden", "collapsed"] as const) {
    const saved = (value as Preferences)[key];
    if (saved && typeof saved === "object")
      base[key] = Object.fromEntries(
        Object.entries(saved)
          .filter(([g, v]) => GROUPINGS.some(([id]) => id === g) && Array.isArray(v))
          .map(([g, v]) => [g, v.filter((id) => typeof id === "string")]),
      );
  }
  const d = (value as Preferences).display;
  if (d && typeof d === "object") {
    for (const key of [
      "completedRecency",
      "subIssues",
      "emptyGroups",
      "descending",
      "groupDescending",
    ] as const)
      if (typeof d[key] === "boolean") base.display[key] = d[key];
    for (const key of ["columns", "rows"] as const)
      if (GROUPINGS.some(([v]) => v === d[key])) base.display[key] = d[key];
    if (["all", "day", "week", "month", "none"].includes(d.completedIssues)) base.display.completedIssues = d.completedIssues;
    if (ORDERINGS.some(([v]) => v === d.ordering)) base.display.ordering = d.ordering;
    if (["board", "list"].includes(d.layout)) base.display.layout = d.layout;
    if (["side", "page"].includes(d.openIn)) base.display.openIn = d.openIn;
    if (["matching", "all", "none"].includes(d.nested)) base.display.nested = d.nested;
    if (Array.isArray(d.properties))
      base.display.properties = [
        ...new Set(d.properties.filter((p) => PROPERTIES.some(([v]) => v === p))),
      ];
  }
  const parseGroup = (v: any, depth = 0): FilterGroup => ({
    id: typeof v?.id === "string" ? v.id : newId(),
    // An emptied "Match any" would silently OR the next plain filters.
    join: v?.join === "or" && v.children?.length ? "or" : "and",
    children:
      depth > 5 || !Array.isArray(v?.children)
        ? []
        : v.children.slice(0, 50).flatMap((c: any): (Rule | FilterGroup)[] => {
            if (c && Array.isArray(c.children)) return [parseGroup(c, depth + 1)];
            if (
              !c ||
              !FIELDS.some(([f]) => f === c.field) ||
              !operatorsFor(c.field).some(([op]) => op === c.op) ||
              !Array.isArray(c.values)
            )
              return [];
            return [
              {
                id: typeof c.id === "string" ? c.id : newId(),
                field: c.field,
                op: c.op,
                values: c.values.filter((v: any) => typeof v === "string"),
              },
            ];
          }),
  });
  base.filters = parseGroup((value as Preferences).filters);
  return base;
}

export const priorityRank = (p?: string) =>
  /highest|critical|showstopper|blocker|urgent/i.test(p ?? "")
    ? 0
    : /high|major/i.test(p ?? "")
      ? 1
      : /normal|medium/i.test(p ?? "")
        ? 2
        : /low|minor/i.test(p ?? "")
          ? 3
          : 4;
export function valuesFor(i: Issue, field: Field, issues: Issue[]): string[] {
  switch (field) {
    case "status":
      return [i.status];
    case "assignee":
      return i.assignee ? [i.assignee.id] : [];
    case "creator":
      return i.creator ? [i.creator.id] : [];
    case "labels":
      return i.labels;
    case "project":
      return i.project ? [i.project.key] : [];
    case "type":
      return i.type ? [i.type] : [];
    case "priority":
      return i.priority ? [i.priority] : [];
    case "parent":
      return i.parent ? [i.parent] : [];
    case "relations":
      return [
        ...(i.parent ? ["child"] : []),
        ...(issues.some((x) => x.parent === i.key) ? ["parent"] : []),
        ...(i.relations?.length ? ["related"] : []),
        ...(i.relations ?? []).map((r) => r.kind),
      ];
    case "content":
      return [`${i.key} ${i.summary} ${i.description ?? ""}`];
    case "links": // description links, Jira web links, and link resources
      return [
        ...new Set([
          ...(i.links ?? []),
          ...(i.resources ?? []).flatMap((r) => (r.kind === "link" && r.url ? [r.url] : [])),
        ]),
      ];
    case "created":
      return i.created ? [i.created] : [];
    case "updated":
      return [i.updated];
    case "resolved":
      return i.resolved ? [i.resolved] : [];
    case "due":
      return i.due ? [i.due] : [];
    case "milestone":
      return i.milestones?.map((v) => v.id) ?? [];
    case "watchers":
      return i.watchers?.map((u) => u.id) ?? [];
    case "started":
      return i.started ? [i.started] : [];
    case "statusAge":
      return i.statusSince ? [i.statusSince] : [];
    case "pullRequests": // "is empty": no pull requests
      return i.prCount ? [String(i.prCount)] : [];
    case "estimate":
      return i.estimate === undefined ? [] : [String(i.estimate)];
    case "projectLead":
      return i.projectLead ? [i.projectLead.id] : [];
  }
}

export function matchesRule(
  i: Issue,
  r: Rule,
  issues: Issue[],
  me: string,
  now = Date.now(),
): boolean {
  if (r.field === "watchers" && !i.watchersComplete) return false;
  if (r.field === "projectLead" && i.projectLead === undefined) return false;
  const actual = valuesFor(i, r.field, issues);
  if (r.op === "empty") return !actual.length;
  if (r.op === "notEmpty") return !!actual.length;
  if (!r.values.length) return true; // unfinished rule in the editor
  const values = r.values.map((v) => (v === "$me" ? me : v));
  if (isNumeric(r.field)) {
    const actualNumber =
      r.field === "statusAge"
        ? i.statusSince
          ? (now - Date.parse(i.statusSince)) / 864e5
          : NaN
        : r.field === "estimate"
          ? (i.estimate ?? NaN)
          : (i.prCount ?? NaN);
    const wanted = Number(values[0]);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(wanted) || wanted < 0) return false;
    return r.op === "gt"
      ? actualNumber > wanted
      : r.op === "lt"
        ? actualNumber < wanted
        : r.op === "isNot"
          ? actualNumber !== wanted
          : actualNumber === wanted;
  }
  if (isDate(r.field) || r.field === "started") {
    // A date-only value (due) is that local day, as the wanted day is; UTC would shift it a day west of Greenwich.
    const raw = actual[0] ?? "",
      date = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
    if (!Number.isFinite(date)) return r.op === "isNot";
    const day = (t: number) => new Date(t).toLocaleDateString("en-CA");
    if (r.op === "within" || r.op === "next") {
      const n = Number(values[0]);
      if (!Number.isFinite(n) || n < 0) return false;
      return r.op === "within"
        ? date <= now && date >= now - n * 864e5
        : date >= now && date <= now + n * 864e5;
    }
    // "P0D" is today, kept relative like Linear's `dueDate lt P0D` so a saved Overdue filter stays overdue.
    const wanted = Date.parse(`${values[0] === "P0D" ? day(now) : values[0]}T00:00:00`);
    if (!Number.isFinite(wanted)) return false;
    if (r.op === "before") return date < wanted;
    if (r.op === "after") return date >= wanted + 864e5;
    const same = day(date) === day(wanted);
    return r.op === "isNot" ? !same : same;
  }
  const hit = values.some((v) =>
    v === "$none"
      ? !actual.length
      : actual.some((a) =>
          ["contains", "notContains"].includes(r.op)
            ? a.toLowerCase().includes(v.toLowerCase())
            : a === v,
        ),
  );
  return ["isNot", "notContains"].includes(r.op) ? !hit : hit;
}

export function matchesFilters(
  i: Issue,
  group: FilterGroup,
  issues: Issue[],
  me: string,
  now = Date.now(),
): boolean {
  const active = (c: Rule | FilterGroup): boolean =>
    "children" in c
      ? c.children.some(active)
      : c.op === "empty" || c.op === "notEmpty" || c.values.length > 0;
  const children = group.children.filter(active);
  if (!children.length) return true;
  const match = (c: Rule | FilterGroup): boolean =>
    "children" in c ? matchesFilters(i, c, issues, me, now) : matchesRule(i, c, issues, me, now);
  return group.join === "or" ? children.some(match) : children.every(match);
}

export type Bucket = {
  id: string;
  name: string;
  status?: { name: string; category: string };
  issues: Issue[];
  statusIds?: string[];
};
function groupValues(i: Issue, by: Grouping, board: Board): { id: string; name: string }[] {
  switch (by) {
    case "none":
      return [{ id: "all", name: "All issues" }];
    case "status": {
      const c = board.columns.find((c) => c.statuses.some((s) => s.id === i.status));
      return [{ id: c?.name ?? "Other", name: c?.name ?? "Other" }];
    }
    case "category": {
      const key = statusById(board, i.status)?.category ?? "new";
      return [
        {
          id: key,
          name:
            (
              { new: "Unstarted", indeterminate: "Started", done: "Completed" } as Record<
                string,
                string
              >
            )[key] ?? key,
        },
      ];
    }
    case "assignee":
      return [{ id: i.assignee?.id ?? "$none", name: i.assignee?.name ?? "No assignee" }];
    case "project":
      return [{ id: i.project?.key ?? "$none", name: i.project?.name ?? "No project" }];
    case "priority":
      return [{ id: i.priority ?? "$none", name: i.priority ?? "No priority" }];
    case "type":
      return [{ id: i.type ?? "$none", name: i.type ?? "No type" }];
    case "parent":
      return [{ id: i.parent ?? "$none", name: i.parent ?? "No parent" }];
    case "label":
      return i.labels.length
        ? i.labels.map((l) => ({ id: l, name: l }))
        : [{ id: "$none", name: "No labels" }];
  }
}

/** A parent shows as "KEY Title" when its issue is known, like Linear. */
export const parentName = (key: string, issues: Issue[]) => {
  const summary = issues.find((i) => i.key === key)?.summary;
  return summary ? `${key} ${summary}` : key;
};

export function buckets(
  items: Issue[],
  by: Grouping,
  board: Board,
  universe = items,
  reverse = false,
): Bucket[] {
  const map = new Map<string, Bucket>();
  if (by === "status")
    for (const c of board.columns)
      map.set(c.name, {
        id: c.name,
        name: c.name,
        status: { name: c.name, category: c.statuses[0]?.category ?? "new" },
        statusIds: c.statuses.map((s) => s.id),
        issues: [],
      });
  for (const i of universe)
    for (const v of groupValues(i, by, board))
      if (!map.has(v.id)) map.set(v.id, { ...v, issues: [] });
  if (by === "none" && !map.size) map.set("all", { id: "all", name: "All issues", issues: [] });
  for (const i of items) for (const v of groupValues(i, by, board)) map.get(v.id)?.issues.push(i);
  if (by === "parent")
    for (const b of map.values()) if (b.id !== "$none") b.name = parentName(b.id, universe);
  const result = [...map.values()];
  if (by === "priority") result.sort((a, b) => priorityRank(a.name) - priorityRank(b.name));
  else if (by !== "status" && by !== "category")
    result.sort((a, b) =>
      a.id === "$none" ? 1 : b.id === "$none" ? -1 : a.name.localeCompare(b.name),
    );
  return reverse ? result.reverse() : result;
}

/** A rank that sorts (by code unit) after `a` and before `b`; no `b` means "at the end". */
// ponytail: ranks grow a character when dropped repeatedly into the same gap; rebalance if that ever matters.
export function rankBetween(a = "", b?: string): string {
  let out = "";
  for (let i = 0; ; i++) {
    const lo = i < a.length ? a.charCodeAt(i) : 31,
      hi = b === undefined || i >= b.length ? 127 : b.charCodeAt(i);
    const mid = (lo + hi) >> 1;
    if (mid > lo && mid > 32) return out + String.fromCharCode(mid); // never end on " ", or nothing could go before it
    const c = Math.max(lo, 32);
    out += String.fromCharCode(c);
    if (c < hi) b = undefined;
  }
}

export function selectIssues(
  all: Issue[],
  board: Board,
  prefs: Preferences,
  mine: boolean,
  query: string,
  me: string,
  now = Date.now(),
  acrossBoards = false,
): Issue[] {
  const d = prefs.display;
  const q = query.trim().toLowerCase();
  const items = all.filter(
    (i) =>
      (acrossBoards || i.board === board.id) &&
      (d.subIssues || !i.parent) &&
      (statusById(board, i.status)?.category !== "done" || d.completedIssues === "all" ||
        (d.completedIssues !== "none" && Date.parse(i.resolved ?? i.statusSince ?? "") >=
          now - ({ day: 1, week: 7, month: 30 }[d.completedIssues] ?? 0) * 86400000)) &&
      (prefs.scope === "all" ||
        (prefs.scope === "backlog"
          ? isBacklog(i, board)
          : !isBacklog(i, board) && statusById(board, i.status)?.category !== "done")) &&
      (!mine || i.assignee?.id === me) &&
      (!q || `${i.key} ${i.summary}`.toLowerCase().includes(q)) &&
      matchesFilters(i, prefs.filters, all, me, now),
  );
  const colOrder = (i: Issue) =>
    board.columns.findIndex((c) => c.statuses.some((s) => s.id === i.status));
  // Jira workflows that never set a resolution leave `resolved` empty; entering Done is then the completion time.
  const completed = (i: Issue) => i.resolved ?? i.statusSince ?? "";
  items.sort((a, b) => {
    let cmp = 0;
    switch (d.ordering) {
      case "manual": {
        const x = a.rank ?? "",
          y = b.rank ?? "";
        cmp = x < y ? -1 : x > y ? 1 : 0;
        break;
      } // ranks compare by code unit, like Jira's LexoRank
      case "title":
        cmp = a.summary.localeCompare(b.summary);
        break;
      case "status":
        cmp = colOrder(a) - colOrder(b);
        break;
      case "priority":
        cmp = priorityRank(a.priority) - priorityRank(b.priority);
        break;
      case "assignee":
        cmp = (a.assignee?.name ?? "~").localeCompare(b.assignee?.name ?? "~");
        break;
      case "links":
        cmp = (b.links?.length ?? 0) - (a.links?.length ?? 0);
        break;
      case "due":
        if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : a.key.localeCompare(b.key);
        cmp = a.due.localeCompare(b.due);
        break;
      case "updated":
        cmp = b.updated.localeCompare(a.updated);
        break;
      case "created":
        cmp = (b.created ?? "").localeCompare(a.created ?? "");
        break;
      case "statusAge":
        if (!a.statusSince || !b.statusSince) return a.statusSince ? -1 : b.statusSince ? 1 : 0;
        cmp = a.statusSince.localeCompare(b.statusSince);
        break;
      case "estimate":
        if (a.estimate === undefined || b.estimate === undefined)
          return a.estimate === undefined ? (b.estimate === undefined ? 0 : 1) : -1;
        cmp = a.estimate - b.estimate;
        break;
    }
    return (d.descending ? -cmp : cmp) || a.key.localeCompare(b.key, undefined, { numeric: true });
  });
  if (d.completedRecency) {
    // Done issues keep the slots the ordering gave them, refilled newest-completed first; mixing
    // recency into the comparator only for Done pairs made the sort non-transitive (R2-D2).
    const slots = items.flatMap((i, n) => (statusById(board, i.status)?.category === "done" ? [n] : []));
    const done = slots
      .map((n) => items[n]!)
      .sort((a, b) => completed(b).localeCompare(completed(a)));
    slots.forEach((n, k) => (items[n] = done[k]!));
  }
  return items;
}

/** Whether a status column can hold issues in this tab: Active never lists Backlog or Done columns, even as hidden. */
export function columnInScope(column: Board["columns"][number] | undefined, scope: Scope): boolean {
  if (!column || scope === "all") return true;
  const backlog =
    /backlog/i.test(column.name) ||
    (!!column.statuses.length && column.statuses.every((s) => /backlog/i.test(s.name)));
  return scope === "backlog"
    ? backlog
    : !backlog && column.statuses.some((s) => s.category !== "done");
}
export function isBacklog(issue: Issue, board: Board): boolean {
  return (
    board.columns.some(
      (c) => /backlog/i.test(c.name) && c.statuses.some((s) => s.id === issue.status),
    ) || /backlog/i.test(statusById(board, issue.status)?.name ?? "")
  );
}

export function updateFilter(
  group: FilterGroup,
  id: string,
  patch: Partial<Rule & FilterGroup> | null,
): FilterGroup {
  if (group.id === id)
    return patch ? { ...group, ...patch } : { ...group, join: "and", children: [] };
  const children = group.children.flatMap((c) =>
    c.id === id
      ? patch
        ? [{ ...c, ...patch } as Rule | FilterGroup]
        : []
      : ["children" in c ? updateFilter(c, id, patch) : c],
  );
  // Removing the last rule also drops "Match any", so later filters don't silently OR.
  return { ...group, children, ...(!patch && !children.length ? { join: "and" as const } : {}) };
}
export const filterCount = (g: FilterGroup): number =>
  g.children.reduce((n, c) => n + ("children" in c ? filterCount(c) : 1), 0);

/** Label groups can repeat a card; issue-page stepping visits each issue once. */
export const navigationIssues = (columns: Issue[][]): Issue[] => [
  ...new Map(columns.flat().map((i) => [i.key, i])).values(),
];

/** A board's groups as columns: status columns outside the scope drop out. `universe` is the board's issues. */
export function boardColumns(
  visible: Issue[],
  board: Board,
  prefs: Preferences,
  universe: Issue[],
): Bucket[] {
  const d = prefs.display;
  return buckets(visible, d.columns, board, universe, d.groupDescending).filter(
    (c) =>
      d.columns !== "status" ||
      columnInScope(
        board.columns.find((x) => x.name === c.id),
        prefs.scope,
      ),
  );
}

/** A board's cards per swimlane and column (`[lane][column]`): each column's issues that are also in the lane.
 *  With no swimlanes the one lane holds every visible issue, so each cell is its column. */
export function boardCells(columns: Bucket[], lanes: Bucket[]): Issue[][][] {
  return lanes.map((lane) => {
    const inLane = new Set(lane.issues);
    return columns.map((c) => c.issues.filter((i) => inLane.has(i)));
  });
}

/** What the "hidden by filters" feedback compares against: the count without temporary filters, search or the My
 *  issues toggle (a saved view keeps its own filters), and whether any of those temporary narrowings is on. */
export function resultsFeedback(
  all: Issue[],
  board: Board,
  prefs: Preferences,
  view: { board: number; filters: FilterGroup; mine?: boolean } | null,
  temporary: { overlay: FilterGroup; query: string; mine: boolean },
  personal: boolean,
  me: string,
  now = Date.now(),
): { baseline: number; temporary: boolean } {
  const filters = view && view.board === board.id ? view.filters : defaultPreferences().filters;
  const baseMine = personal || (view?.mine ?? false);
  return {
    baseline: selectIssues(all, board, { ...prefs, filters }, baseMine, "", me, now, personal).length,
    temporary:
      !!temporary.overlay.children.length || !!temporary.query || (temporary.mine && !baseMine),
  };
}

/** A view's shown groups bucketed once: a list's non-empty rows per group, or a board's swimlanes and cards per lane and column. */
export function groupLayout(shown: Bucket[], visible: Issue[], board: Board, d: Display) {
  if (d.layout === "list")
    return {
      rows: [] as Bucket[],
      cells: [] as Issue[][][],
      sections: shown.map((c) => buckets(c.issues, d.rows, board, c.issues).filter((r) => r.issues.length)),
    };
  const rows = buckets(visible, d.rows, board, visible);
  return { rows, cells: boardCells(shown, rows), sections: [] as Bucket[][] };
}

/** The on-screen order of a laid-out view, one array per column: a list is one column of its rows (nested sub-issues
 *  included), a board its cards row by row. A list's collapsed groups drop out; a card a label grouping repeats in a column is visited once. */
export function layoutOrder(
  shown: Bucket[],
  layout: ReturnType<typeof groupLayout>,
  prefs: Preferences,
  universe: Issue[],
): Issue[][] {
  const d = prefs.display,
    collapsed = prefs.collapsed[d.columns] ?? [];
  const order =
    d.layout === "list"
      ? [
          shown.flatMap((c, i) =>
            collapsed.includes(c.id)
              ? []
              : layout.sections[i]!.flatMap((r) =>
                  listRows(r.issues, universe, d.subIssues ? d.nested : "none").map((row) => row.issue),
                ),
          ),
        ]
      : shown.map((_, c) => layout.cells.flatMap((lane) => lane[c]!));
  return order.map((c) => [...new Map(c.map((i) => [i.key, i])).values()]);
}

/** The store fields the active board's visible issues depend on. */
export type OrderState = {
  boards: Board[];
  issues: Map<string, Issue>;
  board: number;
  preferences: Record<number, Preferences>;
  /** The open saved view's settings with its temporary filters, or the view editor's draft. */
  effectiveViewPreferences: Preferences | null;
  savedViews: { id: string; mine: boolean }[];
  activeViewId: string | null;
  mine: boolean;
  query: string;
  inbox?: boolean;
  editorDraft?: unknown;
  viewsPage?: boolean;
};
const noPreferences = defaultPreferences();
let lastOrder: { inputs: unknown[]; order: Issue[][] } | undefined;
/** The active board's issues in on-screen order, as the board shows them: J/K, ←/→ and the issue page's stepper all follow it.
 *  Memoised on its inputs, so a store selector can return it. */
export function visibleOrder(state: OrderState, me: string): Issue[][] {
  const personal = state.mine && !state.activeViewId && !state.editorDraft && !state.inbox && !state.viewsPage;
  const current = state.boards.find((b) => b.id === state.board);
  if (!current) return [];
  const board = personal ? myIssuesBoard(state.boards, current) : current;
  const prefs = state.effectiveViewPreferences ?? state.preferences[personal ? 0 : board.id] ?? noPreferences,
    mine = state.mine || !!state.savedViews.find((v) => v.id === state.activeViewId)?.mine,
    inputs = [state.issues, board, prefs, mine, state.query, me];
  if (lastOrder?.inputs.every((x, i) => x === inputs[i])) return lastOrder.order;
  const all = [...state.issues.values()],
    visible = selectIssues(all, board, prefs, mine, state.query, me, Date.now(), personal),
    universe = personal ? all : all.filter((i) => i.board === board.id),
    hidden = prefs.hidden[prefs.display.columns] ?? [],
    shown = boardColumns(visible, board, prefs, universe).filter((c) => !hidden.includes(c.id)),
    order = layoutOrder(shown, groupLayout(shown, visible, board, prefs.display), prefs, universe);
  lastOrder = { inputs, order };
  return order;
}

export function draftForGroup(
  by: Grouping,
  id: string,
  board: Board,
  issues: Issue[],
  scope: Scope,
): IssueDraft {
  switch (by) {
    case "status":
      return { status: board.columns.find((c) => c.name === id)?.statuses[0]?.id };
    case "category": {
      const status = board.columns
        .filter((c) => scope !== "active" || !/backlog/i.test(c.name))
        .flatMap((c) => c.statuses)
        .find((s) => s.category === id && (scope !== "active" || !/backlog/i.test(s.name)));
      return status ? { status: status.id } : {};
    }
    case "assignee":
      return { assignee: issues.find((i) => i.assignee?.id === id)?.assignee ?? null };
    case "priority":
      return { priority: id === "$none" ? "" : id };
    case "project":
      return { project: issues.find((i) => i.project?.key === id)?.project ?? null };
    case "label":
      return { labels: id === "$none" ? [] : [id] };
    case "parent":
      return { parent: id === "$none" ? undefined : id };
    case "type":
      return { type: id === "$none" ? undefined : id };
    case "none":
      return {};
  }
}

export function statusDuration(since: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60000));
  return minutes < 1
    ? "<1m"
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
}

/** The rendered list order is also the keyboard order, including revealed nonmatching children. */
export function listRows(
  items: Issue[],
  universe: Issue[],
  mode: Display["nested"],
): { issue: Issue; depth: number }[] {
  if (mode === "none") return items.map((issue) => ({ issue, depth: 0 }));
  const children = new Map<string, Issue[]>();
  for (const issue of mode === "all" ? universe : items)
    if (issue.parent) {
      const group = children.get(issue.parent) ?? [];
      group.push(issue);
      children.set(issue.parent, group);
    }
  const keys = new Set(items.map((i) => i.key));
  const seen = new Set<string>();
  const rows: { issue: Issue; depth: number }[] = [];
  const visit = (issue: Issue, depth: number) => {
    if (seen.has(issue.key)) return;
    seen.add(issue.key);
    rows.push({ issue, depth: Math.min(depth, 8) });
    for (const child of children.get(issue.key) ?? []) visit(child, depth + 1);
  };
  items.filter((i) => !i.parent || !keys.has(i.parent)).forEach((i) => visit(i, 0));
  items.forEach((i) => visit(i, 0)); // malformed parent cycles remain visible once
  return rows;
}

const personalBoards = new WeakMap<Board[], Map<Board, Board>>();
/** My issues uses all mirrored workflows, while issue actions still use each issue's own board. */
export function myIssuesBoard(boards: Board[], board: Board): Board {
  let cache = personalBoards.get(boards);
  if (!cache) personalBoards.set(boards, cache = new Map());
  const cached = cache.get(board);
  if (cached) return cached;
  const columns: Board["columns"] = [];
  for (const b of boards) for (const column of b.columns) {
    const existing = columns.find(c => c.name === column.name);
    if (!existing) columns.push({ ...column, statuses: [...column.statuses] });
    else for (const status of column.statuses)
      if (!existing.statuses.some(s => s.id === status.id)) existing.statuses.push(status);
  }
  const result = { ...board, name: "My issues", columns };
  cache.set(board, result);
  return result;
}
