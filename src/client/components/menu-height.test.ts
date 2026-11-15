import { expect, test } from "bun:test";
import { LAST_ROW_SHOWN, limitCap, listHeight, listRoom, MENU, menuRoom } from "./menu";

// A menu list's rows as it lays them out: 6px of padding (Vw.LIST_PADDING), then 32px rows.
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ top: MENU.LIST_PADDING + i * 32, height: 32 }));
const natural = (n: number) => 2 * MENU.LIST_PADDING + n * 32;

test("_3e: a menu's room is the window less Vw.VIEWPORT_PADDING (16) above and below", () => {
  expect(menuRoom(969)).toBe(969 - 32);
  expect(menuRoom(500)).toBe(468);
});

test("_3e: a submenu may run from its row to 16px off the bottom when that is over half the window, else it takes the full room", () => {
  // A row near the top: from it to 16px off the bottom.
  expect(menuRoom(969, 100)).toBe(969 - 100 - 16);
  // A row low down: the window less 16px each end, and the submenu is moved up into it.
  expect(menuRoom(969, 600)).toBe(937);
  // Exactly half is not over half.
  expect(menuRoom(1000, 484)).toBe(968);
});

test("_3e: the list gets the room less what the popup shows around it, and no more than any capped box around it allows", () => {
  // The 1044-label submenu: a 36px search and a 0.5px border each end around a 33,000px list, in a 969px window.
  expect(listRoom(33_000, [], { room: menuRoom(969), around: 37 })).toBe(900);
  // Its popup capped at 853 from its row, holding the same search and borders.
  expect(listRoom(33_000, [{ max: 853, around: 37 }], { room: 937, around: 37 })).toBe(816);
  // Menu.List's own cap (360px) wins when it is smaller.
  expect(listRoom(360, [{ max: 853, around: 37 }], { room: 937, around: 37 })).toBe(360);
  // Outside any popup only the list's own height counts.
  expect(listRoom(33_000, [])).toBe(33_000);
});

test("v3e/b3e: a list too tall for its room is cut where the last row in view shows at least 55% of itself", () => {
  const room = 900;
  const height = listHeight(rows(1044), natural(1044), room);
  expect(height).toBeLessThanOrEqual(room);
  // Rows 0-26 whole (6 + 27 × 32 = 870), row 27 cut at ceil(870 + 32 × 0.55) = 888: 18 of its 32px, 56%.
  expect(height).toBe(888);
  const last = rows(1044).find((row) => row.top + row.height > height)!;
  expect((height - last.top) / last.height).toBeGreaterThanOrEqual(LAST_ROW_SHOWN);
  // One pixel less room loses that row's cut and falls back to the one before it.
  expect(listHeight(rows(1044), natural(1044), 887)).toBe(856);
});

test("_3e: a list that fits keeps its natural height, and a room smaller than any cut keeps the first row's", () => {
  expect(listHeight(rows(5), natural(5), 900)).toBe(natural(5));
  expect(listHeight(rows(5), natural(5), natural(5))).toBe(natural(5));
  expect(listHeight(rows(100), natural(100), 10)).toBe(Math.ceil(6 + 32 * LAST_ROW_SHOWN));
  // Rows of other heights cut on their own sizes: a 30px group header first (no list padding above it), then rows from 30.
  const mixed = [{ top: 0, height: 30 }, ...rows(50).map((row) => ({ ...row, top: row.top - MENU.LIST_PADDING + 30 }))];
  expect(listHeight(mixed, 30 + 50 * 32 + 6, 100)).toBe(Math.ceil(30 + 32 + 32 * LAST_ROW_SHOWN));
});

test("the Labels submenu on a 1044-label board fits 16px inside a 969px window", () => {
  const around = 37,
    list = listHeight(rows(1044), natural(1044), listRoom(natural(1044), [], { room: menuRoom(969), around }));
  expect(list + around).toBeLessThanOrEqual(969 - 2 * MENU.VIEWPORT_PADDING);
  expect(list).toBeGreaterThan(800);
});

test("BJ-302: limitHeight cuts to 18 rows only once the list overflows its room (_3e's M: `t<=r` shows it whole)", () => {
  // 24 rows fit a tall window: all 24 show, as fitHeight only reaches limitCap when natural > room.
  expect(natural(24)).toBeLessThan(menuRoom(1200) - 36);
  expect(listHeight(rows(24), natural(24), menuRoom(1200) - 36)).toBe(natural(24));
  // 40 rows overflow it: cut at the 18th row's end (its padding above included), the last row in view shown at least 55%.
  const room = Math.min(menuRoom(1200) - 36, limitCap(rows(40), 1200, 36));
  expect(limitCap(rows(40), 1200, 36)).toBe(MENU.LIST_PADDING + 18 * 32);
  expect(listHeight(rows(40), natural(40), room)).toBe(Math.ceil(MENU.LIST_PADDING + 17 * 32 + 32 * LAST_ROW_SHOWN));
  // A short window: 80% of it less what sits around the list wins.
  expect(limitCap(rows(40), 600, 36)).toBe(Math.floor(600 * 0.8) - 36);
  // Fewer rows laid out than 18 (a virtualized list): 18 rows of 32px and the padding.
  expect(limitCap(rows(10), 1200, 36)).toBe(18 * 32 + MENU.LIST_PADDING);
});
