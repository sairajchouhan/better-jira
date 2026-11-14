import { expect, test } from "bun:test";
import { type Board, type Issue, type User } from "@/shared/issue-model";
import { createDefaults } from "./create-defaults";
import { lookupIn } from "./epics";
import { type FilterGroup, type Operator, type Rule } from "./view-model";

const board = {
  id: 1,
  name: "Board",
  columns: [
    { name: "Backlog", statuses: [{ id: "backlog", name: "Backlog", category: "new" }] },
    { name: "To do", statuses: [{ id: "todo", name: "To Do", category: "new" }] },
    { name: "Doing", statuses: [{ id: "doing", name: "Doing", category: "indeterminate" }] },
    { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
  ],
} as Board;
const me: User = { id: "me", name: "Me" },
  alex: User = { id: "alex", name: "Alex" },
  priya: User = { id: "priya", name: "Priya" };
// Made-up epics: E-1 and E-2 (done) are epics, E-3 a task.
const epic = (key: string, patch: Partial<Issue> = {}) =>
  ({ key, board: 1, summary: key, status: "todo", type: "Epic", assignee: null, labels: [], ...patch }) as Issue;
const issues = [epic("E-1"), epic("E-2", { status: "done" }), epic("E-3", { type: "Task" })];
const ctx = { board, people: [me, alex, priya], me, defaultStatus: "todo", lookup: lookupIn(issues) };
let n = 0;
const rule = (field: Rule["field"], op: Operator, ...values: string[]): Rule => ({ id: `r${n++}`, field, op, values });
const all = (...children: (Rule | FilterGroup)[]): FilterGroup => ({ id: `g${n++}`, join: "and", children });
const any = (...children: (Rule | FilterGroup)[]): FilterGroup => ({ id: `g${n++}`, join: "or", children });
const from = (f: FilterGroup, saved?: FilterGroup) => createDefaults(saved, f, ctx);

test("C on a \"label is api\" view creates with the api label; priority and assignee filters fill theirs", () => {
  expect(from(all(rule("labels", "is", "api")))).toEqual({ labels: ["api"] });
  expect(from(all(rule("priority", "is", "High")))).toEqual({ priority: "High" });
  expect(from(all(rule("assignee", "is", "alex")))).toEqual({ assignee: alex, suggestedAssignees: [alex] });
  expect(from(all(rule("assignee", "is", "$me")))).toEqual({ assignee: me, suggestedAssignees: [me] });
});

test("\"is not\" and empty-value filters set nothing", () => {
  expect(
    from(
      all(
        rule("labels", "isNot", "api"),
        rule("priority", "isNot", "High"),
        rule("assignee", "isNot", "alex"),
        rule("status", "isNot", "doing"),
        rule("labels", "empty"),
        rule("labels", "is"),
      ),
    ),
  ).toEqual({});
});

test("assignee and priority take a value only when the filter names exactly one (Linear's UZt, JZt)", () => {
  // "is any of" two people: no assignee, both offered under Suggested.
  expect(from(all(rule("assignee", "is", "alex", "priya")))).toEqual({ suggestedAssignees: [alex, priya] });
  expect(from(all(rule("priority", "is", "High", "Low")))).toEqual({});
  // Two rules for the same field add up to two values.
  expect(from(all(rule("priority", "is", "High"), rule("priority", "is", "Low")))).toEqual({});
  // "No assignee" never becomes an assignee; "No priority" counts as the one value and sets nothing.
  expect(from(all(rule("assignee", "is", "$none")))).toEqual({});
  expect(from(all(rule("priority", "is", "$none")))).toEqual({});
  // An account the app doesn't know is dropped before counting.
  expect(from(all(rule("assignee", "is", "ghost")))).toEqual({});
});

test("labels take every label the filter requires, up to six; \"is any of\" several requires none", () => {
  expect(from(all(rule("labels", "isAll", "api", "ui")))).toEqual({ labels: ["api", "ui"] });
  expect(from(all(rule("labels", "is", "api"), rule("labels", "is", "ui")))).toEqual({ labels: ["api", "ui"] });
  expect(from(all(rule("labels", "is", "api", "ui")))).toEqual({});
  expect(from(all(rule("labels", "isAll", "a", "b", "c", "d", "e", "f", "g")))).toEqual({
    labels: ["a", "b", "c", "d", "e", "f"],
  });
});

test("a top-level \"any\" filter is ambiguous for everything but status", () => {
  expect(from(any(rule("labels", "is", "api"), rule("priority", "is", "High")))).toEqual({});
  // An "any" group with one rule is as good as "all".
  expect(from(any(rule("labels", "is", "api")))).toEqual({ labels: ["api"] });
  expect(from(any(rule("status", "is", "doing"), rule("labels", "is", "api")))).toEqual({ status: "doing" });
  // A nested group's rules still count.
  expect(from(all(rule("priority", "is", "High"), all(rule("labels", "is", "api"))))).toEqual({
    priority: "High",
    labels: ["api"],
  });
});

test("status (Linear's VZt): the default status if the filter allows it, else the earliest open one", () => {
  expect(from(all(rule("status", "is", "doing")))).toEqual({ status: "doing" });
  expect(from(all(rule("status", "is", "doing", "todo")))).toEqual({ status: "todo" });
  expect(from(all(rule("status", "is", "doing", "backlog")))).toEqual({ status: "backlog" });
  expect(from(all(rule("status", "is", "done", "doing")))).toEqual({ status: "doing" });
  expect(from(all(rule("status", "is", "done")))).toEqual({ status: "done" });
  expect(from(all(rule("status", "is", "elsewhere")))).toEqual({});
  // The default status wins over an earlier one.
  expect(from(all(rule("status", "is", "backlog", "todo")))).toEqual({ status: "todo" });
  // A closed status never wins over an open one, even one later in the workflow.
  const rejectedFirst = {
    ...board,
    columns: [board.columns[0]!, { name: "Rejected", statuses: [{ id: "rejected", name: "Rejected", category: "done" }] }, board.columns[2]!],
  } as Board;
  expect(createDefaults(undefined, all(rule("status", "is", "doing", "rejected")), { ...ctx, board: rejectedFirst })).toEqual({
    status: "doing",
  });
});

test("a saved view's filter applies, and the view's own filter replaces it field by field", () => {
  const saved = all(rule("labels", "is", "api"), rule("assignee", "is", "alex"));
  expect(from(all(), saved)).toEqual({ labels: ["api"], assignee: alex, suggestedAssignees: [alex] });
  expect(from(all(rule("labels", "is", "ui")), saved)).toEqual({ labels: ["ui"], assignee: alex, suggestedAssignees: [alex] });
  // An overlay naming two people clears the saved view's one assignee, as Linear's {...view, ...panel} does.
  expect(from(all(rule("assignee", "is", "alex", "priya")), saved)).toEqual({
    labels: ["api"],
    suggestedAssignees: [alex, priya],
  });
});

test("project (Linear's GZt): a filter naming exactly one project sets the epic, the Jira parent", () => {
  expect(from(all(rule("project", "is", "E-1")))).toEqual({ parent: "E-1", suggestedEpics: ["E-1"] });
  // A done epic is still a project the filter names.
  expect(from(all(rule("project", "is", "E-2")))).toEqual({ parent: "E-2", suggestedEpics: ["E-2"] });
  expect(from(all(rule("project", "isNot", "E-1")))).toEqual({});
});

test("project: \"No project\" and keys that name no epic drop out before counting", () => {
  expect(from(all(rule("project", "is", "$none")))).toEqual({});
  expect(from(all(rule("project", "is", "E-3")))).toEqual({});
  expect(from(all(rule("project", "is", "ghost")))).toEqual({});
  // "Is any of" No project and an epic is ambiguous: no epic, but the epic is still listed first.
  expect(from(all(rule("project", "is", "$none", "E-1")))).toEqual({ suggestedEpics: ["E-1"] });
});

test("project: a filter naming several projects sets none and lists them first in the picker", () => {
  expect(from(all(rule("project", "is", "E-1", "E-2")))).toEqual({ suggestedEpics: ["E-1", "E-2"] });
  expect(from(all(rule("project", "is", "E-1"), rule("project", "is", "E-2")))).toEqual({ suggestedEpics: ["E-1", "E-2"] });
  expect(from(any(rule("project", "is", "E-1"), rule("labels", "is", "api")))).toEqual({ suggestedEpics: ["E-1"] });
});

test("project: a group's own values win, and a draft that can't join an epic takes none (epicLocked)", () => {
  const f = all(rule("project", "is", "E-1"));
  // Grouping by project: the group's epic wins; its "No project" group passes nothing, so the filter's stays.
  expect(createDefaults(undefined, f, ctx, { parent: "E-2" })).toEqual({ parent: "E-2", suggestedEpics: ["E-1"] });
  expect(createDefaults(undefined, f, ctx, {})).toEqual({ parent: "E-1", suggestedEpics: ["E-1"] });
  // An epic is a project, and a sub-task follows its parent: neither goes into the filter's epic.
  expect(createDefaults(undefined, f, ctx, { type: "Epic" })).toEqual({ type: "Epic", suggestedEpics: ["E-1"] });
  expect(createDefaults(undefined, f, ctx, { type: "Sub-task" })).toEqual({ type: "Sub-task", suggestedEpics: ["E-1"] });
  expect(createDefaults(undefined, f, ctx, { type: "Story" })).toEqual({ type: "Story", parent: "E-1", suggestedEpics: ["E-1"] });
});

test("project: the view's own project filter replaces the saved view's", () => {
  const saved = all(rule("project", "is", "E-1"));
  expect(from(all(), saved)).toEqual({ parent: "E-1", suggestedEpics: ["E-1"] });
  expect(from(all(rule("project", "is", "E-2")), saved)).toEqual({ parent: "E-2", suggestedEpics: ["E-2"] });
  expect(from(all(rule("project", "is", "E-1", "E-2")), saved)).toEqual({ suggestedEpics: ["E-1", "E-2"] });
});
