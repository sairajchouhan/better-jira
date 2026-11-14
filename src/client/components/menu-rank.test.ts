import { describe, expect, test } from "bun:test";
import { arrange, EMPTY_STATE, relink, rowKeys, stepIndex, type RankCollection, type RankNode } from "./menu-rank";

type Spec = { key: string; type?: string; text?: string; props?: Record<string, unknown>; children?: Spec[] };

// The parts of React Aria's CollectionNode and BaseCollection the ranking uses, built the same way: linked nodes in a map.
class Node implements RankNode {
  key = "";
  type = "item";
  textValue = "";
  props: Record<string, unknown> = {};
  index = 0;
  parentKey: string | null = null;
  prevKey: string | null = null;
  nextKey: string | null = null;
  firstChildKey: string | null = null;
  lastChildKey: string | null = null;
  clone(): RankNode {
    return Object.assign(new Node(), this);
  }
}

class Collection implements RankCollection {
  nodes = new Map<string, RankNode>();
  first: string | null = null;
  *walk(from: string | null) {
    for (let key = from; key != null; key = this.nodes.get(key)!.nextKey as string | null) yield this.nodes.get(key)!;
  }
  [Symbol.iterator]() {
    return this.walk(this.first);
  }
  getItem(key: string) {
    return this.nodes.get(key) ?? null;
  }
  getChildren(key: string) {
    return this.walk(this.nodes.get(key)?.firstChildKey as string | null);
  }
  addNode(node: RankNode) {
    this.nodes.set(node.key as string, node);
  }
  addDescendants(node: RankNode, from: RankCollection) {
    this.addNode(node);
    for (const child of from.getChildren(node.key)) this.addDescendants(child.clone(), from);
  }
  commit(first: string | null) {
    this.first = first;
  }
}

function build(specs: Spec[]): Collection {
  const collection = new Collection();
  const link = (list: Spec[], parent: string | null) =>
    list.forEach((spec, index) => {
      const node = Object.assign(new Node(), {
        key: spec.key,
        type: spec.type ?? "item",
        textValue: spec.text ?? spec.key,
        props: spec.props ?? {},
        index,
        parentKey: parent,
        prevKey: list[index - 1]?.key ?? null,
        nextKey: list[index + 1]?.key ?? null,
        firstChildKey: spec.children?.[0]?.key ?? null,
        lastChildKey: spec.children?.at(-1)?.key ?? null,
      });
      collection.addNode(node);
      if (spec.children) link(spec.children, spec.key);
    });
  link(specs, null);
  collection.commit(specs[0]?.key ?? null);
  return collection;
}

const keys = (collection: RankCollection) => [...collection].map((node) => node.key);
// React Aria scores a submenu by its trigger node (SubmenuTriggerNode.filter passes itself), so its score is keyed there.
const SCORES: Record<string, number> = { b: 0.9, a: 0.4, g1: 0.2, g2: 0.95, trigger: 0.5 };
const score = (node: RankNode) => SCORES[node.key as string] ?? 0;

describe("arrange", () => {
  const menu = build([
    { key: "empty", type: "header", props: { [EMPTY_STATE]: "empty" } },
    { key: "a" },
    { key: "line", type: "separator" },
    { key: "b" },
    { key: "group", type: "section", children: [{ key: "head", type: "header" }, { key: "g1" }, { key: "g2" }] },
  ]);

  test("unsearched, every row keeps its place and the empty state hides while a row is listed", () => {
    expect(arrange(menu).map((shown) => shown.node.key)).toEqual(["a", "line", "b", "group"]);
  });

  test("searched, loose rows go best first, then groups by their best row, each heading over its rows; dividers go", () => {
    const shown = arrange(menu, score);
    expect(shown.map((row) => row.node.key)).toEqual(["b", "a", "group"]);
    expect(shown[2]!.children!.map((row) => row.node.key)).toEqual(["head", "g2", "g1"]);
  });

  test("the empty state shows when nothing is listed, and `always` shows it whatever is", () => {
    expect(arrange(build([{ key: "empty", type: "header", props: { [EMPTY_STATE]: "empty" } }])).length).toBe(1);
    const always = build([{ key: "note", type: "header", props: { [EMPTY_STATE]: "always" } }, { key: "a" }]);
    expect(arrange(always).map((shown) => shown.node.key)).toEqual(["note", "a"]);
  });

  test("equal scores keep the menu's order", () => {
    const tied = build([{ key: "x" }, { key: "y" }, { key: "z" }]);
    expect(arrange(tied, () => 0.5).map((shown) => shown.node.key)).toEqual(["x", "y", "z"]);
  });
});

