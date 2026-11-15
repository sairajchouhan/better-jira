import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  VirtualGridList,
  chosenKeys,
  covers,
  dragOf,
  dropSpotAt,
  flowOf,
  isShortcutKey,
  landsBefore,
  mountedIndices,
  ownsKey,
  rangeFor,
  windowOf,
  type ListDrop,
} from "./virtual-grid-list";

// Three 100px cards, 8px apart in their rows' boxes: A 0–100, B 100–200, C 200–300.
const rows = [
  { key: "A", top: 0, bottom: 100 },
  { key: "B", top: 100, bottom: 200 },
  { key: "C", top: 200, bottom: 300 },
];

test("a drop lands before the first row whose middle is below the pointer, else after the last", () => {
  expect(dropSpotAt(10, rows, null)).toEqual({ key: "A", position: "before" });
  expect(dropSpotAt(60, rows, null)).toEqual({ key: "B", position: "before" });
  expect(dropSpotAt(249, rows, null)).toEqual({ key: "C", position: "before" });
  expect(dropSpotAt(251, rows, null)).toEqual({ key: "C", position: "after" });
  expect(dropSpotAt(900, rows, null)).toEqual({ key: "C", position: "after" });
});

test("the dragged row, collapsed to nothing, is never a place to land by", () => {
  const dragging = [rows[0]!, { key: "B", top: 100, bottom: 100 }, { key: "C", top: 100, bottom: 200 }];
  expect(dropSpotAt(140, dragging, null)).toEqual({ key: "C", position: "before" });
  expect(dropSpotAt(10, [{ key: "A", top: 0, bottom: 0 }], null)).toBeNull();
  expect(dropSpotAt(10, [], null)).toBeNull();
});

test("the gap opened for the target never moves the target under a still pointer (no flicker)", () => {
  // A 100px gap open before B: B and C sit 100px lower than without it.
  const gap = { top: 100, height: 100 };
  const opened = [rows[0]!, { key: "B", top: 200, bottom: 300 }, { key: "C", top: 300, bottom: 400 }];
  // Inside the gap, or anywhere it covers: still before B, as the pointer was when it opened.
  expect(dropSpotAt(120, opened, gap)).toEqual({ key: "B", position: "before" });
  expect(dropSpotAt(190, opened, gap)).toEqual({ key: "B", position: "before" });
  // Past B's middle where it sits now: before C.
  expect(dropSpotAt(260, opened, gap)).toEqual({ key: "C", position: "before" });
  // Above the gap, in the top half of A: before A.
  expect(dropSpotAt(20, opened, gap)).toEqual({ key: "A", position: "before" });
});

test("a drop's place skips the rows being moved", () => {
  const keys = ["A", "B", "C", "D"];
  expect(landsBefore({ type: "item", key: "B", dropPosition: "before" }, keys, new Set())).toBe("B");
  expect(landsBefore({ type: "item", key: "B", dropPosition: "after" }, keys, new Set())).toBe("C");
  expect(landsBefore({ type: "item", key: "B", dropPosition: "before" }, keys, new Set(["B"]))).toBe("C");
  expect(landsBefore({ type: "item", key: "C", dropPosition: "after" }, keys, new Set(["D"]))).toBeUndefined();
  expect(landsBefore({ type: "item", key: "D", dropPosition: "after" }, keys, new Set())).toBeUndefined();
  expect(landsBefore({ type: "root" }, keys, new Set())).toBeUndefined();
});

test("a drag of a selected row carries the whole selection in list order, unmounted rows included", () => {
  const keys = ["A", "B", "C", "D", "E"];
  expect(dragOf(keys, ["C"], new Set())).toEqual({ moving: ["C"], clearsSelection: false });
  expect(dragOf(keys, ["E", "B"], new Set(["E", "B", "D"]))).toEqual({ moving: ["B", "D", "E"], clearsSelection: false });
});

test("BJ-333: dragging a row outside the selection moves only that row and clears the selection, as Linear's drag start", () => {
  const keys = ["A", "B", "C", "D", "E"];
  expect(dragOf(keys, ["C"], new Set(["A", "E"]))).toEqual({ moving: ["C"], clearsSelection: true });
});

test("the window holds every item reaching into the viewport and no other", () => {
  const offsets = [0, 100, 200, 300, 400, 500]; // five 100px items
  expect(windowOf(offsets, 0, 0)).toEqual([0, 0]);
  expect(windowOf(offsets, 150, 260)).toEqual([1, 3]);
  expect(windowOf(offsets, -500, 5000)).toEqual([0, 5]);
  expect(windowOf(offsets, 600, 900)).toEqual([5, 5]);
  expect(windowOf([0], 0, 100)).toEqual([0, 0]);
});

