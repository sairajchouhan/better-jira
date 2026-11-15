import { expect, test } from "bun:test";
import { type Issue } from "@/shared/issue-model";
import { opsFor, type Op } from "@/shared/jira-ops";
import { dropAll, dropPlan } from "./board-drop";

const card = (key: string, status: string, rank: string, assignee = "a"): Issue => ({
  key,
  boards: [1],
  summary: key,
  status,
  assignee: { id: assignee, name: assignee },
  labels: [],
  comments: 0,
  updated: "2026-11-01T00:00:00Z",
  resolved: null,
  rank,
});
// The fixture board's shape: Jira ranks the whole board across its columns. Todo holds 1, 2, 4, 5 and 6; Doing holds 3,
// ranked between 2 and 4; Review is empty. TEST-4 is someone else's (a swimlane by assignee splits it off).
const board = new Map(
  [
    card("TEST-1", "todo", "b"),
    card("TEST-2", "todo", "d"),
    card("TEST-3", "doing", "f"),
    card("TEST-4", "todo", "h", "b"),
    card("TEST-5", "todo", "j"),
    card("TEST-6", "todo", "l"),
  ].map((i) => [i.key, i]),
);
const manual = { manual: true, descending: false };
const cell = (...keys: string[]) => keys.map((k) => board.get(k)!);
const ranks = (map: ReadonlyMap<string, Issue>) =>
  [...map.values()].toSorted((a, b) => (a.rank! < b.rank! ? -1 : 1)).map((i) => i.key);

/** A drop as the board makes it (`dropPlan`, then actions.drop's status and rank), and the ops Jira gets for each card. */
function drop(shown: Issue[], keys: string[], before: string | undefined, status?: string, order = manual) {
  const plan = dropPlan(shown, keys, before, order, board);
  const after = new Map(board);
  for (const m of plan) {
    const was = after.get(m.key);
    if (!was) continue;
    after.set(m.key, {
      ...was,
      ...(status ? { status } : {}),
      ...(m.rank !== undefined ? { rank: m.rank, rankAnchor: m.rankAnchor } : {}),
    });
  }
  const ops: Op[][] = plan.map((m) => opsFor({ issue: board.get(m.key) }, { issue: after.get(m.key) }, after));
  return { plan, ops, after };
}

test("a drop at the top of a filtered column ranks before the card shown below it, never a hidden one", () => {
  // Todo filtered to label `test`: TEST-1 is hidden, so TEST-2 shows first.
  const { ops, after } = drop(cell("TEST-2", "TEST-4", "TEST-5", "TEST-6"), ["TEST-6"], "TEST-2");
  expect(ops).toEqual([[{ op: "rank", before: "TEST-2" }]]);
  // Jira puts it right above TEST-2, so with the filter cleared TEST-1 is still first: the local order says the same.
  expect(ranks(after)).toEqual(["TEST-1", "TEST-6", "TEST-2", "TEST-3", "TEST-4", "TEST-5"]);
});

test("a drop at the bottom of a filtered column ranks after the card shown above it", () => {
  // Todo filtered to someone's cards: TEST-5 and TEST-6 are hidden.
  const { ops, after } = drop(cell("TEST-1", "TEST-2", "TEST-4"), ["TEST-3"], undefined, "todo");
  expect(ops).toEqual([[{ op: "status", status: "todo" }, { op: "rank", after: "TEST-4" }]]);
  expect(ranks(after)).toEqual(["TEST-1", "TEST-2", "TEST-4", "TEST-3", "TEST-5", "TEST-6"]);
});

test("a drop at a column's top or bottom edge names that column's card, not another column's", () => {
  // TEST-5 to the top of Doing: Jira's board ranks it right above TEST-3, not above TEST-1 in Todo.
  expect(drop(cell("TEST-3"), ["TEST-5"], "TEST-3", "doing").ops).toEqual([
    [{ op: "status", status: "doing" }, { op: "rank", before: "TEST-3" }],
  ]);
  // TEST-2 to the bottom of Doing: right below TEST-3, not after TEST-6, the board's last card.
  const bottom = drop(cell("TEST-3"), ["TEST-2"], undefined, "doing");
  expect(bottom.ops).toEqual([[{ op: "status", status: "doing" }, { op: "rank", after: "TEST-3" }]]);
  expect(ranks(bottom.after)).toEqual(["TEST-1", "TEST-3", "TEST-2", "TEST-4", "TEST-5", "TEST-6"]);
});

test("a drop into an empty column changes only the status", () => {
  const { plan, ops } = drop([], ["TEST-4"], undefined, "review");
  expect(plan).toEqual([{ key: "TEST-4" }]);
  expect(ops).toEqual([[{ op: "status", status: "review" }]]);
  // A column holding only the dragged card is empty too once it leaves.
  expect(drop(cell("TEST-3"), ["TEST-3"], undefined).plan).toEqual([]);
});

test("a drop in a swimlane ranks against the card shown above it in that lane's cell", () => {
  // Rows by assignee: Todo's cell for "a" holds TEST-1, TEST-2, TEST-5 and TEST-6; TEST-4 sits in "b"'s row.
  const { ops } = drop(cell("TEST-1", "TEST-2", "TEST-5"), ["TEST-6"], "TEST-5");
  expect(ops).toEqual([[{ op: "rank", after: "TEST-2" }]]);
});

