import { compareNatural, compareText } from "@/shared/compare";
import { type Board, type Issue, type IssueDraft } from "@/shared/issue-model";

import { personIssues, type PersonTab } from "./people";
import { statusById } from "./board-catalog";
import { epicName, epicOf, hierarchyLevel, lookupIn, parentOf, type IssueLookup } from "./epics";
import { onBoard } from "./board-membership";

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
  | "priority"
  | "project"
  | "due"
  | "labels"
  | "links"
  | "created"
  | "updated"
  | "type"
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
  | "projectStatus"
  | "projectPriority"
  | "projectLabels"
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
  | "lt"
  | "isAll"
  | "notAll";
export type Rule = { id: string; field: Field; op: Operator; values: string[] };
export type FilterGroup = { id: string; join: "and" | "or"; children: (Rule | FilterGroup)[] };
export type Display = {
  layout: "board" | "list";
  columns: Grouping;
  rows: Grouping;
  ordering: Ordering;
  descending: boolean;
  completedRecency: boolean;
  completedIssues: "all" | "day" | "week" | "month" | "none";
  subIssues: boolean;
  emptyGroups: boolean;
  nested: "matching" | "all" | "none";
  properties: Property[];
  openIn: "side" | "page";
};
export type Scope = "all" | "active" | "backlog";
/** Group ids per column grouping: the hidden or collapsed groups of each grouping (Linear's `hiddenColumns`), or its
 *  group order (Linear's `columnOrderBoard`). */
