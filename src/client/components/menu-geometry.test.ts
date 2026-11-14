import { expect, test } from "bun:test";
import { anchoredPlacement, LIMIT_HEIGHT, MENU, menuRoom, submenuPlacement } from "./menu-geometry";
import * as menu from "./menu";

const at = (top: number, bottom: number, width = 120) => ({ top, bottom, width });

test("a picker keeps to the room below its trigger while that side has 30% of the window, even when above is bigger", () => {
  // 900px window, trigger 560–590: 289.5px below (32% of the window), 539.5px above. Linear's _3e keeps the preferred side;
  // the old rule took the bigger side and flipped this 800px menu above.
  expect(anchoredPlacement({ trigger: at(560, 590), height: 800, windowHeight: 900, gap: 4.5 })).toEqual({
    below: true,
    top: 594.5,
    maxHeight: 289.5,
  });
});

test("under 30% of the window below, the room is the whole window and the menu goes above when it fits there", () => {
  // 179.5px below is under 270px (30% of 900): the room becomes 900 - 2 * 16.
  expect(anchoredPlacement({ trigger: at(670, 700), height: 400, windowHeight: 900, gap: 4.5 })).toEqual({
    below: false,
    top: 670 - 4.5 - 400,
    maxHeight: 868,
  });
  // Short enough to fit below anyway: it stays below.
  expect(anchoredPlacement({ trigger: at(670, 700), height: 150, windowHeight: 900, gap: 4.5 }).top).toBe(704.5);
});

test("fitting neither side, it sits as low as fits; a trigger without width takes the whole window", () => {
  expect(anchoredPlacement({ trigger: at(670, 700), height: 2000, windowHeight: 900, gap: 4.5 })).toEqual({
    below: true,
    top: 20,
    maxHeight: 868,
  });
  expect(anchoredPlacement({ trigger: at(100, 130, 0), height: 50, windowHeight: 900, gap: 4 }).maxHeight).toBe(868);
});

test("Linear's limitHeight cap: 18 rows and the list's top padding, at most 80% of the window less the search", () => {
  expect(LIMIT_HEIGHT).toBe(`min(${18 * 32 + 6}px, calc(80vh - 36px))`);
});

test("menu.tsx re-exports the geometry it used to own, and menu-surface.tsx no longer imports menu.tsx", async () => {
  expect(menu.MENU).toBe(MENU);
  expect(menu.menuRoom).toBe(menuRoom);
  const surface = await Bun.file(new URL("./menu-surface.tsx", import.meta.url)).text();
  const geometry = await Bun.file(new URL("./menu-geometry.ts", import.meta.url)).text();
  expect(surface).not.toMatch(/from "\.\/menu"/);
  expect(geometry).not.toMatch(/from "\.\/menu(-surface)?"/);
});

const submenu = (over: Partial<Parameters<typeof submenuPlacement>[0]> = {}) =>
  submenuPlacement({
    row: { top: 200 },
    edge: { left: 400, right: 640 },
    width: 240,
    height: 300,
    first: 6,
    side: "right",
    view: { width: 1200, height: 900 },
    ...over,
  });

test("a submenu opens on its side, 2px over its menu's border, its first row level with its row (Linear's x3e)", () => {
  // Room below the row is 900 - 200 - 16, over half the window, so that is its cap.
  expect(submenu()).toEqual({ left: 638, top: 194, maxHeight: 684 });
});

test("a submenu swaps sides only when its own doesn't fit and the other does", () => {
  expect(submenu({ edge: { left: 760, right: 1000 } }).left).toBe(522);
  expect(submenu({ side: "left", edge: { left: 100, right: 340 } }).left).toBe(338);
});

test("when neither side fits, a submenu keeps its side and is clamped 12px inside the window, over its menu (S3e)", () => {
  expect(submenu({ edge: { left: 100, right: 400 }, view: { width: 500, height: 900 } }).left).toBe(248);
});

test("a submenu near the bottom is moved up to stay 10px inside the window, its cap the whole window's room", () => {
  expect(submenu({ row: { top: 800 } })).toEqual({ left: 638, top: 590, maxHeight: 900 - 2 * MENU.VIEWPORT_PADDING });
});
