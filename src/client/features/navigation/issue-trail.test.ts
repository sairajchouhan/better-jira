import { expect, test } from "bun:test";
import type { Board, Issue } from "@/shared/issue-model";
import { listPosition } from "@/shared/view-model";
import { issueCrumbs, nextTrail, stepIssues, type IssueCrumbs, type Trail } from "./issue-trail";

const boards: Board[] = [
  {
    id: 1,
    name: "Space",
    columns: [
      { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
      { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
    ],
  },
];
const issue = (key: string, patch: Partial<Issue> = {}): Issue => ({
  key,
  board: 1,
  summary: `${key} title`,
  status: "todo",
  type: "Task",
  assignee: null,
  labels: [],
  comments: 0,
  updated: "2026-11-01T10:00:00Z",
  resolved: null,
  ...patch,
});
// An epic with three tasks; the first task has three sub-tasks; a loose task in no epic.
const all = [
  issue("Q-1", { type: "Epic", summary: "Sync engine" }),
  issue("Q-2", { parent: "Q-1", rank: "a" }),
  issue("Q-3", { parent: "Q-1", rank: "b" }),
  issue("Q-4", { parent: "Q-1", rank: "c" }),
  issue("Q-5", { type: "Sub-task", parent: "Q-2", rank: "a" }),
  issue("Q-6", { type: "Sub-task", parent: "Q-2", rank: "b" }),
  issue("Q-7", { type: "Sub-task", parent: "Q-2", rank: "c" }),
  issue("Q-8"),
];
const issues = new Map(all.map((i) => [i.key, i]));
const crumbs = (key: string, trail: Trail | null) => issueCrumbs(issues.get(key)!, trail, issues, boards);
/** The chain as text: `Epic › KEY › KEY`, the epic by name (`[icon]` when compact). */
const chain = (c: IssueCrumbs) =>
  c.form === "list"
    ? "list"
    : [c.epic && (c.compactEpic ? `[${c.epic.name}]` : c.epic.name), ...c.parents.map((p) => p.issue.key)].filter(Boolean).join(" › ");
/** The counter `n / total`, or none. */
const counter = (key: string, c: IssueCrumbs | null, list: Issue[] = []) => {
  const p = listPosition(stepIssues(c, list), key);
  return p ? `${p.index + 1} / ${p.total}` : null;
};

test("form 1: a direct link or reload shows the issue's own epic and no counter (Linear's empty stack)", () => {
  expect(chain(crumbs("Q-3", null))).toBe("Sync engine");
  expect(crumbs("Q-3", null)).toMatchObject({ epic: { key: "Q-1", issue: { key: "Q-1" } }, parents: [] });
  // A sub-task's epic is its parent's (Jira's rule, epicOf), and still no parent crumb.
  expect(chain(crumbs("Q-6", null))).toBe("Sync engine");
  // No epic: only the issue; the epic itself has no crumb above it.
  expect(chain(crumbs("Q-8", null))).toBe("");
  expect(chain(crumbs("Q-1", null))).toBe("");
  expect(counter("Q-3", crumbs("Q-3", null), all)).toBeNull();
});

test("form 2: opened from the epic's Sub-issues list, `Epic › KEY` and the counter steps the epic's issues", () => {
  const c = crumbs("Q-3", { path: ["Q-1"] });
  expect(chain(c)).toBe("Sync engine");
  expect(c.form === "hierarchy" && c.siblings?.map((i) => i.key)).toEqual(["Q-2", "Q-3", "Q-4"]);
  expect(counter("Q-3", c)).toBe("2 / 3");
});

test("form 3: opened from a task's sub-issues, `Epic › Task › Sub-task` and the counter steps the task's sub-issues", () => {
  const fromTask = crumbs("Q-6", { path: ["Q-2"] });
  expect(chain(fromTask)).toBe("Sync engine › Q-2");
  expect(fromTask.form === "hierarchy" && fromTask.parents[0]!.trail).toBeNull();
  expect(counter("Q-6", fromTask)).toBe("2 / 3");
  // Through the epic first: the task crumb reopens the task with the trail that led to it.
  const throughEpic = crumbs("Q-7", { path: ["Q-1", "Q-2"] });
  expect(chain(throughEpic)).toBe("Sync engine › Q-2");
  expect(throughEpic.form === "hierarchy" && throughEpic.parents[0]!.trail).toEqual({ path: ["Q-1"] });
  expect(counter("Q-7", throughEpic)).toBe("3 / 3");
  // A task in no epic shows no epic crumb.
  const loose = new Map([...issues, ["Q-9", issue("Q-9", { type: "Sub-task", parent: "Q-8" })], ["Q-10", issue("Q-10", { type: "Sub-task", parent: "Q-8" })]]);
  expect(chain(issueCrumbs(loose.get("Q-9")!, { path: ["Q-8"] }, loose, boards))).toBe("Q-8");
});

test("form 4: opened from a list, the list's crumbs and its counter", () => {
  const c = crumbs("Q-3", "list");
  expect(c).toEqual({ form: "list" });
  expect(counter("Q-3", c, all)).toBe("3 / 8");
  // Beside a list (the side panel, no page crumbs) the list counts too.
  expect(counter("Q-3", null, all)).toBe("3 / 8");
});

test("a trail that no longer leads to the issue falls back to form 1", () => {
  // Q-6 isn't under Q-3; a cycle; a parent the mirror lost.
  for (const path of [["Q-3"], ["Q-2", "Q-2"], ["Q-99"]]) {
    const c = crumbs("Q-6", { path });
    expect(chain(c)).toBe("Sync engine");
    expect(counter("Q-6", c)).toBeNull();
  }
});

test("a long trail shows the epic as its icon and only the first and last parents (Linear's `Hpi` and `Dpi`)", () => {
  const deep = new Map([
    ...issues,
    ["Q-11", issue("Q-11", { parent: "Q-5" })],
    ["Q-12", issue("Q-12", { parent: "Q-11" })],
  ]);
  const c = issueCrumbs(deep.get("Q-12")!, { path: ["Q-2", "Q-5", "Q-11"] }, deep, boards);
  expect(chain(c)).toBe("[Sync engine] › Q-2 › Q-11");
});

const screen = (selected: string | null, trail: Trail | null = null, view = "page") => ({
  selected,
  panel: !!selected,
  view,
  document: null,
  trail,
});
test("the trail follows how the page was reached", () => {
  // From a list (or the side panel) to a page: over the list.
  expect(nextTrail(screen(null), screen("Q-3"))).toBe("list");
  expect(nextTrail(screen("Q-3", null, "side"), screen("Q-3"))).toBe("list");
  // The same page keeps its trail; another page, unnamed, starts afresh (Linear's model links reset).
  expect(nextTrail(screen("Q-3", { path: ["Q-1"] }), screen("Q-3"))).toEqual({ path: ["Q-1"] });
  expect(nextTrail(screen("Q-3", "list"), screen("Q-6"))).toBeNull();
  // From a Sub-issues section: extends the trail of the parent's page, else starts at the parent.
  expect(nextTrail(screen("Q-1"), screen("Q-2"), { parent: "Q-1" })).toEqual({ path: ["Q-1"] });
  expect(nextTrail(screen("Q-2", { path: ["Q-1"] }), screen("Q-6"), { parent: "Q-2" })).toEqual({ path: ["Q-1", "Q-2"] });
  expect(nextTrail(screen("Q-8", { path: ["Q-1"] }), screen("Q-6"), { parent: "Q-2" })).toEqual({ path: ["Q-2"] });
  // Named outright (↑/↓ keep it; ⌘K, toasts, links reset it); off a page there is none.
  expect(nextTrail(screen("Q-3", { path: ["Q-1"] }), screen("Q-4"), { path: ["Q-1"] })).toEqual({ path: ["Q-1"] });
  expect(nextTrail(screen("Q-3", "list"), screen("Q-4"), null)).toBeNull();
  expect(nextTrail(screen("Q-3", "list"), screen("Q-4", null, "side"))).toBeNull();
});
