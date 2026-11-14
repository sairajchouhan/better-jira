import { type Board, type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";

import { ORDERINGS, PROPERTIES } from "@/shared/view-model";
import {
  defaultSubIssueDisplay,
  SUB_ISSUE_ORDERINGS,
  SUB_ISSUE_PROPERTIES,
  movedOrder,
  withMoveEntry,
  subIssueRows,
  childrenByParent,
  statusOf,
  subIssueCount,
  PARENT_LINE,
  childrenVariant,
} from "./sub-issue-model";
const issue = (key: string, parent?: string, status = "todo", rank = ""): Issue => ({
  key,
  parent,
  status,
  rank,
  board: 1,
  summary: key,
  labels: [],
  assignee: null,
  comments: 0,
  updated: "2026-11-07T00:00:00Z",
  resolved: status === "done" ? "2026-11-07T00:00:00Z" : null,
});
const status = (i: Issue) => ({
  category: i.status === "done" ? "done" : "new",
  order: i.status === "done" ? 1 : 0,
});
const all = [
  issue("ROOT"),
  issue("DONE", "ROOT", "done"),
  issue("CHILD-1", "DONE"),
  issue("CHILD-2", "DONE"),
];
test("completion recency uses real day, week and month cutoffs", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const children = [0.5, 3, 14, 45].map((days, index) => ({
    ...issue(`DONE-${index}`, "ROOT", "done"),
    resolved: new Date(now - days * 86400000).toISOString(),
  }));
  for (const [completed, count] of [
    ["day", 1],
    ["week", 2],
    ["month", 3],
  ] as const) {
    const result = subIssueRows(
      "ROOT",
      children,
      { ...defaultSubIssueDisplay(), completed },
      status,
      now,
    );
    expect(result.rows).toHaveLength(count);
    expect(result.hiddenCompleted).toBe(4 - count);
  }
});
test("measured Linear progress changes from 1/3 to 1/1 with nesting off", () => {
  const prefs = defaultSubIssueDisplay();
  expect(subIssueRows("ROOT", all, prefs, status)).toMatchObject({ total: 3, completed: 1 });
  expect(subIssueRows("ROOT", all, { ...prefs, nested: false }, status)).toMatchObject({
    total: 1,
    completed: 1,
  });
});
test("completed None retains context for incomplete descendants and reveal does not alter the saved preference", () => {
  const prefs = { ...defaultSubIssueDisplay(), completed: "none" as const };
  const result = subIssueRows("ROOT", all, prefs, status);
  expect(result.rows.map((r) => [r.issue.key, r.depth, r.contextOnly])).toEqual([
    ["DONE", 0, true],
    ["CHILD-1", 1, false],
    ["CHILD-2", 1, false],
  ]);
  expect(result.hiddenCompleted).toBe(1);
  expect(subIssueRows("ROOT", all, { ...prefs, nested: false }, status).rows).toHaveLength(0);
  expect(
    subIssueRows("ROOT", all, { ...prefs, nested: false }, status, Date.now(), true).rows.map(
      (r) => r.issue.key,
    ),
  ).toEqual(["DONE"]);
  expect(prefs.completed).toBe("none");
});
test("orders siblings without flattening the tree and handles a malformed cycle once", () => {
  const prefs = { ...defaultSubIssueDisplay(), ordering: "title" as const };
  const result = subIssueRows("ROOT", [issue("ROOT", "CHILD-1"), ...all.slice(1)], prefs, status);
  expect(result.rows.map((r) => r.issue.key)).toEqual(["DONE", "CHILD-1", "CHILD-2"]);
  const reversed = [issue("SECOND", "ROOT", "todo", "b"), issue("FIRST", "ROOT", "todo", "a")];
  expect(
    subIssueRows("ROOT", reversed, defaultSubIssueDisplay(), status).rows.map((r) => r.issue.key),
  ).toEqual(["FIRST", "SECOND"]);
});
test("a sub-issue draft keeps its labels and drops malformed ones across reloads", async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  });
  const { emptySubIssueDraft, readSubIssueDraft, saveSubIssueDraft } =
    await import("./sub-issue-draft");
  const initial = { labels: ["inherited"] };
  saveSubIssueDraft("draft", {
    ...emptySubIssueDraft(initial),
    title: "Child",
    properties: { labels: ["ui", "test"] },
  });
  expect(readSubIssueDraft("draft", initial).properties.labels).toEqual(["ui", "test"]);
  storage.set("draft", JSON.stringify({ title: "Child", properties: { labels: ["ui", 3] } }));
  expect(readSubIssueDraft("draft", initial).properties.labels).toEqual(["inherited"]);
});

