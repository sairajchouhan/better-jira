import { expect, test } from "bun:test";
import type { Issue } from "./store";
import { defaultSubIssueDisplay, subIssueRows } from "./sub-issue-model";
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
