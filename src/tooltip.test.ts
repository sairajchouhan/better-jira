import { expect, test } from "bun:test";
import { tipCaps } from "./tooltip";

test("tipCaps splits a title's keys into one cap per key", () => {
  expect(tipCaps("⌘⇧S")).toEqual(["⌘", "⇧", "S"]);
  expect(tipCaps("Ctrl+K")).toEqual(["Ctrl", "K"]);
  expect(tipCaps("G then I")).toEqual(["G", "I"]);
  expect(tipCaps("⌘+")).toEqual(["⌘", "+"]);
  expect(tipCaps("A / B")).toEqual(["A", "B"]);
});