test("children index is shared by snapshot identity and never reordered by a view", async () => {
  const { childrenByParent } = await import("./sub-issue-model");
  const second = issue("SECOND", "ROOT", "todo", "b"), first = issue("FIRST", "ROOT", "todo", "a");
  const snapshot = new Map([second, first, issue("ROOT")].map((i) => [i.key, i]));
  const index = childrenByParent(snapshot);
  expect(childrenByParent(snapshot)).toBe(index);
  expect([...index.keys()]).toEqual(["ROOT"]);
  expect(index.get("ROOT")).toEqual([second, first]);
  expect(subIssueRows("ROOT", snapshot, defaultSubIssueDisplay(), status).rows.map((r) => r.issue.key)).toEqual(["FIRST", "SECOND"]);
  expect(index.get("ROOT")).toEqual([second, first]);
  const next = new Map(snapshot).set("FIRST", { ...first, parent: "SECOND" });
  expect(childrenByParent(next)).not.toBe(index);
  expect(childrenByParent(next).get("ROOT")).toEqual([second]);
  expect(childrenByParent(next).get("SECOND")?.map((i) => i.key)).toEqual(["FIRST"]);
});

test("BJ-50: local manual order takes precedence over Jira rank without flattening the tree", () => {
  const issues = [issue("P"), issue("A", "P", "todo", "a"), issue("B", "P", "todo", "b"), issue("C", "A")];
  const rows = subIssueRows("P", issues, defaultSubIssueDisplay(), status, Date.now(), false, ["B", "A"]);
  expect(rows.rows.map(row => [row.issue.key, row.depth])).toEqual([["B", 0], ["A", 0], ["C", 1]]);
  expect(issues[1]!.rank).toBe("a");
});

test("sub-issue menus use Linear's labels from the board's shared tables (BJ-215)", () => {
  const label = (rows: [string, string][], id: string) => rows.find(([key]) => key === id)?.[1];
  // Linear: ordering spec linkCount → "Link count"; sub-issue display property fieldLinkCount → "Links".
  expect(label(SUB_ISSUE_ORDERINGS, "links")).toBe("Link count");
  expect(label(SUB_ISSUE_PROPERTIES, "links")).toBe("Links");
  for (const [id, text] of SUB_ISSUE_ORDERINGS) expect(label(ORDERINGS, id)).toBe(text);
  for (const [id, text] of SUB_ISSUE_PROPERTIES) expect(label(PROPERTIES, id)).toBe(text);
});

test("R3-relations-D4: Linear's Move… sub-actions and a drop reorder one parent's sub-issues", () => {
  const order = ["A", "B", "C", "D"];
  expect(movedOrder(order, "C", "up")).toEqual(["A", "C", "B", "D"]);
  expect(movedOrder(order, "B", "down")).toEqual(["A", "C", "B", "D"]);
  expect(movedOrder(order, "C", "top")).toEqual(["C", "A", "B", "D"]);
  expect(movedOrder(order, "B", "bottom")).toEqual(["A", "C", "D", "B"]);
  // Dropped before D (index 2 among the others).
  expect(movedOrder(order, "A", { to: 2 })).toEqual(["B", "C", "A", "D"]);
  // Already there: nothing to save.
  expect(movedOrder(order, "A", "up")).toBeNull();
  expect(movedOrder(order, "D", "bottom")).toBeNull();
});

test("Move… sits in the Copy group right after Make a copy…, as Linear's issue menu (startup-root aAr) lists Lvr", () => {
  const names = (list: { name: string }[]) => list.map((entry) => entry.name);
  const menu = ["Status", "Copy", "Make a copy…", "Favorite", "Remind me", "Delete"].map((name) => ({ name }));
  expect(names(withMoveEntry(menu, { name: "Move…" }))).toEqual(["Status", "Copy", "Make a copy…", "Move…", "Favorite", "Remind me", "Delete"]);
  expect(names(withMoveEntry([{ name: "Status" }, { name: "Delete" }], { name: "Move…" }))).toEqual(["Status", "Move…", "Delete"]);
});

