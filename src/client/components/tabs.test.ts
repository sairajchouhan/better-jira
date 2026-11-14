import { expect, test } from "bun:test";
import { passesEnd } from "./tabs";

const none = [false, false, false, false];

test("Linear's `sq` (loopFocus false): arrows stop at the last and first enabled tab instead of wrapping", () => {
  expect(passesEnd("ArrowRight", 3, none)).toBe(true);
  expect(passesEnd("ArrowLeft", 0, none)).toBe(true);
  expect(passesEnd("ArrowRight", 2, none)).toBe(false);
  expect(passesEnd("ArrowLeft", 1, none)).toBe(false);
});

test("disabled tabs past the focused one count as the end", () => {
  expect(passesEnd("ArrowRight", 1, [false, false, true, true])).toBe(true);
  expect(passesEnd("ArrowLeft", 2, [true, true, false, false])).toBe(true);
  expect(passesEnd("ArrowRight", 0, [false, true, false])).toBe(false);
});

test("other keys, and focus outside the list, are React Aria's", () => {
  expect(passesEnd("Home", 0, none)).toBe(false);
  expect(passesEnd("End", 3, none)).toBe(false);
  expect(passesEnd("Enter", 3, none)).toBe(false);
  expect(passesEnd("ArrowRight", -1, none)).toBe(false);
});
