import { expect, test } from "bun:test";
import { rovingIndex } from "./tablist";

const none = [false, false, false, false];

test("arrows move and wrap", () => {
  expect(rovingIndex("ArrowRight", 0, none)).toBe(1);
  expect(rovingIndex("ArrowRight", 3, none)).toBe(0);
  expect(rovingIndex("ArrowLeft", 0, none)).toBe(3);
});

test("disabled tabs are skipped, Home/End find the enabled ends", () => {
  const disabled = [true, false, true, false];
  expect(rovingIndex("ArrowRight", 1, disabled)).toBe(3);
  expect(rovingIndex("ArrowRight", 3, disabled)).toBe(1);
  expect(rovingIndex("Home", 3, disabled)).toBe(1);
  expect(rovingIndex("End", 1, [false, false, false, true])).toBe(2);
});

test("orientation picks the arrow pair; other keys and empty lists do nothing", () => {
  expect(rovingIndex("ArrowDown", 0, none, "vertical")).toBe(1);
  expect(rovingIndex("ArrowDown", 0, none)).toBeNull();
  expect(rovingIndex("Enter", 0, none)).toBeNull();
  expect(rovingIndex("ArrowRight", 0, [])).toBeNull();
  expect(rovingIndex("ArrowRight", 0, [true, true])).toBeNull();
});

test("with focus outside the list, arrows start from the ends", () => {
  expect(rovingIndex("ArrowRight", -1, none)).toBe(0);
  expect(rovingIndex("ArrowLeft", -1, none)).toBe(3);
});
