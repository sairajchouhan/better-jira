import { expect, test } from "bun:test";
import { groupStep } from "./caret-peek";

test("BJ-180: ⌥↑/⌥↓ jump between a suggestion menu's groups as in Linear", () => {
  const groups = ["people", "people", "people", "issues", "issues"];
  expect(groupStep(groups, 0, 1)).toBe(3);
  expect(groupStep(groups, 1, 1)).toBe(3);
  expect(groupStep(groups, 3, 1)).toBe(4);
  expect(groupStep(groups, 4, -1)).toBe(3);
  expect(groupStep(groups, 3, -1)).toBe(0);
  expect(groupStep(groups, 2, -1)).toBe(0);
  expect(groupStep(groups, 0, -1)).toBe(0);
  expect(groupStep([undefined, undefined], 0, 1)).toBe(1);
});
