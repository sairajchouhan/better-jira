import { expect, test } from "bun:test";
import { type Board, type Issue } from "@/shared/issue-model";
import { subIssueDefaults } from "./sub-issue-draft";

test("R3-create-D10: a new inline sub-issue starts at its parent's priority, as Linear's Issue.create does", () => {
  const board: Board = { id: 1, name: "B", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] };
  const parent = { key: "P-1", board: 1, priority: "High", project: { key: "P", name: "P" } } as Issue;
  expect(subIssueDefaults(parent, board)).toMatchObject({ parent: "P-1", priority: "High", project: { key: "P" }, status: "todo" });
  expect(subIssueDefaults({ ...parent, priority: undefined }, board).priority).toBeUndefined();
});
