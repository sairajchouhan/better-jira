import { type Board, type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { epicChoices, epicLocked, epicOf, epicPatch, hierarchyLevel, lookupIn } from "./epics";
import { buckets, draftForGroup, matchesRule, type Rule } from "./view-model";
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
  // "No project" was always empty when it meant the Jira project; now it is the issues with no epic.
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

test("grouping by project: one group per epic, named by its title, the epic with its issues, then No project", () => {
  expect(buckets(all, "project", board).map((b) => [b.name, b.issues.map((i) => i.key)])).toEqual([
    ["Archive", ["E-3"]],
    ["Billing", ["E-2", "E-10", "E-11"]],
    ["No project", ["E-1", "E-12"]],
  ]);
  // A lane's issues don't hold their epic: the board's issues name it.
  expect(buckets([subTask], "project", board, [subTask], [], lookup).map((b) => b.name)).toEqual(["Billing"]);
});