const items = ["A", "B", "C"];
const render = (props: { selected: string | null; selectedKeys?: ReadonlySet<string>; drop?: ListDrop }) =>
  renderToStaticMarkup(
    <VirtualGridList aria-label="Todo" items={items} itemKey={(key) => key} itemText={(key) => `${key} summary`} estimate={100} {...props}>
      {(key) => <div>{key}</div>}
    </VirtualGridList>,
  );

test("rows are a React Aria grid's rows, named by their text, never buttons with controls nested inside", () => {
  const html = render({ selected: "B" });
  expect(html).toMatch(/role="grid"[^>]*aria-label="Todo"|aria-label="Todo"[^>]*role="grid"/);
  // Before the first measure only the selected row is mounted, kept in place by the window.
  const row = html.match(/<div[^>]*role="row"[^>]*>/g) ?? [];
  expect(row).toHaveLength(1);
  expect(row[0]).toContain('data-key="B"');
  expect(row[0]).toContain('data-selected="true"');
  expect(row[0]).toContain('aria-selected="true"');
  expect(html).not.toContain('role="button"');
  expect(html).toContain('role="gridcell"');
});

test("a column selection never pins its rows, and only draggable lists carry the drag button", () => {
  const plain = render({ selected: null, selectedKeys: new Set(["C"]) });
  expect(plain).not.toContain('role="row"');
  expect(render({ selected: "A" })).not.toMatch(/<button[^>]*class="sr-only"/);
  const drop: ListDrop = { type: "application/x-test", onDrop: () => {}, renderPreview: () => null, clearSelection: () => {} };
  const draggable = render({ selected: "A", drop });
  expect(draggable).toMatch(/<button[^>]*class="sr-only"/);
});

test("the keys React Aria's grid would keep (arrows, ⌥ arrows, Home/End, Page keys, ⌘A) go to the app's shortcuts", () => {
  const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => isShortcutKey({ key: k, metaKey: false, ctrlKey: false, ...mods });
  for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) expect(key(k)).toBe(true);
  expect(key("a", { metaKey: true })).toBe(true);
  expect(key("A", { ctrlKey: true })).toBe(true);
  // Letters (j/k, issue shortcuts), Enter, Space and Escape reach the app untouched by React Aria already.
  for (const k of ["a", "j", "k", "Enter", " ", "Escape", "Tab"]) expect(key(k)).toBe(false);
});

// Fifty 100px cards: item i spans i*100 to (i+1)*100, 5,000px in all.
const fifty = Array.from({ length: 51 }, (_, i) => i * 100);

test("a scroll within the mounted range's 400–1200px band keeps the range, so the frame renders nothing (Linear's `wu`)", () => {
  // Mounted 0–1500px; the viewport 100–600px still has 400px below it and no more than 1200px.
  expect(rangeFor(fifty, [0, 15], { top: 100, bottom: 600 }, 0)).toEqual([0, 15]);
  expect(rangeFor(fifty, [0, 15], { top: 300, bottom: 800 }, 100)).toEqual([0, 15]);
  // Less than 400px left below the viewport: the range moves.
  expect(rangeFor(fifty, [0, 15], { top: 1000, bottom: 1500 }, 900)).not.toEqual([0, 15]);
  // More than 1200px mounted past the viewport: the range moves, so it never grows without bound.
  expect(rangeFor(fifty, [0, 30], { top: 0, bottom: 500 }, 100)).not.toEqual([0, 30]);
  // At the list's ends there is nothing more to cover.
  expect(rangeFor(fifty, [41, 50], { top: 4500, bottom: 5000 }, 4400)).toEqual([41, 50]);
});

test("a new range overscans 400px behind the scroll and, ahead, the viewport or twice the step, at most 1200px", () => {
  // First measure: 400px either side of a 500px viewport, ahead taking the viewport's height.
  expect(rangeFor(fifty, null, { top: 0, bottom: 500 }, null)).toEqual(windowOf(fifty, -400, 1000));
  // Scrolling down: 400px above, 500px below.
  expect(rangeFor(fifty, null, { top: 2000, bottom: 2500 }, 1900)).toEqual(windowOf(fifty, 1600, 3000));
  // Scrolling up: the long side is above.
  expect(rangeFor(fifty, null, { top: 2000, bottom: 2500 }, 2100)).toEqual(windowOf(fifty, 1500, 2900));
  // A fast fling reaches 1200px ahead and no further.
  expect(rangeFor(fifty, null, { top: 2000, bottom: 2500 }, 1000)).toEqual(windowOf(fifty, 1600, 3700));
  // A range from a longer list is clamped to the items there are.
  expect(rangeFor(fifty, [40, 99], { top: 4500, bottom: 5000 }, 4400)).toEqual([40, 50]);
});

