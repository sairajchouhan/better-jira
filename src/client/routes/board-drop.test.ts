import { expect, test } from "bun:test";
import { type Issue } from "@/shared/issue-model";
import { opsFor } from "@/shared/jira-ops";
import { dropPlan } from "./board-drop";

const card = (key: string, status: string, rank: string): Issue => ({
  key,
  board: 1,
  summary: key,
  status,
  assignee: null,
  labels: [],
  comments: 0,
  updated: "2026-11-01T00:00:00Z",
  resolved: null,
  rank,
});
// Jira ranks one board across its columns: Todo holds A and C, Doing holds B between them, and D.
const board = new Map([card("A", "todo", "b"), card("B", "doing", "d"), card("C", "todo", "f"), card("D", "doing", "h")].map((i) => [i.key, i]));
const todo = [board.get("A")!, board.get("C")!];
const manual = { manual: true, descending: false };
const lookup = (key: string) => board.get(key);

test("a card dropped between two cards ranks between them, wherever it came from", () => {
  const [move] = dropPlan(todo, ["D"], "C", manual, lookup);
  expect(move!.key).toBe("D");
  expect(move!.rank! > "b" && move!.rank! < "f").toBe(true);
  expect(dropPlan(todo, ["D"], undefined, manual, lookup)[0]!.rank! > "f").toBe(true);
  expect(dropPlan(todo, ["D"], "A", manual, lookup)[0]!.rank! < "b").toBe(true);
});

test("a selection lands together in its order, each after the one placed before it", () => {
  const plan = dropPlan(todo, ["B", "D"], "C", manual, lookup);
  expect(plan.map((m) => m.key)).toEqual(["B", "D"]);
  expect("b" < plan[0]!.rank! && plan[0]!.rank! < plan[1]!.rank! && plan[1]!.rank! < "f").toBe(true);
  // Reordering within the cell: the dragged card is left out of its own neighbours.
  const [own] = dropPlan(todo, ["A"], undefined, manual, lookup);
  expect(own!.rank! > "f").toBe(true);
});

test("a descending board ranks the other way; any other ordering only changes the group", () => {
  const shown = [todo[1]!, todo[0]!]; // C then A, highest rank first
  const [move] = dropPlan(shown, ["D"], "A", { manual: true, descending: true }, lookup);
  expect(move!.rank! > "b" && move!.rank! < "f").toBe(true);
  expect(dropPlan(todo, ["D"], "C", { manual: false, descending: false }, lookup)).toEqual([{ key: "D" }]);
  expect(dropPlan(todo, ["GONE"], "C", manual, lookup)).toEqual([{ key: "GONE" }]);
});

test("a cross-column drop between two cards writes the new status and a rank after its board neighbour (BJ-322)", () => {
  // What actions.drop then writes: the column's status and the planned rank; opsFor turns it into Jira's ops.
  const [move] = dropPlan(todo, ["D"], "C", manual, lookup);
  const dropped = { ...board.get("D")!, status: "todo", rank: move!.rank };
  const after = new Map(board).set("D", dropped);
  const ops = opsFor({ issue: board.get("D")! }, { issue: dropped }, after);
  expect(ops[0]).toEqual({ op: "status", status: "todo" });
  // Jira ranks the whole board, so the neighbour may sit in another column: here B ("d") or A ("b"), never past C.
  expect(ops[1]).toMatchObject({ op: "rank" });
  const neighbour = (ops[1] as { after?: string }).after!;
  expect(["A", "B"]).toContain(neighbour);
  expect(ops).toHaveLength(2);
});
