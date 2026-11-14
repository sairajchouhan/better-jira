import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VirtualGridList, dragKeys, dropSpotAt, isShortcutKey, landsBefore, windowOf, type ListDrop } from "./virtual-grid-list";

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
  expect(dragKeys(keys, ["C"], new Set())).toEqual(["C"]);
  expect(dragKeys(keys, ["C"], new Set(["A", "E"]))).toEqual(["C"]);
  expect(dragKeys(keys, ["E", "B"], new Set(["E", "B", "D"]))).toEqual(["B", "D", "E"]);
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
    <VirtualGridList aria-label="Todo" items={items} itemKey={(key) => key} estimate={100} {...props}>
      {(key) => (
        <VirtualGridList.Item id={key} textValue={`${key} summary`}>
          <div>{key}</div>
        </VirtualGridList.Item>
      )}
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
  const drop: ListDrop = { type: "application/x-test", onDrop: () => {}, renderPreview: () => null };
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