test("a range that leaves part of the viewport blank must move at once; one that covers it can wait", () => {
  const ten = fifty.slice(0, 11);
  expect(covers(ten, [0, 5], { top: 0, bottom: 500 })).toBe(true);
  expect(covers(ten, [0, 5], { top: 0, bottom: 501 })).toBe(false);
  expect(covers(ten, [2, 5], { top: 150, bottom: 400 })).toBe(false);
  expect(covers(ten, null, { top: 0, bottom: 100 })).toBe(false);
  // Nothing of the list in view (scrolled past, or above it): nothing to show.
  expect(covers(ten, null, { top: 2000, bottom: 2500 })).toBe(true);
  expect(covers(ten, [0, 0], { top: -600, bottom: -100 })).toBe(true);
});

test("mounted rows sit at their offsets in flow: each after the space of the rows above it left out", () => {
  const offsets = [0, 100, 200, 300, 400, 500];
  expect(flowOf(offsets, [1, 3])).toEqual({ rows: [{ index: 1, gap: 100 }, { index: 3, gap: 100 }], tail: 100 });
  expect(flowOf(offsets, [0, 1, 2, 3, 4])).toEqual({ rows: [0, 1, 2, 3, 4].map((index) => ({ index, gap: 0 })), tail: 0 });
  expect(flowOf(offsets, [])).toEqual({ rows: [], tail: 500 });
});

test("the selected, focused, dragged and drop-target rows render at their place in the list, outside the window too", () => {
  expect(mountedIndices(2, 4, [7, 0, 3, -1, 7])).toEqual([0, 2, 3, 7]);
  expect(mountedIndices(0, 0, [5, 1])).toEqual([1, 5]);
  expect(mountedIndices(1, 3, [])).toEqual([1, 2]);
});

test("another list's selected item never changes this list's selected set, so its rows never re-render for it", () => {
  const index = new Map([["A", 0], ["B", 1]]);
  expect([...chosenKeys(undefined, "Z", index)]).toEqual([]);
  expect([...chosenKeys(new Set(["B"]), "Z", index)]).toEqual(["B"]);
  expect([...chosenKeys(new Set(["B"]), "A", index)].sort()).toEqual(["A", "B"]);
  expect([...chosenKeys(undefined, null, index)]).toEqual([]);
});

test("a selected row outside the window renders after a spacer the height of the rows above it", () => {
  const html = render({ selected: "C" });
  expect(html).toMatch(/<div aria-hidden="true" role="presentation" class="ui-virtual-spacer" style="height:200px"><\/div><div data-key="C"[^>]*role="row"/);
  expect(html.match(/role="row"/g)).toHaveLength(1);
  expect(render({ selected: "A" })).toMatch(/data-key="A"[\s\S]*class="ui-virtual-spacer" style="height:200px"/);
});

test("React Aria never holds the selection: the rows draw the app's, so a drop that adds rows can't loop on it (BJ-322)", () => {
  // A controlled React Aria selection that ignores changes re-renders forever when a drop adds rows (React error #185).
  const html = render({ selected: "B", selectedKeys: new Set(["B"]) });
  expect(html).not.toContain("data-selection-mode");
  expect(html).not.toContain("aria-multiselectable");
  expect(html).toMatch(/data-key="B"[^>]*data-selected="true"[^>]*aria-selected="true"|data-key="B"[^>]*aria-selected="true"[^>]*data-selected="true"/);
});

test("keys on a keyboard drag's drop target stay React Aria's; keys on an item row go to the app (BJ-322)", () => {
  // A stand-in element: `closest` answers from the selectors it sits inside.
  const inside = (...matches: string[]) => ({ closest: (selector: string) => (matches.includes(selector) ? {} : null) }) as unknown as Element;
  expect(ownsKey(inside("[role=row][data-key]"))).toBe(true);
  // React Aria's drop indicator is a row without a key.
  expect(ownsKey(inside())).toBe(false);
  const field = 'input, textarea, [contenteditable="true"], [role=dialog], [role=menu], [role=listbox]';
  expect(ownsKey(inside("[role=row][data-key]", field))).toBe(false);
});
