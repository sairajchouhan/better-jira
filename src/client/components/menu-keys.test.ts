import { expect, test } from "bun:test";
import { heldKey, keyUpMark, menuKey, navigates, NO_KEYUP, type KeyFacts } from "./menu-keys";

const ROW = { checkbox: false, submenu: false };
const CHECKBOX = { checkbox: true, submenu: false };
const SUBMENU = { checkbox: false, submenu: true };

/** A plain key in a root menu's empty search with a plain row highlighted. */
const facts = (key: string, more: Partial<KeyFacts> = {}): KeyFacts => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  held: false,
  mac: true,
  search: { value: "", start: 0, end: 0 },
  row: ROW,
  numbered: false,
  inSubmenu: false,
  childOpen: false,
  afterArrow: false,
  hasSurface: true,
  page: 10,
  ...more,
});
const typed = (value: string, at = value.length) => ({ search: { value, start: at, end: at } });

test("Escape closes every level of a menu in a surface, past React Aria's search, which would stop it reaching the surface", () => {
  expect(menuKey(facts("Escape"))).toEqual({ type: "close" });
  expect(menuKey(facts("Escape", { inSubmenu: true, ...typed("st") }))).toEqual({ type: "close" });
});

test("Escape in a menu outside any surface is left to its owner, not swallowed", () => {
  expect(menuKey(facts("Escape", { hasSurface: false }))).toEqual({ type: "release" });
});

test("↑ and ↓ step; ⌘ or ⌥ jumps to the end; with Shift and text in the search they select it instead", () => {
  expect(menuKey(facts("ArrowDown"))).toEqual({ type: "move", step: 1 });
  expect(menuKey(facts("ArrowUp"))).toEqual({ type: "move", step: -1 });
  expect(menuKey(facts("ArrowDown", { metaKey: true }))).toEqual({ type: "end", last: true });
  expect(menuKey(facts("ArrowUp", { altKey: true }))).toEqual({ type: "end", last: false });
  expect(menuKey(facts("ArrowDown", { shiftKey: true, ...typed("st") }))).toEqual({ type: "caret" });
  expect(menuKey(facts("ArrowDown", { shiftKey: true }))).toEqual({ type: "move", step: 1 });
});

test("Tab, Home/End, PageUp/PageDown and Ctrl+n/j/p/k move the highlight", () => {
  expect(menuKey(facts("Tab"))).toEqual({ type: "move", step: 1 });
  expect(menuKey(facts("Tab", { shiftKey: true }))).toEqual({ type: "move", step: -1 });
  expect(menuKey(facts("Home"))).toEqual({ type: "end", last: false });
  expect(menuKey(facts("End"))).toEqual({ type: "end", last: true });
  expect(menuKey(facts("PageDown"))).toEqual({ type: "move", step: 10, clamp: true });
  expect(menuKey(facts("PageUp"))).toEqual({ type: "move", step: -10, clamp: true });
  for (const [key, step] of [["n", 1], ["j", 1], ["p", -1], ["k", -1]] as const)
    expect(menuKey(facts(key, { ctrlKey: true }))).toEqual({ type: "move", step });
  expect(menuKey(facts("n", { ctrlKey: true, metaKey: true }))).toEqual({ type: "none" });
});

test("only the moving keys let a resting highlight preview its submenu", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Tab", "PageDown", "PageUp", "Home", "End"])
    expect(navigates({ key, altKey: false, ctrlKey: false, metaKey: false })).toBe(true);
  expect(navigates({ key: "j", altKey: false, ctrlKey: true, metaKey: false })).toBe(true);
  expect(navigates({ key: "ArrowRight", altKey: false, ctrlKey: false, metaKey: false })).toBe(false);
  expect(navigates({ key: "j", altKey: false, ctrlKey: false, metaKey: false })).toBe(false);
});

test("a digit picks the row showing it, with the search empty", () => {
  expect(menuKey(facts("2", { numbered: true }))).toEqual({ type: "number" });
  expect(menuKey(facts("2"))).toEqual({ type: "none" });
  expect(menuKey(facts("2", { numbered: true, ...typed("s") }))).toEqual({ type: "none" });
});

test("→ opens the highlighted submenu with the caret at the end, not on a held key", () => {
  expect(menuKey(facts("ArrowRight", { row: SUBMENU }))).toEqual({ type: "open" });
  expect(menuKey(facts("ArrowRight", { row: SUBMENU, ...typed("st") }))).toEqual({ type: "open" });
  expect(menuKey(facts("ArrowRight", { row: SUBMENU, ...typed("st", 1) }))).toEqual({ type: "caret" });
  expect(menuKey(facts("ArrowRight", { row: SUBMENU, held: true }))).toEqual({ type: "caret" });
  expect(menuKey(facts("ArrowRight"))).toEqual({ type: "caret" });
});

