import { type Board, type IssueDraft, type User } from "@/shared/issue-model";
import { statuses } from "./board-catalog";
import { epicLocked, epicPatch, isEpic, type IssueLookup } from "./epics";
import { type Field, type FilterGroup, type Operator, type Rule } from "./view-model";

/**
 * A new issue's properties from the view's filters: Linear's create defaults (`SQt` overridesFromFilters in
 * startup-root.CnUSfl4j.js), so an issue made on a "label = api" view has the api label and stays in the view.
 *
 * Linear reads a filter's values with `fQ` (startup-entry.Dt5YDWdY.js): only "is", "is any of", "includes all of" and "contains"
 * rules count, never "is not". Status, labels, assignee and priority each resolve those values their own way (`IZt`):
 * - assignee and priority take a value only when the filter names exactly one (`UZt`, `JZt`); a filter naming several people
 *   offers them under Suggested in the assignee picker instead (`Qun`'s `filterOverrides.assignee.secondary`);
 * - labels take every label the filter requires, up to six (`YZt`, `SQt`'s `.slice(0,6)`);
 * - status takes one of the statuses the filter allows, even several (`VZt`): the default status when it is one of them, else
 *   the earliest open one in workflow order;
 * - project (here the issue's epic, shared/epics.ts) takes a value only when the filter names exactly one project that exists
 *   (`GZt`: "No project" and unknown ids drop out), and every project the filter names is listed first in the composer's
 *   project picker (`zBn`'s `filterOverrides.project.secondary`).
 * Values that only some issues need (one rule of a top-level "any" filter, or "is any of" with two values) are ambiguous, and
 * Linear's `unambiguousOnly` drops them for every property but status. Milestone is left out (a parked decision).
 */
export type CreateOverrides = {
  status?: string | undefined;
  assignee?: User | undefined;
  /** People the filter names when it names more than one: Suggested in the assignee picker. */
  suggested?: User[];
  priority?: string | undefined;
  labels?: string[];
  /** The epic, when the filter names exactly one. */
  epic?: string | undefined;
  /** Every epic the filter names: first in the composer's project picker. */
  epics?: string[];
};
export type CreateContext = {
  board: Board;
  /** Everyone an issue can be assigned to, to resolve an assignee filter's account ids. */
  people: readonly User[];
  me: User;
  /** The status a new issue gets without a status filter (Linear's `team.defaultState`). */
  defaultStatus: string | undefined;
  /** The mirror's issues by key, to resolve a project filter's epic keys (`GZt`'s `store.findById`). */
  lookup: IssueLookup;
};

/** `fQ`'s positive compare options (`ove`: all, any, is, contains). */
const POSITIVE: ReadonlySet<Operator> = new Set(["is", "isAll", "contains"]);
const live = (c: Rule | FilterGroup): boolean =>
  "children" in c ? c.children.some(live) : c.op === "empty" || c.op === "notEmpty" || c.values.length > 0;
const rules = (g: FilterGroup): Rule[] => g.children.flatMap((c) => ("children" in c ? rules(c) : [c]));

/** `fQ`: the values a filter asks a field to have. `unambiguous` skips a top-level "any" of several rules, and a rule that
 *  allows one of several values (anything but "includes all of"). */
function filterValues(filters: FilterGroup, field: Field, unambiguous: boolean): string[] {
  if (unambiguous && filters.join === "or" && filters.children.filter(live).length > 1) return [];
  return rules(filters)
    .filter(
      (r) =>
        r.field === field &&
        POSITIVE.has(r.op) &&
        r.values.length > 0 &&
        !(unambiguous && r.op !== "isAll" && r.values.length > 1),
    )
    .flatMap((r) => r.values);
}

/** `VZt`: of the statuses a filter allows, the default one, else the earliest open one in workflow order. */
function filterStatus(values: string[], board: Board, defaultStatus: string | undefined): string | undefined {
  const order = statuses(board),
    at = (id: string) => order.findIndex((s) => s.id === id),
    closed = (id: string) => order[at(id)]?.category === "done";
  const allowed = values.filter((v) => at(v) >= 0);
  return allowed.reduce<string | undefined>((best, s) => {
    if (!best) return s;
    if (closed(s) || best === defaultStatus) return best;
    if (s === defaultStatus) return s;
    return at(best) > at(s) ? s : best;
  }, undefined);
}

/** `IZt`: the overrides one filter tree asks for. A key is present when the filter names its field at all, even ambiguously,
 *  so a view's overlay replaces what its saved filter asked for that field (`{...LZt(view), ...IZt(panel)}`). */
export function filterOverrides(filters: FilterGroup, ctx: CreateContext): CreateOverrides {
  const out: CreateOverrides = {};
  const person = (v: string) =>
    v === "$me" ? ctx.me : v === "$none" ? undefined : ctx.people.find((p) => p.id === v);
  if (filterValues(filters, "status", false).length)
    out.status = filterStatus(filterValues(filters, "status", false), ctx.board, ctx.defaultStatus);
  const anyone = filterValues(filters, "assignee", false);
  if (anyone.length) {
    const one = filterValues(filters, "assignee", true).flatMap((v) => person(v) ?? []);
    out.assignee = one.length === 1 ? one[0] : undefined;
    out.suggested = anyone.flatMap((v) => person(v) ?? []).filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i);
  }
  if (filterValues(filters, "priority", false).length) {
    const one = filterValues(filters, "priority", true);
    out.priority = one.length === 1 && one[0] !== "$none" ? one[0] : undefined;
  }
  if (filterValues(filters, "labels", false).length)
    out.labels = [...new Set(filterValues(filters, "labels", true).filter((l) => l !== "$none"))].slice(0, 6);
  if (filterValues(filters, "project", false).length) {
    // `GZt`: "No project" ($none) and keys that name no epic the mirror holds drop out before counting.
    const epics = (values: string[]) => [...new Set(values)].filter((k) => { const e = ctx.lookup(k); return !!e && isEpic(e); });
    const one = epics(filterValues(filters, "project", true));
    out.epic = one.length === 1 ? one[0] : undefined;
    out.epics = epics(filterValues(filters, "project", false));
  }
  return out;
}

/**
 * The draft a create from a view starts with: the saved view's filter, then the view's own filter (a plain board's, or the
 * overlay on a saved view) field by field over it. `draft` (a group's "+", anything else the caller passes) wins over both, as
 * Linear's group draft does (`A?.labels ?? j.labels`, `A?.project ?? j.project?.primary`). The filter's epic goes in through
 * `epicPatch`, and only when the draft can join an epic at all: a draft that brings its own parent, or a type `epicLocked` keeps
 * out of epics (an epic, a sub-task, an initiative), takes none.
 */
export function createDefaults(
  saved: FilterGroup | undefined,
  own: FilterGroup,
  ctx: CreateContext,
  draft: IssueDraft = {},
): IssueDraft {
  const o = { ...(saved ? filterOverrides(saved, ctx) : {}), ...filterOverrides(own, ctx) };
  const epic = o.epic && !draft.parent && !epicLocked({ type: draft.type }) ? o.epic : undefined;
  return {
    ...(o.status ? { status: o.status } : {}),
    ...(o.assignee ? { assignee: o.assignee } : {}),
    ...(o.suggested?.length ? { suggestedAssignees: o.suggested } : {}),
    ...(o.priority ? { priority: o.priority } : {}),
    ...(o.labels?.length ? { labels: o.labels } : {}),
    ...(epic ? epicPatch(epic) : {}),
    ...(o.epics?.length ? { suggestedEpics: o.epics } : {}),
    ...draft,
  };
}
