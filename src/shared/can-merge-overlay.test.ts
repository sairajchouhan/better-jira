import { expect, test } from "bun:test";
import { canMergeOverlay } from "./saved-view-model";
import type { FilterGroup } from "./view-model";

const group = (join: "and" | "or", ...rules: [string, string, string[]][]): FilterGroup => ({
  id: crypto.randomUUID(),
  join,
  children: rules.map(([field, op, values]) => ({ id: crypto.randomUUID(), field, op, values }) as FilterGroup["children"][number]),
});

test("overlay cannot contradict a base `is` rule on the same field (Linear V-21)", () => {
  const base = group("and", ["status", "is", ["To Do"]]);
  expect(canMergeOverlay(base, group("and", ["status", "is", ["In Progress"]]))).toBe(false);
  expect(canMergeOverlay(base, group("and", ["status", "is", ["To Do", "Done"]]))).toBe(true);
  expect(canMergeOverlay(base, group("and", ["priority", "is", ["High"]]))).toBe(true);
  expect(canMergeOverlay(base, group("and", ["status", "isNot", ["In Progress"]]))).toBe(true);
  expect(canMergeOverlay(group("or", ["status", "is", ["To Do"]], ["priority", "is", ["High"]]), group("and", ["status", "is", ["Done"]]))).toBe(true);
});
