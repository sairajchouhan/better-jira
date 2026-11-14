import { expect, test } from "bun:test";
import { type Board, type Issue } from "@/shared/issue-model";
import { nextSubIssueProperties, subIssueDefaults, subIssueStatus } from "./sub-issue-draft";
import { ME } from "@/client/state/store";

test("R3-create-D10: a new inline sub-issue starts at its parent's priority, as Linear's Issue.create does", () => {
  const board: Board = { id: 1, name: "B", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] };
  const parent = { key: "P-1", board: 1, priority: "High", project: { key: "P", name: "P" } } as Issue;
  expect(subIssueDefaults(parent, board)).toMatchObject({ parent: "P-1", priority: "High", project: { key: "P" }, status: "todo" });
  expect(subIssueDefaults({ ...parent, priority: undefined }, board).priority).toBeUndefined();
});

test("R3 G13: a new sub-issue takes the parent's assignee only when it is you, or every existing sub-issue has it (Linear's w2.create)", () => {
  const board: Board = { id: 1, name: "B", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] };
  const ann = { id: "ann", name: "Ann" },
    bob = { id: "bob", name: "Bob" };
  const parent = { key: "P-1", board: 1, assignee: ann } as Issue;
  const child = (assignee: typeof ann | null) => ({ key: "P-2", board: 1, parent: "P-1", assignee }) as Issue;
  expect(subIssueDefaults(parent, board).assignee).toBeNull();
  expect(subIssueDefaults(parent, board, [child(ann), child(ann)]).assignee).toEqual(ann);
  expect(subIssueDefaults(parent, board, [child(ann), child(bob)]).assignee).toBeNull();
  expect(subIssueDefaults({ ...parent, assignee: null }, board, [child(null)]).assignee).toBeNull();
  const id = ME.id;
  try {
    ME.id = "ann";
    expect(subIssueDefaults(parent, board, [child(bob)]).assignee).toEqual(ann);
  } finally {
    ME.id = id;
  }
});

test("R3 G13: ⌘↵ starts the next sub-issue from the one just created, ⌘⇧↵ from the defaults (Linear's sub-issue composer)", () => {
  const defaults = { parent: "P-1", status: "todo", priority: "Low", assignee: null, labels: [], due: undefined };
  const created = { ...defaults, status: "doing", priority: "High", assignee: { id: "ann", name: "Ann" }, labels: ["ui"], due: "2026-12-01" };
  expect(nextSubIssueProperties(created, defaults, false)).toEqual({
    ...defaults,
    status: "doing",
    priority: "High",
    assignee: { id: "ann", name: "Ann" },
    labels: ["ui"],
  });
  expect(nextSubIssueProperties(created, defaults, true)).toEqual(defaults);
});

test("R3 G14: a new sub-issue's status follows the parent's state type, as Linear's w2.create", () => {
  const board: Board = {
    id: 1,
    name: "B",
    columns: [
      { name: "Backlog", statuses: [{ id: "backlog", name: "Backlog", category: "new" }] },
      { name: "Todo", statuses: [{ id: "todo", name: "To Do", category: "new" }] },
      { name: "Doing", statuses: [{ id: "doing", name: "In Progress", category: "indeterminate" }] },
      { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }, { id: "wont", name: "Won't Do", category: "done" }] },
    ],
  };
  const under = (status: string) => subIssueStatus({ status }, board);
  // started, unstarted, completed → the default unstarted state
  expect(["todo", "doing", "done"].map(under)).toEqual(["todo", "todo", "todo"]);
  // backlog, canceled → the default backlog state
  expect(under("backlog")).toBe("backlog");
  expect(under("wont")).toBe("backlog");
  // no backlog state on the board: the unstarted default
  const noBacklog = { ...board, columns: board.columns.slice(1) };
  expect(subIssueStatus({ status: "wont" }, noBacklog)).toBe("todo");
  expect(subIssueDefaults({ key: "P-1", board: 1, status: "backlog" } as Issue, board).status).toBe("backlog");
});
