import { expect, test } from "bun:test";
import { PULL_REQUEST_ROW_CARD_DELAY } from "@/client/features/issue/issue-pull-requests";
import { HOVER_CARD } from "./hover-card";
import { parseTip, tipCaps, TOOLTIP } from "./tooltip";

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

test("tooltips and hover cards take Linear's `Rwe` values as React Aria's delay, closeDelay, offset and padding", () => {
  // `w = transitionDelay ?? (interactive ? 550 : 450)`, `Nwe = defaultOffset * 2`, `Fwe = 12`; a plain tooltip hides at once.
  expect(TOOLTIP).toEqual({ delay: 450, closeDelay: 0, offset: 8, containerPadding: 12 });
  expect(HOVER_CARD).toEqual({ delay: 550, closeDelay: 100 });
  // The issue sidebar's pull request row: `transitionDelay: 150`.
  expect(PULL_REQUEST_ROW_CARD_DELAY).toBe(150);
});
