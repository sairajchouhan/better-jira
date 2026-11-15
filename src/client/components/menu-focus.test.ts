import { expect, test } from "bun:test";
import { enteredHighlight, focusOnOpen, settleHighlight, takesFocus } from "./menu";
import { initialFocusTarget, MENU_FOCUS, type FocusCandidate, POPOVER_FOCUS, refocusStep, TEXT_INPUT } from "./menu-surface";
const surfaceSource = await Bun.file(new URL("./menu-surface.tsx", import.meta.url)).text();

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

test("a popup's first focus goes to a field you type in, never a colour well, radio or other button-like input", () => {
  for (const type of ["color", "checkbox", "radio", "range", "file", "button", "submit", "hidden"])
    expect(TEXT_INPUT).toContain(`:not([type="${type}"])`);
  expect(TEXT_INPUT).not.toContain('[type="text"]');
  expect(MENU_FOCUS[1]!.startsWith(TEXT_INPUT)).toBe(true);
});

/** A stand-in DOM node: its selectors are the ones it matches, its children are flat. */
type Fake = FocusCandidate & { name: string };
const node = (name: string, selectors: string[], tabindex: string | null = null, children: Fake[] = []): Fake => ({
  name,
  matches: (s: string) => selectors.includes(s),
  querySelectorAll: (s: string) => children.filter((c) => c.matches(s)),
  getAttribute: (a: string) => (a === "tabindex" ? tabindex : null),
});

test("a menu with no search starts on itself, never on React Aria's hidden Dismiss button (Save menu: ↓ Enter picked nothing)", () => {
  const BUTTONS = MENU_FOCUS[2]!;
  const dismiss = node("dismiss", [BUTTONS], "-1");
  const menu = node("menu", [BUTTONS], "0");
  const surface = node("surface", [], null, [dismiss, menu, dismiss]);
  expect(initialFocusTarget(surface, MENU_FOCUS)?.name).toBe("menu");
  // Nothing but a Dismiss button: no target, so focus stays where React Aria put it.
  expect(initialFocusTarget(node("surface", [], null, [dismiss]), MENU_FOCUS)).toBeNull();
});

test("Display options takes focus on its dialog box, inside the popover's key handler, so Escape and Tab reach it", () => {
  const DIALOG = POPOVER_FOCUS[1]!;
  const box = node("box", [DIALOG]);
  const popover = node("popover", ["[data-popover]"], null, [box]);
  expect(initialFocusTarget(popover, POPOVER_FOCUS)?.name).toBe("box");
  // A search still comes first; a popover with neither starts on itself.
  const search = node("search", [TEXT_INPUT]);
  expect(initialFocusTarget(node("popover", ["[data-popover]"], null, [search, box]), POPOVER_FOCUS)?.name).toBe("search");
  expect(initialFocusTarget(node("popover", ["[data-popover]"]), POPOVER_FOCUS)?.name).toBe("popover");
  // The box gets focus even with no tabindex of its own.
  expect(surfaceSource).toMatch(/target\.focus\(\);\s*if \(document\.activeElement === target\) return;\s*target\.tabIndex = -1;\s*target\.focus\(\);/);
});

/** Runs the renders a list goes through: each step is what React Aria shows that render; returns the highlight after each. */
function renders(steps: { search: string; order: string[] }[], start: Parameters<typeof settleHighlight>[0]) {
  let seen = start;
  let key = start.key;
  return steps.map(({ search, order }) => {
    const settled = settleHighlight(seen, { key, search, value: undefined, order }, first);
    seen = settled.seen;
    if (settled.next !== undefined) key = settled.next;
    return key;
  });
}

test("a search's first-row pick waits for its own rows: React Aria shows the last search's rows for one render", () => {
  // Due date's submenu: "next wee" shows nothing; "next week" renders once with nothing, then with its one row.
  const empty = { key: null, search: "next wee", value: undefined, order: [] as string[] };
  expect(renders([{ search: "next week", order: [] }, { search: "next week", order: ["Due next week"] }], empty)).toEqual([
    null,
    "Due next week",
  ]);
  // Issue options: "d" first renders on the old rows, then on its own, where "Due date" is second.
  const opened = { key: "Due date", search: "", value: undefined, order: ["Due date", "Issue type"] };
  expect(
    renders(
      [
        { search: "d", order: ["Due date", "Issue type"] },
        { search: "d", order: ["Delete", "Due date"] },
        { search: "d", order: ["Delete", "Due date"] },
      ],
      opened,
    ),
  ).toEqual(["Due date", "Delete", "Delete"]);
});

test("once the user moves the highlight after a search, new rows keep it unless its row leaves", () => {
  const searched = settleHighlight(
    { key: "a", search: "", value: undefined, order: ["a", "b"] },
    { key: "a", search: "x", value: undefined, order: ["a", "b"] },
    first,
  ).seen;
  // ↓ to "b", then the rows change: "b" stays.
  expect(settleHighlight(searched, { key: "b", search: "x", value: undefined, order: ["c", "b"] }, first).next).toBeUndefined();
});

test("focus handed back from the body goes to the opener until it takes it, else its re-rendered node (refocusStep)", () => {
  const body = { name: "body" }, opener = { name: "opener" }, card = { name: "card" }, other = { name: "other" };
  // A dialog's page is inert as it closes, so the opener refused focus: the next frame, still on the body, it tries again.
  expect(refocusStep(body, body, opener, false, () => card)).toEqual({ focus: opener, done: false });
  expect(refocusStep(null, body, opener, false, () => card)).toEqual({ focus: opener, done: false });
  // Once the opener held focus, the body is where the user put it (an outside press on blank page): no bounce back.
  expect(refocusStep(body, body, opener, true, () => card)).toEqual({ done: true });
  // The opener re-rendered away: its keyed node takes focus, and that ends it.
  expect(refocusStep(body, body, null, true, () => card)).toEqual({ focus: card, done: true });
  expect(refocusStep(body, body, null, false, () => undefined)).toEqual({ focus: undefined, done: false });
  // On the opener, keep watching (it may re-render away a few frames on); anywhere else, the user moved on.
  expect(refocusStep(opener, body, opener, true, () => card)).toEqual({ done: false });
  expect(refocusStep(other, body, opener, false, () => card)).toEqual({ done: true });
});
