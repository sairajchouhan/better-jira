import { expect, test } from "bun:test";
import { emojiGridDelegate, pickerKey } from "./emoji-grid";

// Two sections of nine-cell rows: 11 cells (a full row, then 2) and 4 cells.
const a = Array.from({ length: 11 }, (_, i) => `a${i}`);
const b = ["b0", "b1", "b2", "b3"];

test("↓ and ↑ keep the column across rows and sections, landing on a short row's last cell (the old picker jumped ±9 cells)", () => {
  const grid = emojiGridDelegate([a, b]);
  expect(grid.getKeyBelow("a4")).toBe("a10"); // a short row: its last cell, not a cell of the next section
  expect(grid.getKeyBelow("a1")).toBe("a10");
  expect(grid.getKeyBelow("a0")).toBe("a9");
  expect(grid.getKeyBelow("a10")).toBe("b1"); // each section starts a new row
  expect(grid.getKeyAbove("b3")).toBe("a10");
  expect(grid.getKeyAbove("b0")).toBe("a9");
  expect(grid.getKeyAbove("a9")).toBe("a0");
});

test("↑ in the first row goes to the first cell and ↓ in the last row stays, as Linear's `cut`", () => {
  const grid = emojiGridDelegate([a, b]);
  expect(grid.getKeyAbove("a5")).toBe("a0");
  expect(grid.getKeyBelow("b3")).toBe("b3");
});

test("← and → step through every cell in order and stop at the ends", () => {
  const grid = emojiGridDelegate([a, b]);
  expect(grid.getKeyRightOf("a8")).toBe("a9");
  expect(grid.getKeyRightOf("a10")).toBe("b0");
  expect(grid.getKeyLeftOf("b0")).toBe("a10");
  expect(grid.getKeyLeftOf("a0")).toBe("a0");
  expect(grid.getKeyRightOf("b3")).toBe("b3");
  expect([grid.getFirstKey(), grid.getLastKey()]).toEqual(["a0", "b3"]);
});

test("a key the grid no longer holds moves to the first cell; an empty grid has none", () => {
  expect(emojiGridDelegate([a]).getKeyBelow("gone")).toBe("a0");
  expect(emojiGridDelegate([a]).getKeyRightOf("gone")).toBe("a0");
  expect(emojiGridDelegate([]).getFirstKey()).toBeNull();
  expect(emojiGridDelegate([[]]).getLastKey()).toBeNull();
});

const at = (highlighted: boolean, more: Partial<Parameters<typeof pickerKey>[1]> = {}) => ({
  highlighted,
  caretAtEnd: true,
  shift: false,
  modifier: false,
  ...more,
});

test("with nothing highlighted, ↓, → and Tab highlight the first cell; ↑ does nothing (Linear's `cut`)", () => {
  expect(pickerKey("ArrowDown", at(false))).toBe("pass"); // React Aria's own ↓ goes to the first cell
  expect(pickerKey("ArrowRight", at(false))).toBe("ArrowDown");
  expect(pickerKey("Tab", at(false))).toBe("ArrowDown");
  expect(pickerKey("ArrowUp", at(false))).toBe("text");
  expect(pickerKey("Tab", at(false, { shift: true }))).toBe("pass");
});

test("with a cell highlighted, the arrows move it and Tab / Shift+Tab step forward and back", () => {
  for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Escape"]) expect(pickerKey(key, at(true))).toBe("pass");
  expect(pickerKey("Tab", at(true))).toBe("ArrowRight");
  expect(pickerKey("Tab", at(true, { shift: true }))).toBe("ArrowLeft");
});

test("the field keeps a key when the caret is not at the end, a modifier is held, or it is Home, End or a page key", () => {
  expect(pickerKey("ArrowDown", at(true, { caretAtEnd: false }))).toBe("text");
  expect(pickerKey("ArrowLeft", at(true, { shift: true }))).toBe("text");
  expect(pickerKey("ArrowRight", at(false, { modifier: true }))).toBe("text");
  for (const key of ["Home", "End", "PageUp", "PageDown"]) expect(pickerKey(key, at(true))).toBe("text");
  // Tab acts wherever the caret is; typed text is React Aria's.
  expect(pickerKey("Tab", at(true, { caretAtEnd: false }))).toBe("ArrowRight");
  expect(pickerKey("a", at(false))).toBe("pass");
});
