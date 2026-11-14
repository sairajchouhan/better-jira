import { type Issue } from "@/shared/issue-model";
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

test("BJ-247: an epic's issues are its project's, never its sub-issues; a parent issue's children are", () => {
  const epic = { ...issue("EPIC"), type: "Epic" };
  const task = { ...issue("TASK", "EPIC"), type: "Task" };
  const sub = { ...issue("SUB", "TASK"), type: "Sub-task" };
  // A Jira parent the mirror doesn't hold, sent as an epic (level 1).
  const outside = { ...issue("OUT", "EPIC-9"), parentLevel: 1 };
  const byKey = new Map([epic, task, sub, outside].map((i) => [i.key, i]));
  expect(childrenByParent(byKey).get("EPIC")).toBeUndefined();
  expect(childrenByParent(byKey).get("EPIC-9")).toBeUndefined();
  expect(childrenByParent(byKey).get("TASK")?.map((i) => i.key)).toEqual(["SUB"]);
  expect(subIssueRows("EPIC", byKey, defaultSubIssueDisplay(), status).total).toBe(0);
  expect(subIssueRows("TASK", byKey, defaultSubIssueDisplay(), status).rows.map((r) => r.issue.key)).toEqual(["SUB"]);
});
