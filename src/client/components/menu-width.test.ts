import { expect, test } from "bun:test";
import { grownWidth, OVERSCAN, renderedRows } from "./menu";

// 32px rows from y = 0, as a menu list lays them out.
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ top: i * 32, bottom: i * 32 + 32 }));

test("k3e: a menu is as wide as its widest rendered row, at least its minimum", () => {
  expect(grownWidth([120.2, 96, 140.4], undefined, 175)).toBe(175);
  expect(grownWidth([120.2, 196, 240.4], undefined, 175)).toBe(241);
});

test("k3e: the whole row stops at Vw.ITEM_MAX_WIDTH, 400, however long a label is", () => {
  // The Labels submenu on a board whose widest label is 541px of text: 400, not the label's 400 plus the row's padding.
  expect(grownWidth([180, 573], undefined, 175)).toBe(400);
  // A minimum above the cap wins (k3e's h = max(customMinWidth, ITEM_MAX_WIDTH)).
  expect(grownWidth([180, 573], undefined, 420)).toBe(420);
});

test("k3e: a menu only grows while it is open: narrower rows (a search, a scroll) leave it as it is", () => {
  expect(grownWidth([150], 241, 175)).toBeUndefined();
  expect(grownWidth([241], 241, 175)).toBeUndefined();
  expect(grownWidth([260], 241, 175)).toBe(260);
  expect(grownWidth([], 241, 175)).toBeUndefined();
});

test("Linear's virtualized list renders the rows on screen and ten either side, so only those size the menu", () => {
  const list = rows(1044);
  // 300px of list on screen from the top: rows 0-9 are visible, 10 more are rendered below them.
  expect(renderedRows(list, { top: 0, bottom: 300 })).toEqual([0, 10 + OVERSCAN]);
  // Scrolled to row 500: ten above and ten below come with it.
  expect(renderedRows(list, { top: 500 * 32, bottom: 500 * 32 + 300 })).toEqual([490, 510 + OVERSCAN]);
  // A row only touching the band's edge is off screen.
  expect(renderedRows(list, { top: 32, bottom: 64 })).toEqual([0, 2 + OVERSCAN]);
  expect(renderedRows(rows(5), { top: 0, bottom: 900 })).toEqual([0, 5]);
});

test("a list with no row on screen renders its first rows, as one scrolled to its top", () => {
  expect(renderedRows(rows(100), { top: -500, bottom: -100 })).toEqual([0, OVERSCAN + 1]);
  expect(renderedRows([], { top: 0, bottom: 900 })).toEqual([0, 0]);
});

test("the widest label far down the list never widens a menu opened at the top", () => {
  // 1044 labels, every one 150px except one 600px label at row 900.
  const list = rows(1044);
  const widths = list.map((_, i) => (i === 900 ? 600 : 150));
  const [start, end] = renderedRows(list, { top: 0, bottom: 400 });
  expect(grownWidth(widths.slice(start, end), undefined, 175)).toBe(175);
  // Scrolling it into view grows the menu, to the cap.
  const [from, to] = renderedRows(list, { top: 880 * 32, bottom: 880 * 32 + 400 });
  expect(grownWidth(widths.slice(from, to), 175, 175)).toBe(400);
});