describe("relink and rowKeys", () => {
  test("the ranked rows become a new collection in that order, the highlight moving through its rows only", () => {
    const menu = build([
      { key: "a" },
      { key: "trigger", type: "submenutrigger", children: [{ key: "s" }, { key: "popup", type: "popover" }] },
      { key: "b" },
      { key: "group", type: "section", children: [{ key: "g1" }, { key: "g2" }] },
    ]);
    const ranked = relink(menu, arrange(menu, score));
    expect(ranked).not.toBe(menu);
    expect(keys(ranked)).toEqual(["b", "trigger", "a", "group"]);
    // A submenu's row is highlighted by its action row, the submenutrigger's first child.
    expect(rowKeys(ranked)).toEqual(["b", "s", "a", "g2", "g1"]);
    expect(ranked.getItem("trigger")!.firstChildKey).toBe("s");
    expect(ranked.getItem("b")!.prevKey).toBeNull();
    expect(ranked.getItem("a")!.index).toBe(2);
  });

  test("disabled rows are passed over, and aria-disabled ones, which a press still runs", () => {
    expect(rowKeys(build([{ key: "a" }, { key: "off", props: { isDisabled: true } }, { key: "b" }]))).toEqual(["a", "b"]);
    expect(rowKeys(build([{ key: "a" }, { key: "why", props: { muted: true } }]))).toEqual(["a"]);
  });
});

test("stepIndex wraps, clamps for a page, and from no highlight lands on an end", () => {
  expect(stepIndex(4, 1, 5)).toBe(0);
  expect(stepIndex(0, -1, 5)).toBe(4);
  expect(stepIndex(3, 10, 5, true)).toBe(4);
  expect(stepIndex(1, -10, 5, true)).toBe(0);
  expect(stepIndex(-1, 1, 5)).toBe(0);
  expect(stepIndex(-1, -1, 5)).toBe(4);
  expect(stepIndex(-1, 1, 0)).toBe(-1);
});

describe("the list's virtualizing", async () => {
  const { leadsWithHeading, MenuLayout, OVERSCAN, overscanned } = await import("./menu");
  const { Rect } = await import("react-aria-components");

  test("Linear's react-window overscan: the band laid out is the view plus 10 rows above and below, never above the top", () => {
    expect(OVERSCAN).toBe(10);
    const band = overscanned(new Rect(0, 1000, 240, 400));
    expect([band.y, band.height]).toEqual([680, 400 + 2 * 320]);
    const top = overscanned(new Rect(0, 64, 240, 400));
    expect([top.y, top.height]).toEqual([0, 64 + 400 + 320]);
  });

  test("a 1044-row list lays out only the rows in view and the overscan", () => {
    const layout = new MenuLayout({ rowHeight: 32 });
    const keys = Array.from({ length: 1044 }, (_, i) => `label-${i}`);
    const nodes = new Map(keys.map((key, index) => [key, { key, type: "item", index, level: 0, childNodes: [] }]));
    const collection = {
      size: keys.length,
      getKeys: () => keys,
      getItem: (key: string) => nodes.get(key) ?? null,
      getFirstKey: () => keys[0],
      getLastKey: () => keys.at(-1),
      getKeyAfter: (key: string) => keys[keys.indexOf(key) + 1] ?? null,
      getKeyBefore: (key: string) => keys[keys.indexOf(key) - 1] ?? null,
      getChildren: () => [],
      [Symbol.iterator]: () => nodes.values(),
    };
    const view = new Rect(0, 0, 240, 400);
    layout.virtualizer = {
      collection,
      visibleRect: view,
      size: { width: view.width, height: view.height },
      isPersistedKey: () => false,
      persistedKeys: new Set(),
    } as never;
    layout.update({ invalidationContext: { layoutOptions: { rowHeight: 32 } } } as never);
    // 400px and 10 rows of overscan below (none above the top) is a 720px band: 23 rows, and in tests a 24th, the row starting on
    // its edge (React Aria's Rect.intersects counts a zero-area touch under NODE_ENV=test). Not 1044.
    expect(layout.getVisibleLayoutInfos(view).length).toBe(24);
  });

  test("a list opening on a heading or divider drops its top padding; on a row or the empty state it keeps it", () => {
    const empty = { [EMPTY_STATE]: "empty" };
    expect(leadsWithHeading(build([{ key: "h", type: "header" }, { key: "a" }]))).toBe(true);
    expect(leadsWithHeading(build([{ key: "line", type: "separator" }, { key: "a" }]))).toBe(true);
    expect(
      leadsWithHeading(build([{ key: "group", type: "section", children: [{ key: "h", type: "header" }, { key: "a" }] }])),
    ).toBe(true);
    expect(leadsWithHeading(build([{ key: "a" }]))).toBe(false);
    expect(leadsWithHeading(build([{ key: "e", type: "header", props: empty }]))).toBe(false);
    expect(leadsWithHeading(build([]))).toBe(false);
  });
});