export type GroupIds = Record<string, string[]>;
export type Preferences = {
  display: Display;
  filters: FilterGroup;
  scope: Scope;
  hidden: GroupIds;
  collapsed: GroupIds;
  /** The Group ordering panel's order per grouping: a local display preference, never written to Jira. */
  order: GroupIds;
};
export const GROUPINGS: [Grouping, string][] = [
  ["none", "No grouping"],
  ["status", "Status"],
  ["category", "Status type"],
  ["assignee", "Assignee"],
  ["project", "Epic"],
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
  ["priority", "Priority"],
  ["project", "Epic"],
  ["due", "Due date"],
  ["labels", "Labels"],
  ["links", "Links"],
  ["created", "Created"],
  ["updated", "Updated"],
  ["type", "Issue type"],
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
  ["project", "Epic"],
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
// Linear's Project properties (`gZt`), read off the issue's epic: its status, priority, labels and assignee as lead.
FIELDS.push(
  ["projectStatus", "Epic status"],
  ["projectPriority", "Epic priority"],
  ["projectLabels", "Epic labels"],
  ["projectLead", "Epic lead"],
);
/** One label per id across every menu: pick rows from a shared table (ORDERINGS, PROPERTIES) instead of retyping labels. */
export function pickLabels<T extends string, K extends T>(
  table: readonly (readonly [T, string])[],
  ids: readonly K[],
): [K, string][] {
  return ids.map((id) => {
    const row = table.find(([key]) => key === id);
    if (!row) throw new Error(`No label for ${id}`);
    return [id, row[1]];
  });
}
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
OPERATORS.push(["gt", "greater than"], ["lt", "less than"], ["isAll", "include all of"], ["notAll", "exclude if all"]);
/** Whether any of a board's issues (every board's, with no `board`) carries an estimate. Linear offers its estimate options
 * only where estimation is on (`team.estimationEnabled`); a Jira board says so only through its issues: a Kanban board has
 * no story points. Kept per issue map, so a selector reading it on every store change scans each map once. */
const estimated = new WeakMap<ReadonlyMap<string, Issue>, Map<number | undefined, boolean>>();
export function hasEstimates(issues: ReadonlyMap<string, Issue>, board?: number): boolean {
  let known = estimated.get(issues);
  if (!known) estimated.set(issues, (known = new Map()));
  let found = known.get(board);
  if (found === undefined) {
    found = false;
    for (const i of issues.values()) if (i.estimate !== undefined && (board === undefined || onBoard(i, board))) { found = true; break; }
    known.set(board, found);
  }
  return found;
}
export const isNumeric = (field: Field) =>
  field === "statusAge" || field === "pullRequests" || field === "estimate";
/** Linear's `collection` fields (FilterBlockHelper): an issue has several values, so a rule asks for any or all of them. */
const isCollection = (field: Field) =>
  field === "labels" || field === "watchers" || field === "projectLabels";
/** Linear's operators per kind: choices are/aren't one of a list, text contains, dates and numbers compare. Status and type are never empty.
 *  `count` is how many values the rule has: collections offer their all-of operators only for several (pass Infinity for every operator). */
export const operatorsFor = (field: Field, count = 1): [Operator, string][] => {
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
          : isCollection(field) && count > 1
            ? ["isAll", "is", "isNot", "notAll", "empty", "notEmpty"]
            : [
                "is",
                "isNot",
                // Jira always sets a status and an issue type.
                ...(field === "status" || field === "type" ? [] : (["empty", "notEmpty"] as const)),
              ];
  // Linear lists a collection's several-value operators in its own order; every other list keeps OPERATORS' order.
  const ordered = ops.includes("isAll") ? ops : OPERATORS.map(([op]) => op).filter((op) => ops.includes(op));
  return ordered.map((op) => [op, operatorLabel(field, op, count)]);
};
/** Linear's operator wording (FilterBlockHelper `J`), by field kind and value count: "is any of" for several values; a collection
 *  "include"s ("Labels include ui") and with several values reads "include any of", "include all of", "exclude if any of" or "exclude if all". */
export function operatorLabel(field: Field, op: Operator, count: number) {
  const many = count > 1;
  const plain = OPERATORS.find(([o]) => o === op)?.[1] ?? op;
  if (isNumeric(field) || isDate(field) || field === "content" || field === "links") return plain;
  if (isCollection(field))
    return op === "is"
      ? many ? "include any of" : "include"
      : op === "isAll"
        ? many ? "include all of" : "include"
        : op === "isNot"
          ? many ? "exclude if any of" : "do not include"
          : plain;
  return op === "is" && many ? "is any of" : plain;
}
/** A value filter's two operators everywhere but issue views (inbox, search): Linear's `equalValue` compare options
 *  (FilterBlockHelper `J`): "is", "is any of" for several values, and "is not". */
export type EqualOperator = "is" | "isNot";
export const equalOperators = (count: number): [EqualOperator, string][] => [
  ["is", count > 1 ? "is any of" : "is"],
  ["isNot", "is not"],
];
/** Display settings equal, ignoring the order properties were toggled in. */
export const sameDisplay = (a: Display, b: Display) =>
  JSON.stringify({ ...a, properties: [...a.properties].sort() }) ===
  JSON.stringify({ ...b, properties: [...b.properties].sort() });
/**
 * Linear's `hasUserChanges` (`userPreferencesHaveNoEffect`): whether anything Reset clears is set, so the toolbar's dot and
 * the Reset footer show. That is the display against `baseline`, plus the current grouping's hidden groups
 * (`hiddenColumns`/`hiddenGroupsList`) and group order (`columnOrderBoard`/`columnOrderList`), which Linear keeps among the
 * same view preferences. Collapsed groups are not view preferences (Linear keeps them per user, `collapsedGroups`).
 */
export const hasDisplayChanges = (prefs: Pick<Preferences, "display" | "hidden" | "order">, baseline: Display) =>
  !sameDisplay(prefs.display, baseline) ||
  !!prefs.hidden[prefs.display.columns]?.length ||
  !!prefs.order[prefs.display.columns]?.length;
/** Linear's `disregardSettings` → `clearPreferencesOrDelete`: `preferences = {}`, every user preference at once. The display
 *  returns to `baseline` and the hidden groups and group order of every grouping go; collapsed groups stay. */
export const resetDisplayPreferences = (baseline: Display): Pick<Preferences, "display" | "hidden" | "order"> => ({
  display: structuredClone(baseline),
  hidden: {},
  order: {},
});
export const newId = () => crypto.randomUUID();
export const defaultDisplay = (): Display => ({
  layout: "board",
  columns: "status",
  rows: "none",
  ordering: "manual",
  descending: false,
  completedRecency: false,
  completedIssues: "all",
  subIssues: true,
  emptyGroups: false,
  nested: "matching",
  properties: ["id", "status", "assignee", "priority", "type", "labels", "updated"],
  openIn: "side",
});
export const defaultPreferences = (): Preferences => ({
  display: defaultDisplay(),
  filters: { id: "root", join: "and", children: [] },
  scope: "all",
  hidden: {},
  collapsed: {},
  order: {},
});

/** Linear's toggle-all (Collapse all / Expand all, ⌥-click on a group's chevron, ⌥T: `toggleCollapsedItemKey(key, true)`, the
 *  TOGGLE_ITEMS `toggleAllGroups` case of startup-root `Bit`): every group takes the opposite of `ref`'s current state, whatever
 *  state the other groups are in. Returns the grouping's new collapsed ids. */
export function collapseAllFrom(collapsed: readonly string[], groups: readonly string[], ref: string): string[] {
  return collapsed.includes(ref)
    ? collapsed.filter((id) => !groups.includes(id))
    : [...new Set([...collapsed, ...groups])];
}

/** Stored hidden or collapsed groups: unknown groupings and non-string ids drop; anything else reads as none. */
export const parseGroupIds = (saved: unknown): GroupIds =>
  saved && typeof saved === "object" && !Array.isArray(saved)
    ? Object.fromEntries(
        Object.entries(saved)
          .filter((e): e is [string, unknown[]] => GROUPINGS.some(([id]) => id === e[0]) && Array.isArray(e[1]))
          .map(([g, v]) => [g, v.filter((id): id is string => typeof id === "string")]),
      )
    : {};

/** Treat saved settings as versioned input. Invalid or stale values fall back independently. */
export function parsePreferences(value: unknown): Preferences {
  const base = defaultPreferences();
  if (!value || typeof value !== "object") return base;
  if (["all", "active", "backlog"].includes((value as Preferences).scope))
    base.scope = (value as Preferences).scope;
  base.hidden = parseGroupIds((value as Preferences).hidden);
  base.collapsed = parseGroupIds((value as Preferences).collapsed);
  base.order = parseGroupIds((value as Preferences).order);
  const d = (value as Preferences).display;
  if (d && typeof d === "object") {
    for (const key of [
      "completedRecency",
      "subIssues",
      "emptyGroups",
      "descending",
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
/** The issue's epic (its project), from `issues`. */
const epicIn = (i: Issue, issues: Issue[]) => {
  const lookup = lookupIn(issues),
    key = epicOf(i, lookup);
  return key ? lookup(key) : undefined;
};
const parents = new WeakMap<readonly Issue[], Set<string>>();
/** The keys some issue in `issues` names as its parent, built once per list: a Relations pass asks it for every issue, where a
 *  scan per issue made the pass quadratic. */
export function parentKeys(issues: readonly Issue[]): Set<string> {
  let keys = parents.get(issues);
  if (!keys) {
    keys = new Set();
    for (const x of issues) if (x.parent) keys.add(x.parent);
    parents.set(issues, keys);
  }
  return keys;
}
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
    case "project": {
      const epic = epicOf(i, lookupIn(issues));
      return epic ? [epic] : [];
    }
    case "type":
      return i.type ? [i.type] : [];
    case "priority":
      return i.priority ? [i.priority] : [];
    case "parent": {
      const parent = parentOf(i, lookupIn(issues));
      return parent ? [parent] : [];
    }
    case "relations":
      // Parent and sub-issue mean parent issues only: an epic's issues are its project's (shared/epics.ts parentOf).
      return [
        ...(parentOf(i, lookupIn(issues)) ? ["child"] : []),
        ...(hierarchyLevel(i) < 1 && parentKeys(issues).has(i.key) ? ["parent"] : []),
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
    case "projectStatus": {
      const status = epicIn(i, issues)?.status;
      return status ? [status] : [];
    }
    case "projectPriority": {
      const priority = epicIn(i, issues)?.priority;
      return priority ? [priority] : [];
    }
    case "projectLabels":
      return epicIn(i, issues)?.labels ?? [];
    case "projectLead": {
      const lead = epicIn(i, issues)?.assignee;
      return lead ? [lead.id] : [];
    }
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
          : // Jira leaves the Development field off an issue with no pull requests: that is 0, as "is empty" already reads it.
            (i.prCount ?? 0);
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
  const has = (v: string) =>
    v === "$none"
      ? !actual.length
      : actual.some((a) =>
          ["contains", "notContains"].includes(r.op)
            ? a.toLowerCase().includes(v.toLowerCase())
            : a === v,
        );
  if (r.op === "isAll" || r.op === "notAll") return values.every(has) === (r.op === "isAll");
  const hit = values.some(has);
  return ["isNot", "notContains"].includes(r.op) ? !hit : hit;
}

/**
 * How many of `issues` match `{ field, op: "is", values: [value] }` for every value at once: what `matchesRule` gives value by
 * value, in one pass over the issues instead of one per value (a picker counting 1,000 labels over 1,000 issues made a million
 * rule checks per open). "$none" counts issues with no value and "$me" those holding `me`. Dates and numbers compare rather than
 * match, so those fields count value by value.
 */
export function valueCounts(
  issues: readonly Issue[],
  field: Field,
  universe: Issue[],
  me: string,
  now = Date.now(),
): (value: string) => number {
  if (isNumeric(field) || isDate(field))
    return (value) =>
      issues.filter((i) => matchesRule(i, { id: "count", field, op: "is", values: [value] }, universe, me, now)).length;
  const counts = new Map<string, number>();
  let none = 0;
  for (const i of issues) {
    // matchesRule: an issue whose watchers aren't all loaded matches no watchers rule, "$none" included.
    if (field === "watchers" && !i.watchersComplete) continue;
    const actual = valuesFor(i, field, universe);
    if (!actual.length) none++;
    for (const value of new Set(actual)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return (value) => (value === "$none" ? none : (counts.get(value === "$me" ? me : value) ?? 0));
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
function groupValues(
  i: Issue,
  by: Grouping,
  board: Board,
  lookup: IssueLookup,
): { id: string; name: string }[] {
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
    case "project": {
      const epic = epicOf(i, lookup);
      return [epic ? { id: epic, name: epicName(epic, lookup) } : { id: "$none", name: "No epic" }];
    }
    case "priority":
      return [{ id: i.priority ?? "$none", name: i.priority ?? "No priority" }];
    case "type":
      return [{ id: i.type ?? "$none", name: i.type ?? "No type" }];
    case "parent": {
      const parent = parentOf(i, lookup);
      return [{ id: parent ?? "$none", name: parent ?? "No parent" }];
    }
    case "label":
      return i.labels.length
        ? i.labels.map((l) => ({ id: l, name: l }))
        : [{ id: "$none", name: "No labels" }];
  }
}

/** A parent shows as "KEY Title" when its issue is known, like Linear. */
export const parentName = (key: string, issues: readonly Issue[] | IssueLookup) => {
  // A key lookup (one index per list), not a scan of every issue for every parent.
  const summary = (typeof issues === "function" ? issues : lookupIn(issues))(key)?.summary;
  return summary ? `${key} ${summary}` : key;
};

/** `order` is the Group ordering panel's stored order for this grouping (see orderGroups). `lookup` finds an issue's epic
 *  for the Project grouping, from the universe unless the caller holds more (a lane's issues don't hold their epics). */
export function buckets(
  items: Issue[],
  by: Grouping,
  board: Board,
  universe = items,
  order: readonly string[] = [],
  lookup: IssueLookup = lookupIn(universe),
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
    for (const v of groupValues(i, by, board, lookup))
      if (!map.has(v.id)) map.set(v.id, { ...v, issues: [] });
  if (by === "none" && !map.size) map.set("all", { id: "all", name: "All issues", issues: [] });
  for (const i of items)
    for (const v of groupValues(i, by, board, lookup)) map.get(v.id)?.issues.push(i);
  if (by === "parent")
    for (const b of map.values()) if (b.id !== "$none") b.name = parentName(b.id, lookup);
  const result = [...map.values()];
  if (by === "priority") result.sort((a, b) => priorityRank(a.name) - priorityRank(b.name));
  else if (by !== "status" && by !== "category")
    result.sort((a, b) =>
      a.id === "$none" ? 1 : b.id === "$none" ? -1 : compareText(a.name, b.name),
    );
  return orderGroups(result, order);
}

/** Linear's `Tat`: groups with a fixed natural order (priority, like its dates and cycles) cannot be custom-ordered, so
 *  Linear shows no Group ordering for them. No grouping has no groups to order. */
export const canOrderGroups = (by: Grouping) => by !== "none" && by !== "priority";

/**
 * Linear's `Nat`: the groups the stored order names take the slots those groups hold in the default order, in the stored
 * order; every other group (one created since) keeps its default slot. Stored ids with no group are skipped.
 */
export function orderGroups<T extends { id: string }>(groups: T[], stored: readonly string[]): T[] {
  const named = new Map(groups.map((g) => [g.id, g]));
  const picked = [...new Set(stored)].flatMap((id) => named.get(id) ?? []);
  if (!picked.length) return groups;
  const moved = new Set(picked);
  let next = 0;
  return groups.map((g) => (moved.has(g) ? picked[next++]! : g));
}

/** The order after dragging `id` onto `target`'s slot in `ids` (every group, in shown order): it lands before the target
 *  when moving up and after it when moving down, as a sortable list's drop does. */
export function moveGroup(ids: readonly string[], id: string, target: string): string[] {
  const from = ids.indexOf(id),
    to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const out = ids.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

/** What to store for a new order: every current group in it, then the stored ids of groups not on the board now (another
 *  tab's columns, a label nobody uses yet), so they keep their place once they are back (Linear's `Hat`). */
export const storedGroupOrder = (order: readonly string[], stored: readonly string[]): string[] => [
  ...order,
  ...stored.filter((id) => !order.includes(id)),
];

/** A board's groups split for display: hidden are those the user hid, and empty ones unless Show empty groups is on. */
export function groupVisibility(columns: Bucket[], prefs: Preferences) {
  const hiddenIds = prefs.hidden[prefs.display.columns] ?? [];
  const isHidden = (c: Bucket) => hiddenIds.includes(c.id) || (!prefs.display.emptyGroups && !c.issues.length);
  return { hiddenIds, show: columns.filter((c) => !isHidden(c)), hidden: columns.filter(isHidden) };
}

/** The groups a board or list draws. While the zero state shows (a page's own empty state, "No issues matching the
 * filters", a saved view's "No matching issues"), Linear's IssueList draws only its empty placeholder (IssueList `df`: no
 * visible row and none hidden), so no empty group, Hidden groups strip or Hidden columns list (BJ-331). A page with no
 * issue at all draws its empty state in their place too, My issues included (BJ-336). The Group ordering panel still
 * takes groupVisibility's split. */
export function drawnGroups<T extends { show: Bucket[]; hidden: Bucket[] }>(groups: T, zeroState: boolean): T {
  return zeroState ? { ...groups, show: [], hidden: [] } : groups;
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

/** `mine` keeps my assigned issues; on the personal page, the open person's tab instead (people.ts). */
export function selectIssues(
  all: Issue[],
  board: Board,
  prefs: Preferences,
  mine: boolean | ((i: Issue) => boolean),
  query: string,
  me: string,
  now = Date.now(),
  acrossBoards = false,
): Issue[] {
  const d = prefs.display;
  const q = query.trim().toLowerCase();
  // "Show sub-issues" hides parent issues' children only; an issue in an epic is in a project, not a sub-issue.
  const lookup = lookupIn(all);
  const items = all.filter(
    (i) =>
      // My issues and a person's page reach across boards, but an issue kept on no board (BJ-341) is in no list: it opens by key.
      (acrossBoards ? i.boards.length > 0 : onBoard(i, board.id)) &&
      (d.subIssues || !parentOf(i, lookup)) &&
      (statusById(board, i.status)?.category !== "done" || d.completedIssues === "all" ||
        (d.completedIssues !== "none" && Date.parse(i.resolved ?? i.statusSince ?? "") >=
          now - ({ day: 1, week: 7, month: 30 }[d.completedIssues] ?? 0) * 86400000)) &&
      (prefs.scope === "all" ||
        (prefs.scope === "backlog"
          ? isBacklog(i, board)
          : !isBacklog(i, board) && statusById(board, i.status)?.category !== "done")) &&
      (typeof mine === "function" ? mine(i) : !mine || i.assignee?.id === me) &&
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
        cmp = compareText(a.summary, b.summary);
        break;
      case "status":
        cmp = colOrder(a) - colOrder(b);
        break;
      case "priority":
        cmp = priorityRank(a.priority) - priorityRank(b.priority);
        break;
      case "assignee":
        cmp = compareText(a.assignee?.name ?? "~", b.assignee?.name ?? "~");
        break;
      case "links":
        cmp = (b.links?.length ?? 0) - (a.links?.length ?? 0);
        break;
      case "due":
        if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : compareText(a.key, b.key);
        cmp = compareText(a.due, b.due);
        break;
      case "updated":
        cmp = compareText(b.updated, a.updated);
        break;
      case "created":
        cmp = compareText(b.created ?? "", a.created ?? "");
        break;
      case "statusAge":
        if (!a.statusSince || !b.statusSince) return a.statusSince ? -1 : b.statusSince ? 1 : 0;
        cmp = compareText(a.statusSince, b.statusSince);
        break;
      case "estimate":
        if (a.estimate === undefined || b.estimate === undefined)
          return a.estimate === undefined ? (b.estimate === undefined ? 0 : 1) : -1;
        cmp = a.estimate - b.estimate;
        break;
    }
    return (d.descending ? -cmp : cmp) || compareNatural(a.key, b.key);
  });
  if (d.completedRecency) {
    // Done issues keep the slots the ordering gave them, refilled newest-completed first; mixing
    // recency into the comparator only for Done pairs made the sort non-transitive (R2-D2).
    const slots = items.flatMap((i, n) => (statusById(board, i.status)?.category === "done" ? [n] : []));
    const done = slots
      .map((n) => items[n]!)
      .sort((a, b) => compareText(completed(b), completed(a)));
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

/** Where `key` sits in the stepper's list, or none when the list can't be stepped: Linear's `jf` (IssueList) hides the whole
 *  position-and-arrows control when the issue isn't in its siblings or there's only one (`if(i<0||r.length<=1)return null`). */
export function listPosition(issues: readonly Issue[], key: string): { index: number; total: number } | undefined {
  const index = issues.findIndex((i) => i.key === key);
  return index < 0 || issues.length <= 1 ? undefined : { index, total: issues.length };
}

/** A board's groups as columns: status columns outside the scope drop out. `universe` is the board's issues. */
export function boardColumns(
  visible: Issue[],
  board: Board,
  prefs: Preferences,
  universe: Issue[],
): Bucket[] {
  const d = prefs.display;
  return buckets(visible, d.columns, board, universe, canOrderGroups(d.columns) ? prefs.order[d.columns] : []).filter(
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
  /** The personal page's person filter, or false off it. */
  personal: false | ((i: Issue) => boolean),
  me: string,
  now = Date.now(),
): { baseline: number; temporary: boolean } {
  const filters = view && view.board === board.id ? view.filters : defaultPreferences().filters;
  const baseMine = personal || (view?.mine ?? false);
  return {
    baseline: selectIssues(all, board, { ...prefs, filters }, baseMine, "", me, now, !!personal).length,
    temporary:
      !!temporary.overlay.children.length || !!temporary.query || (temporary.mine && !baseMine),
  };
}

/** A view's shown groups bucketed once: a list's non-empty rows per group, or a board's swimlanes and cards per lane and column.
 *  `universe` (the board's issues) names each lane's project. */
export function groupLayout(shown: Bucket[], visible: Issue[], board: Board, d: Display, universe = visible) {
  const lookup = lookupIn(universe);
  if (d.layout === "list")
    return {
      rows: [] as Bucket[],
      cells: [] as Issue[][][],
      sections: shown.map((c) =>
        buckets(c.issues, d.rows, board, c.issues, [], lookup).filter((r) => r.issues.length),
      ),
    };
  const rows = buckets(visible, d.rows, board, visible, [], lookup);
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
  person?: string | null;
  personTab?: PersonTab;
  query: string;
  inbox?: boolean;
  editorDraft?: unknown;
};
const noPreferences = defaultPreferences();
let lastView: { inputs: unknown[]; view: BoardView } | undefined;
/** The active board as it is laid out: its effective settings, every group in shown order (hidden ones included), and the
 *  visible groups' issues in on-screen order. Memoised on its inputs, so a store selector can return it. */
type BoardView = { board: Board; prefs: Preferences; columns: Bucket[]; order: Issue[][] };
export function boardView(state: OrderState, me: string): BoardView | undefined {
  const personal = state.mine && !state.activeViewId && !state.editorDraft && !state.inbox;
  const current = state.boards.find((b) => b.id === state.board);
  if (!current) return undefined;
  const board = personal ? myIssuesBoard(state.boards, current) : current;
  const prefs = state.effectiveViewPreferences ?? state.preferences[personal ? 0 : board.id] ?? noPreferences,
    mine = state.mine || !!state.savedViews.find((v) => v.id === state.activeViewId)?.mine,
    who = personal ? personIssues(state.person ?? me, state.personTab ?? "assigned", me) : mine,
    inputs = [state.issues, board, prefs, mine, state.query, me, state.person, state.personTab];
  if (lastView?.inputs.every((x, i) => x === inputs[i])) return lastView.view;
  const all = [...state.issues.values()],
    visible = selectIssues(all, board, prefs, who, state.query, me, Date.now(), personal),
    universe = personal ? all : all.filter((i) => onBoard(i, board.id)),
    hidden = prefs.hidden[prefs.display.columns] ?? [],
    columns = boardColumns(visible, board, prefs, universe),
    shown = columns.filter((c) => !hidden.includes(c.id)),
    order = layoutOrder(shown, groupLayout(shown, visible, board, prefs.display, universe), prefs, universe);
  lastView = { inputs, view: { board, prefs, columns, order } };
  return lastView.view;
}
/** The active board's issues in on-screen order, as the board shows them: J/K, ←/→ and the issue page's stepper all follow it. */
export const visibleOrder = (state: OrderState, me: string): Issue[][] => boardView(state, me)?.order ?? [];

/** The group a card in `key`'s group moves to by Move left/right (Linear's `Rvr`/`zvr`): the nearest one in `direction` that the
 *  board shows, skipping hidden groups and, unless Show empty groups is on, empty ones (Linear's `Gvr`); none at the edge. */
export function groupStep(columns: Bucket[], prefs: Preferences, key: string, direction: number): Bucket | undefined {
  const at = columns.findIndex((c) => c.issues.some((i) => i.key === key));
  if (at < 0) return undefined;
  const shown = new Set(groupVisibility(columns, prefs).show);
  for (let i = at + direction; i >= 0 && i < columns.length; i += direction)
    if (shown.has(columns[i]!)) return columns[i];
  return undefined;
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
    case "project": // the epic is the issue's Jira parent; its Jira project stays the board's
      return id === "$none" ? {} : { parent: id };
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
  // Nesting follows parent issues only: an epic's issues are its project's, so they never nest under it (parentOf).
  const lookup = lookupIn(universe);
  const parents = new Map<Issue, string | undefined>();
  const parentIn = (issue: Issue) => {
    if (!parents.has(issue)) parents.set(issue, parentOf(issue, lookup));
    return parents.get(issue);
  };
  const children = new Map<string, Issue[]>();
  for (const issue of mode === "all" ? universe : items) {
    const parent = parentIn(issue);
    if (parent) {
      const group = children.get(parent) ?? [];
      group.push(issue);
      children.set(parent, group);
    }
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
  items.filter((i) => !parentIn(i) || !keys.has(parentIn(i)!)).forEach((i) => visit(i, 0));
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

/** Count unique matching issues suppressed by display settings; filters and scope stay intact. */
export function displayHiddenCount(all: Issue[], board: Board, prefs: Preferences, mine: boolean | ((i: Issue) => boolean), query: string, me: string, now = Date.now(), acrossBoards = false): number {
  const eligible = selectIssues(all, board, { ...prefs, display: { ...prefs.display, subIssues: true, completedIssues: "all" } }, mine, query, me, now, acrossBoards);
  const visible = selectIssues(all, board, prefs, mine, query, me, now, acrossBoards);
  const hidden = prefs.hidden[prefs.display.columns] ?? [];
  const shown = new Set(boardColumns(visible, board, prefs, all).filter(c => !hidden.includes(c.id)).flatMap(c => c.issues.map(i => i.key)));
  return eligible.filter(i => !shown.has(i.key)).length;
}

/** lodash `truncate(text, { length, omission: "…" })`, as Linear cuts a title or a comment: the omission counts toward the
 *  length. */
export const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
