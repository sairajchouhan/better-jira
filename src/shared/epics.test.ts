import { type Board, type Issue, type PropertyActivity } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import {
  canNest,
  epicChanges,
  epicChoices,
  epicLocked,
  epicOf,
  epicPatch,
  hierarchyLevel,
  listedUnder,
  listsSubIssues,
  lookupIn,
  parentOf,
  subIssueParent,
  titleParentOf,
} from "./epics";
import { buckets, defaultPreferences, draftForGroup, listRows, matchesRule, selectIssues, type Rule } from "./view-model";
import { opsFor } from "./jira-ops";

const board: Board = {
  id: 1,
  name: "Board",
  columns: [
    { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
    { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
  ],
};
const issue = (key: string, patch: Partial<Issue> = {}): Issue => ({
  key,
  board: 1,
  summary: key,
  status: "todo",
  type: "Task",
  assignee: null,
  labels: [],
  comments: 0,
  updated: "2026-11-06T10:00:00Z",
  resolved: null,
  project: { key: "E", name: "Jira project" },
  ...patch,
});
// Made-up keys in work Jira's shape: an initiative over two epics, a task in each, a sub-task under a task, a loose task.
const initiative = issue("E-1", { type: "Initiative", summary: "Initiative" });
const billing = issue("E-2", { type: "Epic", summary: "Billing", parent: "E-1" });
const archive = issue("E-3", { type: "Epic", summary: "Archive", status: "done" });
const inBilling = issue("E-10", { parent: "E-2" });
const subTask = issue("E-11", { type: "Sub-task", parent: "E-10" });
const loose = issue("E-12");
const all = [initiative, billing, archive, inBilling, subTask, loose];
const lookup = lookupIn(all);
const rule = (values: string[], op: Rule["op"] = "is"): Rule => ({ id: "r", field: "project", op, values });

test("hierarchy level: Jira's own level wins, else the type's name", () => {
  expect(hierarchyLevel({ type: "Epic" })).toBe(1);
  expect(hierarchyLevel({ type: "Initiative" })).toBe(2);
  expect(hierarchyLevel({ type: "Sub-task" })).toBe(-1);
  expect(hierarchyLevel({ type: "Subtask" })).toBe(-1);
  expect(hierarchyLevel({ type: "Story" })).toBe(0);
  // A site that renames its epic type still reports level 1.
  expect(hierarchyLevel({ type: "Feature", level: 1 })).toBe(1);
});

test("an issue's project is its epic: the epic parent, a sub-task's parent's epic, the epic itself, no initiative", () => {
  expect(epicOf(inBilling, lookup)).toBe("E-2");
  expect(epicOf(subTask, lookup)).toBe("E-2");
  expect(epicOf(billing, lookup)).toBe("E-2");
  expect(epicOf(loose, lookup)).toBeUndefined();
  // An epic's own parent is an initiative, which sits above projects.
  expect(epicOf(initiative, lookup)).toBeUndefined();
  // A parent the mirror doesn't hold counts by the level Jira sent with it.
  expect(epicOf(issue("E-20", { parent: "E-99", parentLevel: 1 }), lookup)).toBe("E-99");
  expect(epicOf(issue("E-21", { parent: "E-99", parentLevel: 0 }), lookup)).toBeUndefined();
});

test("Project filter: an epic matches its issues, No project means no epic, and the Jira project never matches", () => {
  const matching = (r: Rule) => all.filter((i) => matchesRule(i, r, all, "me")).map((i) => i.key);
  expect(matching(rule(["E-2"]))).toEqual(["E-2", "E-10", "E-11"]);
  // "No epic" was always empty when it meant the Jira project; now it is the issues with no epic.
  expect(matching(rule(["$none"]))).toEqual(["E-1", "E-12"]);
  expect(matching(rule(["E"]))).toEqual([]);
  expect(matching(rule([], "empty"))).toEqual(["E-1", "E-12"]);
});

test("Project properties read the epic's own fields", () => {
  const epic = issue("P-1", {
    type: "Epic",
    status: "done",
    priority: "High",
    labels: ["roadmap"],
    assignee: { id: "lead", name: "Lead" },
  });
  const child = issue("P-2", { parent: "P-1", priority: "Low", labels: ["ui"], assignee: { id: "dev", name: "Dev" } });
  const issues = [epic, child];
  const is = (field: Rule["field"], value: string) =>
    matchesRule(child, { id: "r", field, op: "is", values: [value] }, issues, "me");
  expect([is("projectStatus", "done"), is("projectStatus", "todo")]).toEqual([true, false]);
  expect([is("projectPriority", "High"), is("projectPriority", "Low")]).toEqual([true, false]);
  expect([is("projectLabels", "roadmap"), is("projectLabels", "ui")]).toEqual([true, false]);
  expect([is("projectLead", "lead"), is("projectLead", "dev")]).toEqual([true, false]);
  expect(matchesRule(issue("P-3"), { id: "r", field: "projectLead", op: "empty", values: [] }, issues, "me")).toBe(true);
});

test("project picker: the board's epics in the issue's Jira project, completed ones only when current or searched", () => {
  const other = issue("O-1", { type: "Epic", summary: "Other project", project: { key: "O", name: "Other" } });
  const names = (options: Parameters<typeof epicChoices>[2]) =>
    epicChoices([...all, other], board, options).map((e) => e.name);
  expect(names({ project: "E" })).toEqual(["Billing"]);
  expect(names({ project: "E", current: "E-3" })).toEqual(["Billing", "Archive"]);
  // Linear shows a completed project once the search is longer than two characters.
  expect(names({ project: "E", query: "ar" })).toEqual(["Billing"]);
  expect(names({ project: "E", query: "arc" })).toEqual(["Billing", "Archive"]);
  // An epic the mirror doesn't hold still shows as the current one, by its key.
  expect(epicChoices(all, board, { project: "E", current: "E-99" })[0]).toEqual({ key: "E-99", name: "E-99", done: false });
});

test("project picker: the epics a view's filter names come first, in its order, done or not (zBn's secondary)", () => {
  const names = (suggested: string[]) => epicChoices(all, board, { project: "E", suggested }).map((e) => e.name);
  const late = issue("E-4", { type: "Epic", summary: "Zebra" });
  expect(epicChoices([...all, late], board, { project: "E", suggested: ["E-4"] }).map((e) => e.name)).toEqual(["Zebra", "Billing"]);
  expect(names(["E-3"])).toEqual(["Archive", "Billing"]);
  expect(names(["E-3", "E-2"])).toEqual(["Archive", "Billing"]);
  expect(names(["E-2", "E-3"])).toEqual(["Billing", "Archive"]);
});

test("setting a project writes only the Jira parent; the Jira project is never sent", () => {
  expect(epicPatch("E-2")).toEqual({ parent: "E-2" });
  expect(epicPatch(null)).toEqual({ parent: undefined });
  const sent = (before: Issue, after: Issue) => opsFor({ issue: before }, { issue: after }, new Map());
  expect(sent(loose, { ...loose, ...epicPatch("E-2") })).toEqual([{ op: "fields", fields: { parent: "E-2" } }]);
  expect(sent(inBilling, { ...inBilling, ...epicPatch(null) })).toEqual([{ op: "fields", fields: { parent: null } }]);
  // Creating in a project group files the issue under that epic, in the board's Jira project.
  expect(draftForGroup("project", "E-2", board, all, "all")).toEqual({ parent: "E-2" });
  expect(draftForGroup("project", "$none", board, all, "all")).toEqual({});
});

test("only a standard issue picks its project: an epic is one, a sub-issue follows its parent", () => {
  expect(epicLocked(loose)).toBeUndefined();
  expect(epicLocked(billing)).toContain("epic");
  expect(epicLocked(subTask)).toContain("parent");
  expect(epicLocked(initiative)).toContain("Initiatives");
});

test("grouping by project: one group per epic, named by its title, the epic with its issues, then No epic", () => {
  expect(buckets(all, "project", board).map((b) => [b.name, b.issues.map((i) => i.key)])).toEqual([
    ["Archive", ["E-3"]],
    ["Billing", ["E-2", "E-10", "E-11"]],
    ["No epic", ["E-1", "E-12"]],
  ]);
  // A lane's issues don't hold their epic: the board's issues name it.
  expect(buckets([subTask], "project", board, [subTask], [], lookup).map((b) => b.name)).toEqual(["Billing"]);
});

// BJ-247: an epic parent is the issue's Project, never its Parent; Parent is a parent issue only, as in Linear, where `issue.parent`
// and `issue.project` are separate fields and Set parent issue (`hFn`, `mFn`) never touches the project.
test("Parent is a parent issue only: an epic or initiative parent is never one", () => {
  expect(parentOf(inBilling, lookup)).toBeUndefined();
  expect(parentOf(subTask, lookup)).toBe("E-10");
  // An epic's own parent is its initiative, which sits above projects.
  expect(parentOf(billing, lookup)).toBeUndefined();
  expect(parentOf(loose, lookup)).toBeUndefined();
  // A parent the mirror doesn't hold counts by the level Jira sent with it; with none, it stays a parent.
  expect(parentOf(issue("E-20", { parent: "E-99", parentLevel: 1 }), lookup)).toBeUndefined();
  expect(parentOf(issue("E-21", { type: "Sub-task", parent: "E-98", parentLevel: 0 }), lookup)).toBe("E-98");
  expect(parentOf(issue("E-22", { parent: "E-97" }), lookup)).toBe("E-97");
});

test("only issues below epics nest: no epic or initiative is a parent issue or a sub-issue", () => {
  expect(canNest(inBilling, subTask)).toBe(true);
  expect(canNest(loose, inBilling)).toBe(true);
  expect(canNest(billing, inBilling)).toBe(false);
  expect(canNest(initiative, billing)).toBe(false);
  expect(canNest(loose, billing)).toBe(false);
});

// Local mode (no Jira levels) lets a Task have a Task parent; one parent field holds either the epic or that parent issue.
const parentTask = issue("E-30", { parent: "E-2" });
const childTask = issue("E-31", { parent: "E-30" });
const local = [...all, parentTask, childTask];
test("a sub-issue is in its parent's project, so setting its project would take its parent issue away", () => {
  const find = lookupIn(local);
  expect(epicOf(childTask, find)).toBe("E-2");
  expect(epicLocked(childTask, find)).toContain("parent");
  // Its parent issue is a standard issue in an epic, which still picks its project.
  expect(epicLocked(parentTask, find)).toBeUndefined();
  expect(epicLocked(inBilling, lookup)).toBeUndefined();
});

test("the Parent filter and Relations never take an epic for a parent", () => {
  const matching = (r: Rule) => all.filter((i) => matchesRule(i, r, all, "me")).map((i) => i.key);
  const parentRule = (values: string[]): Rule => ({ id: "p", field: "parent", op: "is", values });
  const relations = (values: string[]): Rule => ({ id: "r", field: "relations", op: "is", values });
  expect(matching(parentRule(["E-2"]))).toEqual([]);
  expect(matching(parentRule(["E-10"]))).toEqual(["E-11"]);
  expect(matching(parentRule(["$none"]))).toEqual(["E-1", "E-2", "E-3", "E-10", "E-12"]);
  // Linear's Relations › Sub-issues and Parent issues: the epic and the initiative are neither.
  expect(matching(relations(["child"]))).toEqual(["E-11"]);
  expect(matching(relations(["parent"]))).toEqual(["E-10"]);
});

test("grouping by parent: an issue in an epic is in No parent, never in a group named by its epic", () => {
  expect(buckets(all, "parent", board).map((b) => [b.id, b.issues.map((i) => i.key)])).toEqual([
    ["E-10", ["E-11"]],
    ["$none", ["E-1", "E-2", "E-3", "E-10", "E-12"]],
  ]);
});

test("Show sub-issues off hides sub-issues only, never an epic's issues", () => {
  const prefs = defaultPreferences();
  prefs.display.subIssues = false;
  prefs.display.completedIssues = "all";
  prefs.scope = "all";
  expect(selectIssues(all, board, prefs, false, "", "me").map((i) => i.key).sort()).toEqual(["E-1", "E-10", "E-12", "E-2", "E-3"]);
});

test("nested lists nest sub-issues under their parent issue, never an epic's issues under the epic", () => {
  const rows = listRows(all, all, "all").map((r) => [r.issue.key, r.depth]);
  expect(rows).toContainEqual(["E-10", 0]);
  expect(rows).toContainEqual(["E-11", 1]);
  expect(rows).toContainEqual(["E-2", 0]);
});

// BJ-280: the user's deviation from Linear (.raj/done.md): an epic's page lists its issues in its Sub-issues section, as Jira's
// epic page lists its child work items. On the child the epic stays its Epic only (parentOf above), never its Parent.
test("BJ-280: an epic's Sub-issues section lists its issues; a sub-task stays under its parent; an initiative lists none", () => {
  // The epic's own issue, in its space or another Jira project.
  expect(listedUnder(inBilling, lookup)).toBe("E-2");
  expect(listedUnder(issue("X-1", { parent: "E-2", project: { key: "X", name: "Other" } }), lookup)).toBe("E-2");
  // A sub-task nests under its own parent, never flat on the epic.
  expect(listedUnder(subTask, lookup)).toBe("E-10");
  expect(listedUnder(childTask, lookupIn(local))).toBe("E-30");
  // An epic under an initiative isn't listed: initiatives sit above epics.
  expect(listedUnder(billing, lookup)).toBeUndefined();
  expect(listedUnder(loose, lookup)).toBeUndefined();
  // A parent the mirror doesn't hold counts by the level Jira sent: an epic lists, an initiative doesn't.
  expect(listedUnder(issue("E-20", { parent: "E-99", parentLevel: 1 }), lookup)).toBe("E-99");
  expect(listedUnder(issue("E-23", { type: "Epic", parent: "E-96", parentLevel: 2 }), lookup)).toBeUndefined();
  // Still never a Parent: the duplicate BJ-247 fixed stays fixed.
  expect(parentOf(inBilling, lookup)).toBeUndefined();
  expect([initiative, billing, inBilling, subTask].map(listsSubIssues)).toEqual([false, true, true, true]);
});

// BJ-289: the user's deviation from Linear (.raj/done.md): the "Sub-issue of" line under the title names the parent Task, else the
// epic, so an issue in an epic points back to the epic whose Sub-issues section lists it (BJ-280). Parent itself stays epic-free.
test("BJ-289: the title line names the parent Task first, else the epic; an epic or an orphan names none", () => {
  // A Subtask names its Task, never the epic above it.
  expect(titleParentOf(subTask, lookup)).toBe("E-10");
  // A Task in an epic with no parent Task names the epic.
  expect(titleParentOf(inBilling, lookup)).toBe("E-2");
  expect(titleParentOf(issue("E-20", { parent: "E-99", parentLevel: 1 }), lookup)).toBe("E-99");
  // An epic names neither its initiative nor a parent Jira sent without a level; an orphan names nothing.
  expect(titleParentOf(billing, lookup)).toBeUndefined();
  expect(titleParentOf(issue("E-24", { type: "Epic", parent: "E-95" }), lookup)).toBeUndefined();
  expect(titleParentOf(initiative, lookup)).toBeUndefined();
  expect(titleParentOf(loose, lookup)).toBeUndefined();
  // The Parent stays the Task alone: the BJ-247 duplicate stays fixed.
  expect(parentOf(inBilling, lookup)).toBeUndefined();
});

test("BJ-280: adding from an epic's section puts the new issue in the epic as the Epic picker does", () => {
  expect(subIssueParent(billing)).toEqual(epicPatch("E-2"));
  expect(epicOf({ ...issue("NEW"), ...subIssueParent(billing) }, lookup)).toBe("E-2");
  expect(parentOf({ ...issue("NEW"), ...subIssueParent(billing) }, lookup)).toBeUndefined();
  // Under a parent issue it is that issue's sub-issue.
  expect(subIssueParent(inBilling)).toEqual({ parent: "E-10" });
});

test("BJ-262: a parent change that sets the epic is an epic change in Activity; a sub-task's parent stays a parent", () => {
  const change = (before: string | null, after: string | null): PropertyActivity => ({
    id: "1",
    field: "parent",
    before,
    after,
    actor: { id: "a", name: "A" },
    at: "2026-11-01T00:00:00Z",
  });
  const fields = (events: readonly PropertyActivity[]) => events.map((e) => e.field);
  // The mirror holds the epic: its level says so.
  expect(fields(epicChanges([change(null, "E-2")], inBilling, lookup))).toEqual(["epic"]);
  expect(fields(epicChanges([change("E-2", "E-3")], inBilling, lookup))).toEqual(["epic"]);
  expect(fields(epicChanges([change("E-2", null)], inBilling, lookup))).toEqual(["epic"]);
  // An epic the mirror doesn't hold: a standard issue's Jira parent is always an epic.
  expect(fields(epicChanges([change(null, "OTHER-1")], loose, lookup))).toEqual(["epic"]);
  // A sub-task's parent is its parent issue, and so is a held standard parent; an epic's parent is its initiative.
  expect(fields(epicChanges([change(null, "OTHER-1")], subTask, lookup))).toEqual(["parent"]);
  expect(fields(epicChanges([change(null, "E-10")], subTask, lookup))).toEqual(["parent"]);
  expect(fields(epicChanges([change(null, "E-1")], billing, lookup))).toEqual(["parent"]);
  // Nothing to relabel keeps the array, so memoised Activity rows stay put.
  const none = [change(null, "E-10")];
  expect(epicChanges(none, subTask, lookup)).toBe(none);
});

test("BJ-262: the epic's read-only reasons say epic, never project", () => {
  expect(epicLocked(billing)).toBe("An epic can't be added to another epic in Jira.");
  expect(epicLocked(initiative)).toBe("Initiatives sit above epics.");
  expect(epicLocked(subTask)).toBe("A sub-issue is in its parent's epic.");
});