test("a drop back on the card's own place sends nothing", () => {
  const todo = cell("TEST-1", "TEST-2", "TEST-4", "TEST-5", "TEST-6");
  // Before the next card, before itself, or (the last card) at the end: the column's order doesn't change.
  expect(drop(todo, ["TEST-4"], "TEST-5").plan).toEqual([]);
  expect(drop(todo, ["TEST-4"], "TEST-4").plan).toEqual([]);
  expect(drop(todo, ["TEST-6"], undefined).plan).toEqual([]);
  // A selection already together in its order, too; one step away is a real move.
  expect(drop(todo, ["TEST-2", "TEST-4"], "TEST-5").plan).toEqual([]);
  expect(drop(todo, ["TEST-4"], "TEST-2").ops).toEqual([[{ op: "rank", after: "TEST-1" }]]);
  // Any other ordering only changes the group: nothing within the card's own column.
  expect(drop(todo, ["TEST-4"], "TEST-1", undefined, { manual: false, descending: false }).plan).toEqual([]);
});

test("a reorder between two cards ranks after the one above, wherever the card came from", () => {
  const todo = cell("TEST-1", "TEST-2", "TEST-4", "TEST-5", "TEST-6");
  const { ops, after } = drop(todo, ["TEST-6"], "TEST-4");
  expect(ops).toEqual([[{ op: "rank", after: "TEST-2" }]]);
  // Right after TEST-2 on the board: before TEST-3, which Doing shows.
  expect(ranks(after)).toEqual(["TEST-1", "TEST-2", "TEST-6", "TEST-3", "TEST-4", "TEST-5"]);
  expect(drop(cell("TEST-1", "TEST-2"), ["TEST-3"], "TEST-2", "todo").ops).toEqual([
    [{ op: "status", status: "todo" }, { op: "rank", after: "TEST-1" }],
  ]);
});

test("a selection lands together in its order, each after the one placed before it", () => {
  const { plan, ops, after } = drop(cell("TEST-2", "TEST-4"), ["TEST-5", "TEST-6"], "TEST-2");
  expect(plan.map((m) => m.key)).toEqual(["TEST-5", "TEST-6"]);
  expect(ops).toEqual([[{ op: "rank", before: "TEST-2" }], [{ op: "rank", after: "TEST-5" }]]);
  expect(ranks(after)).toEqual(["TEST-1", "TEST-5", "TEST-6", "TEST-2", "TEST-3", "TEST-4"]);
});

test("a descending column ranks the other way: the card shown above comes after in Jira", () => {
  const order = { manual: true, descending: true };
  // Todo, highest rank first: 6, 5, 4, 2, 1. TEST-3 dropped between 5 and 4 sits just before TEST-5 in Jira's order.
  const shown = cell("TEST-6", "TEST-5", "TEST-4", "TEST-2", "TEST-1");
  const between = drop(shown, ["TEST-3"], "TEST-4", "todo", order);
  expect(between.ops).toEqual([[{ op: "status", status: "todo" }, { op: "rank", before: "TEST-5" }]]);
  expect(ranks(between.after)).toEqual(["TEST-1", "TEST-2", "TEST-4", "TEST-3", "TEST-5", "TEST-6"]);
  // At the bottom, below TEST-1: before it in Jira. At the top, above TEST-6: after it.
  expect(drop(shown, ["TEST-3"], undefined, "todo", order).ops).toEqual([
    [{ op: "status", status: "todo" }, { op: "rank", before: "TEST-1" }],
  ]);
  expect(drop(shown, ["TEST-3"], "TEST-6", "todo", order).ops).toEqual([
    [{ op: "status", status: "todo" }, { op: "rank", after: "TEST-6" }],
  ]);
});

test("a card moved to another column at the place it already holds on the board keeps its rank", () => {
  // TEST-3 sits between TEST-2 and TEST-4 in Jira's order: dropped there in Todo, only its status changes.
  const { plan, ops } = drop(cell("TEST-1", "TEST-2", "TEST-4"), ["TEST-3"], "TEST-4", "todo");
  expect(plan).toEqual([{ key: "TEST-3", rank: "f", rankAnchor: { after: "TEST-2" } }]);
  expect(ops).toEqual([[{ op: "status", status: "todo" }]]);
});

test("a card that is gone, or a board in another order, only changes group", () => {
  expect(drop(cell("TEST-1"), ["GONE"], "TEST-1").plan).toEqual([{ key: "GONE" }]);
  expect(drop(cell("TEST-1"), ["TEST-3"], "TEST-1", "todo", { manual: false, descending: false }).ops).toEqual([
    [{ op: "status", status: "todo" }],
  ]);
});

test("cards dropped together are one undoable edit; a single card is its own", () => {
  const moved: string[] = [];
  const together: { keys: string[]; label: string }[] = [];
  const record = (keys: string[], label: string, fn: () => void) => {
    together.push({ keys, label });
    fn();
  };
  dropAll([{ key: "A" }], (m) => moved.push(m.key), record);
  expect(together).toEqual([]);
  dropAll([{ key: "B", rank: "c" }, { key: "D", rank: "e" }], (m) => moved.push(m.key), record);
  expect(together).toEqual([{ keys: ["B", "D"], label: "move 2 issues" }]);
  expect(moved).toEqual(["A", "B", "D"]);
});
