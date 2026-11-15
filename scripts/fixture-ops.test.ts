import { expect, test } from "bun:test";
import { boardOps, rankFor } from "./fixture-ops";
import type { Op } from "../src/shared/jira-ops";

const ranks = new Map([
  ["A", "0|i00000:"],
  ["B", "0|i00001:"],
  ["C", "0|i00002:"],
]);
const order = (moved: string, rank: string) =>
  [...new Map([...ranks, [moved, rank]])].sort(([, a], [, b]) => (a < b ? -1 : 1)).map(([key]) => key);

test("BJ-332: the fixture's rank op places the issue right after or before its target, as Jira's rank PUT", () => {
  expect(order("C", rankFor(ranks, "C", { after: "A" })!)).toEqual(["A", "C", "B"]);
  expect(order("A", rankFor(ranks, "A", { before: "C" })!)).toEqual(["B", "A", "C"]);
  expect(order("C", rankFor(ranks, "C", { before: "A" })!)).toEqual(["C", "A", "B"]);
  expect(order("A", rankFor(ranks, "A", { after: "C" })!)).toEqual(["B", "C", "A"]);
  expect(rankFor(ranks, "A", { after: "MISSING" })).toBeUndefined();
});

test("BJ-332: a drag's status and rank ops both read back; other ops leave them", () => {
  const ops: Op[] = [{ op: "fields", fields: { summary: "Moved" } }, { op: "status", status: "doing" }, { op: "rank", after: "A" }];
  const moved = boardOps("C", ops, ranks);
  expect(moved.status).toBe("doing");
  expect(order("C", moved.rank!)).toEqual(["A", "C", "B"]);
  expect(boardOps("C", [{ op: "fields", fields: { summary: "Only" } }], ranks)).toEqual({});
});
