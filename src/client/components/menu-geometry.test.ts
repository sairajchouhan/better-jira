import { expect, test } from "bun:test";
import { anchoredPlacement, LIMIT_HEIGHT, MENU, menuRoom } from "./menu-geometry";
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