test("← at the start of the search closes this submenu, or in a menu its open submenu; never on a held key", () => {
  expect(menuKey(facts("ArrowLeft", { inSubmenu: true }))).toEqual({ type: "back" });
  expect(menuKey(facts("ArrowLeft", { inSubmenu: true, ...typed("st", 0) }))).toEqual({ type: "back" });
  expect(menuKey(facts("ArrowLeft", { inSubmenu: true, ...typed("st", 1) }))).toEqual({ type: "caret" });
  expect(menuKey(facts("ArrowLeft", { inSubmenu: true, held: true }))).toEqual({ type: "caret" });
  // BJ-325: J4e checks no modifier on ←.
  expect(menuKey(facts("ArrowLeft", { inSubmenu: true, shiftKey: true }))).toEqual({ type: "back" });
  expect(menuKey(facts("ArrowLeft", { inSubmenu: true, metaKey: true }))).toEqual({ type: "back" });
  expect(menuKey(facts("ArrowLeft", { childOpen: true }))).toEqual({ type: "closeChild" });
  expect(menuKey(facts("ArrowLeft", { childOpen: true, held: true }))).toEqual({ type: "caret" });
  expect(menuKey(facts("ArrowLeft"))).toEqual({ type: "caret" });
});

test("Backspace in a submenu's empty search steps back; a held one that just emptied it doesn't", () => {
  expect(menuKey(facts("Backspace", { inSubmenu: true }))).toEqual({ type: "back" });
  expect(menuKey(facts("Backspace", { inSubmenu: true, held: true }))).toEqual({ type: "none" });
  expect(menuKey(facts("Backspace", { inSubmenu: true, ...typed("s") }))).toEqual({ type: "none" });
  expect(menuKey(facts("Backspace"))).toEqual({ type: "none" });
});

test("Space picks the highlighted row, types mid-search unless it follows ↑/↓ on a checkbox row, and does nothing with no row", () => {
  expect(menuKey(facts(" "))).toEqual({ type: "toggle" });
  expect(menuKey(facts(" ", { row: null }))).toEqual({ type: "swallow" });
  expect(menuKey(facts(" ", { ...typed("st"), row: CHECKBOX }))).toEqual({ type: "none" });
  expect(menuKey(facts(" ", { ...typed("st"), row: CHECKBOX, afterArrow: true }))).toEqual({ type: "toggle" });
  expect(menuKey(facts(" ", { ...typed("st"), row: ROW, afterArrow: true }))).toEqual({ type: "none" });
});

test("Enter picks; on a checkbox row it closes, and with Shift or ⌘/Ctrl toggles and keeps the menu open", () => {
  expect(menuKey(facts("Enter"))).toEqual({ type: "pick" });
  expect(menuKey(facts("Enter", { row: null }))).toEqual({ type: "swallow" });
  expect(menuKey(facts("Enter", { row: CHECKBOX }))).toEqual({ type: "pickClose" });
  expect(menuKey(facts("Enter", { row: CHECKBOX, shiftKey: true }))).toEqual({ type: "toggle" });
  expect(menuKey(facts("Enter", { row: CHECKBOX, metaKey: true }))).toEqual({ type: "toggle" });
  expect(menuKey(facts("Enter", { row: CHECKBOX, ctrlKey: true }))).toEqual({ type: "toggle" });
});

test("the menu carries out each decision: Escape closes the surface, a release only prevents the default", async () => {
  const source = await Bun.file(new URL("./menu.tsx", import.meta.url)).text();
  const keyDown = source.slice(source.indexOf("const keyDown = "), source.indexOf("const pointerMove = "));
  expect(keyDown).toContain("menuKey(");
  expect(keyDown).toMatch(/case "close":[^]*?return surface\?\.close\(\);/);
  expect(keyDown).toContain('if (action.type === "release") return event.preventDefault();');
  expect(keyDown).toContain('if (action.type === "caret") return event.stopPropagation();');
});

test("BJ-325: Backspace steps back with any modifier, but not when pressed again within 200ms of its keyup (J4e's h)", () => {
  expect(menuKey(facts("Backspace", { inSubmenu: true, altKey: true }))).toEqual({ type: "back" });
  expect(menuKey(facts("Backspace", { inSubmenu: true, metaKey: true }))).toEqual({ type: "back" });
  const up = keyUpMark({ key: "Backspace", repeat: false }, 1000);
  expect(heldKey({ key: "Backspace", repeat: false }, up, 1150)).toBe(true);
  expect(heldKey({ key: "Backspace", repeat: false }, up, 1200)).toBe(false);
  expect(heldKey({ key: "Enter", repeat: false }, up, 1100)).toBe(false);
  expect(heldKey({ key: "Backspace", repeat: true }, NO_KEYUP, 5000)).toBe(true);
  // An arrow's own keyup clears the time, so ← pressed again at once still steps back.
  const arrow = keyUpMark({ key: "ArrowLeft", repeat: false }, 1000);
  expect(heldKey({ key: "ArrowLeft", repeat: false }, arrow, 1050)).toBe(false);
});

test("BJ-329: Home/End move the highlight only on a Mac (lm.isMac); elsewhere they move the search's caret", () => {
  expect(menuKey(facts("Home", { mac: false }))).toEqual({ type: "caret" });
  expect(menuKey(facts("End", { mac: false }))).toEqual({ type: "caret" });
  expect(menuKey(facts("End"))).toEqual({ type: "end", last: true });
});
