import { expect, test } from "bun:test";
import { parseTip, tipCaps } from "./tooltip";

test("tipCaps splits a title's keys into one cap per key", () => {
  expect(tipCaps("⌘⇧S")).toEqual(["⌘", "⇧", "S"]);
  expect(tipCaps("Ctrl+K")).toEqual(["Ctrl", "K"]);
  expect(tipCaps("G then I")).toEqual(["G", "I"]);
  expect(tipCaps("⌘+")).toEqual(["⌘", "+"]);
  expect(tipCaps("A / B")).toEqual(["A", "B"]);
});

test("parseTip: a trailing (keys) draws caps after the text, a leading one before it, one line per \\n (Linear's `N_`)", () => {
  expect(parseTip("Undo (⌘ Z)")).toEqual([{ text: "Undo", keys: ["⌘", "Z"], keysFirst: false }]);
  expect(parseTip("Plain")).toEqual([{ text: "Plain", keys: [], keysFirst: false }]);
  expect(parseTip("(T) to collapse group\n(⌥ click) to collapse all")).toEqual([
    { text: "to collapse group", keys: ["T"], keysFirst: true },
    { text: "to collapse all", keys: ["⌥", "click"], keysFirst: true },
  ]);
});
