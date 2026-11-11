import { expect, test } from "bun:test";
import { assignableUsers, knownLabels, statusById, statuses } from "./board-catalog";
import type { Board, Issue, User } from "./store";

const board: Board = {
  id: 1,
  name: "Board",
  columns: [
    { name: "To do", statuses: [{ id: "1", name: "Todo", category: "new" }] },
    { name: "Done", statuses: [{ id: "3", name: "Done", category: "done" }] },
  ],
} as Board;
const issue = (key: string, assignee: User | null, labels: string[] = [], on = 1): Issue =>
  ({ key, board: on, summary: key, status: "1", assignee, labels }) as Issue;

test("statuses come in column order and resolve by id", () => {
  expect(statuses(board).map((s) => s.id)).toEqual(["1", "3"]);
  expect(statusById(board, "3")?.name).toBe("Done");
  expect(statusById(undefined, "3")).toBeUndefined();
});

test("Create and Assign offer the same people: you, Jira's users and every assignee, by name", () => {
  const me = { id: "me", name: "Zed" };
  const jira = [{ id: "j", name: "Jo" }, me];
  const issues = [issue("A-1", { id: "b", name: "Bea" }), issue("B-1", { id: "o", name: "Al" }, [], 2)];
  // Both pickers call useAssignableUsers, which is this rule over the whole mirror.
  expect(assignableUsers(me, jira, issues).map((u) => u.id)).toEqual(["me", "o", "b", "j"]);
});

test("known labels: the issues' labels first, then Jira's, each once", () => {
  expect(knownLabels([issue("A-1", null, ["b", "a"])], ["a", "c"])).toEqual(["b", "a", "c"]);
});
