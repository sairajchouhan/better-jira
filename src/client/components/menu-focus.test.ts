import { expect, test } from "bun:test";
import { enteredHighlight, focusOnOpen, settleHighlight, takesFocus } from "./menu";

const source = await Bun.file(new URL("./menu.tsx", import.meta.url)).text();
const UNSEEN = { key: null, search: null, value: undefined, order: [] as string[] };
const first = (order: string[]) => order[0] ?? null;

test("a submenu a key opened takes focus once placed, not while its popup is still hidden", () => {
  expect(focusOnOpen({ how: "focus" }, false)).toBe(false);
  expect(focusOnOpen({ how: "focus" }, true)).toBe(true);
  expect(focusOnOpen({ how: "pointer" }, true)).toBe(false);
  expect(focusOnOpen({ how: "preview" }, true)).toBe(false);
  // The effect runs again as the popup is placed.
  expect(source).toMatch(/if \(focusOnOpen\(opened, placed\)\) focusInside\(\);[^]*?\}, \[opened, placed\]\);/);
});

test("a menu's start waits for its first rows, so a submenu opens with its first row highlighted", () => {
  const empty = settleHighlight(UNSEEN, { key: null, search: "", value: undefined, order: [] }, first);
  expect(empty.next).toBeUndefined();
  const rows = settleHighlight(empty.seen, { key: null, search: "", value: undefined, order: ["a", "b"] }, first);
  expect(rows.next).toBe("a");
  // Then it leaves the highlight alone until something moves it.
  expect(settleHighlight(rows.seen, { key: "b", search: "", value: undefined, order: ["a", "b"] }, first).next).toBeUndefined();
});

test("after its start, a search moves the highlight to the first row, and a vanished highlight to the first left", () => {
  const seen = { key: "b", search: "", value: undefined, order: ["a", "b"] };
  expect(settleHighlight(seen, { key: "b", search: "x", value: undefined, order: ["c"] }, first).next).toBe("c");
  expect(settleHighlight(seen, { key: "b", search: "", value: undefined, order: ["a"] }, first).next).toBe("a");
  expect(settleHighlight(seen, { key: "b", search: "", value: "a", order: ["a", "b"] }, first).next).toBe("a");
});

test("a submenu focus hasn't entered keeps its highlight from the parent's focus; a root menu always takes it", () => {
  expect(takesFocus(false, false)).toBe(true);
  expect(takesFocus(true, false)).toBe(false);
  expect(takesFocus(true, true)).toBe(true);
  expect(source).toContain("takesFocus(!!latest.current.submenu, !!root.current?.contains(document.activeElement))");
});

test("focus entering a submenu shows its highlight, on the first row when it holds none", () => {
  expect(enteredHighlight(null, ["a", "b"])).toBe("a");
  expect(enteredHighlight("b", ["a", "b"])).toBe("b");
  expect(enteredHighlight("gone", ["a", "b"])).toBe("a");
  expect(enteredHighlight(null, [])).toBeNull();
  expect(source).toMatch(/node\.addEventListener\("focusin", entered\)/);
  expect(source).toMatch(/const entered = [^]*?enteredHighlight\(/);
});

test("a row whose value changes (the labels picker's create row as you type) is a new row, as React Aria can't change an id", () => {
  expect(source).toMatch(/<AriaMenuItem\s+(\/\/[^\n]*\s+)*key=\{value\}\s+id=\{value\}/);
  expect(source).toMatch(/<SubmenuTrigger key=\{value\}/);
});