test("BJ-280: an epic's section lists its issues as Jira's epic page does, each sub-task nested under its own parent", () => {
  const initiative = { ...issue("INIT"), type: "Initiative" };
  const epic = { ...issue("EPIC", "INIT"), type: "Epic" };
  const task = { ...issue("TASK", "EPIC"), type: "Task" };
  const done = { ...issue("DONE", "EPIC", "done"), type: "Bug" };
  const sub = { ...issue("SUB", "TASK"), type: "Sub-task" };
  // A Jira parent the mirror doesn't hold, sent as an epic (level 1).
  const outside = { ...issue("OUT", "EPIC-9"), parentLevel: 1 };
  const byKey = new Map([initiative, epic, task, done, sub, outside].map((i) => [i.key, i]));
  expect(childrenByParent(byKey).get("EPIC")?.map((i) => i.key)).toEqual(["TASK", "DONE"]);
  expect(childrenByParent(byKey).get("EPIC-9")?.map((i) => i.key)).toEqual(["OUT"]);
  expect(childrenByParent(byKey).get("TASK")?.map((i) => i.key)).toEqual(["SUB"]);
  // An initiative sits above epics: its epics aren't sub-issues.
  expect(childrenByParent(byKey).get("INIT")).toBeUndefined();
  const model = subIssueRows("EPIC", byKey, defaultSubIssueDisplay(), status);
  expect(model.rows.map((r) => [r.issue.key, r.depth])).toEqual([["DONE", 0], ["TASK", 0], ["SUB", 1]]);
  // The progress counts the epic's own issues, as any parent's counts its children.
  expect([model.completed, model.total]).toEqual([1, 3]);
  expect(subIssueRows("TASK", byKey, defaultSubIssueDisplay(), status).rows.map((r) => r.issue.key)).toEqual(["SUB"]);
});

test("BJ-281: the sub-issue badge counts what the Sub-issues section lists: a parent's sub-issues, an epic's issues, done by status", () => {
  const boards: Board[] = [
    {
      id: 1,
      name: "Board",
      columns: [
        { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
        { name: "Doing", statuses: [{ id: "doing", name: "Doing", category: "indeterminate" }] },
        { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
      ],
    },
  ];
  const epic = { ...issue("EPIC"), type: "Epic" };
  const task = { ...issue("TASK", "EPIC", "doing"), type: "Task" };
  const bug = { ...issue("BUG", "EPIC", "done"), type: "Bug" };
  const subDone = { ...issue("SUB-1", "TASK", "done"), type: "Sub-task" };
  const subOpen = { ...issue("SUB-2", "TASK"), type: "Sub-task" };
  const lone = issue("LONE");
  const byKey = new Map([epic, task, bug, subDone, subOpen, lone].map((i) => [i.key, i]));
  // A card counts the direct sub-issues (Linear `wd`: t.children); an epic's are its issues (BJ-280).
  expect(subIssueCount(byKey, boards, "EPIC", "children")).toEqual({ done: 1, total: 2 });
  expect(subIssueCount(byKey, boards, "TASK", "children")).toEqual({ done: 1, total: 2 });
  // A row counts every level below (Linear `at`: t.descendants); "in progress" isn't done.
  expect(subIssueCount(byKey, boards, "EPIC", "descendants")).toEqual({ done: 2, total: 4 });
  // No sub-issues, no badge.
  expect(subIssueCount(byKey, boards, "LONE", "children")).toBeUndefined();
  expect(subIssueCount(byKey, boards, "SUB-1", "descendants")).toBeUndefined();
  // The same snapshot answers with the same object, so a store selector re-renders nothing; a new snapshot counts again.
  expect(subIssueCount(byKey, boards, "EPIC", "children")).toBe(subIssueCount(byKey, boards, "EPIC", "children")!);
  const next = new Map(byKey).set("TASK", { ...task, status: "done" });
  expect(subIssueCount(next, boards, "EPIC", "children")).toEqual({ done: 2, total: 2 });
  // The badge's count and the section's header agree.
  const model = subIssueRows("EPIC", byKey, defaultSubIssueDisplay(), (i) => statusOf(boards, i));
  expect(subIssueCount(byKey, boards, "EPIC", "descendants")).toEqual({ done: model.completed, total: model.total });
});

// BJ-289 follow-up: an issue in an epic is not a sub-issue (user's call). The title line and its ring menu say "Sub-issue of" and
// sub-issues for a parent Task only; for an epic they say "In epic" and its epic issues (Linear's "Open project issues", in Epic words).
test("BJ-289: the title line reads Sub-issue of for a parent Task and In epic for an epic, never Sub-issue of", () => {
  expect(PARENT_LINE["sub-issue"].label).toBe("Sub-issue of");
  expect(PARENT_LINE["sub-issue"].open("TEST-2")).toBe("Open sub-issues of TEST-2");
  expect(PARENT_LINE.epic.label).toBe("In epic");
  expect(PARENT_LINE.epic.open("TEST-7")).toBe("Open epic issues of TEST-7");
  const epicWords = [PARENT_LINE.epic.label, PARENT_LINE.epic.open("TEST-7")].join(" | ");
  expect(epicWords).not.toMatch(/sub-issue/i);
  // The ring menu words an epic's issues as epic issues wherever it opens (title line, epic card), a Task's as sub-issues.
  expect(childrenVariant({ type: "Epic" })).toBe("epic");
  expect(childrenVariant({ type: "Story", level: 1 })).toBe("epic");
  expect(childrenVariant({ type: "Task" })).toBe("sub-issue");
  expect(childrenVariant({ type: "Subtask" })).toBe("sub-issue");
});
