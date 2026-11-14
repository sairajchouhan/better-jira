import { expect, test } from "bun:test";
import { collapseClick, collapseTip } from "./group-collapse";

test("the chevron's tooltip is Linear's: T for this group over ⌥ click for all, expand while collapsed", () => {
  expect(collapseTip(false, true)).toBe("(T) to collapse group\n(⌥ click) to collapse all");
  expect(collapseTip(true, true)).toBe("(T) to expand group\n(⌥ click) to expand all");
  expect(collapseTip(false, false)).toBe("(T) to collapse group\n(Alt click) to collapse all");
});

test("⌥-click on the chevron toggles every group, a plain click only its own (CollapseListGroupButton `S`)", () => {
  const calls: string[] = [];
  collapseClick({ altKey: false }, () => calls.push("one"), () => calls.push("all"));
  collapseClick({ altKey: true }, () => calls.push("one"), () => calls.push("all"));
  expect(calls).toEqual(["one", "all"]);
});
