/**
 * How a menu orders its rows while it is searched, on React Aria's collection. Linear's B3e lists its search results best
 * first as the search changes; React Aria's Menu only filters (Autocomplete's `filter` keeps the
 * order), so the rows a filter keeps are re-linked here in score order before the list lays them out.
 */
import type { Key } from "react-aria-components";

/** The fields of React Aria's CollectionNode the ranking reads and writes. */
export type RankNode = {
  key: Key;
  type: string;
  textValue: string;
  props: Record<string, unknown>;
  index: number;
  parentKey: Key | null;
  prevKey: Key | null;
  nextKey: Key | null;
  firstChildKey: Key | null;
  lastChildKey: Key | null;
  clone(): RankNode;
};

/** The parts of React Aria's BaseCollection the ranking uses; a new one is made with its own constructor, as its `filter` does. */
export type RankCollection = Iterable<RankNode> & {
  getItem(key: Key): RankNode | null;
  getChildren(key: Key): Iterable<RankNode>;
  addNode(node: RankNode): void;
  addDescendants(node: RankNode, from: RankCollection): void;
  commit(firstKey: Key | null, lastKey: Key | null): void;
};

/** One row as shown, with the rows of a group (a section) under it. */
export type Shown = { node: RankNode; score: number; children?: Shown[] };

// Rows the keyboard moves through: actions, and the action row of a submenu (React Aria's `submenutrigger` holds it).
const ROW_TYPES = new Set(["item", "submenutrigger"]);
/** Marks Menu.Empty's header node: shown only while no row is listed (Linear's B3e empty state), unless it is `always`. */
export const EMPTY_STATE = "data-empty-state";

const byScore = (a: Shown, b: Shown) => b.score - a.score;

/**
 * The top-level rows of `collection` as the menu shows them. With `scoreOf` (a search) rows are sorted best first: the
 * menu's other children (headers, captions) keep their place at the top, then its loose rows by score, then its groups by
 * their best row, each group's rows by score; dividers go while filtering. The empty state shows only when no row is listed. Array sort is stable, so equal scores keep the menu's order.
 */
export function arrange(collection: RankCollection, scoreOf?: (node: RankNode) => number): Shown[] {
  const top = [...collection];
  const rows = top.some(
    (node) =>
      ROW_TYPES.has(node.type) ||
      (node.type === "section" && [...collection.getChildren(node.key)].some((child) => ROW_TYPES.has(child.type))),
  );
  const kept = top.filter(
    (node) => !(node.type === "header" && node.props[EMPTY_STATE] === "empty" && rows) && !(scoreOf && node.type === "separator"),
  );
  if (!scoreOf) return kept.map((node) => ({ node, score: 0 }));
  const fixed: Shown[] = [],
    loose: Shown[] = [],
    groups: Shown[] = [];
  for (const node of kept) {
    if (ROW_TYPES.has(node.type)) loose.push({ node, score: scoreOf(node) });
    else if (node.type === "section") {
      const children = [...collection.getChildren(node.key)];
      const ranked = children
        .filter((child) => ROW_TYPES.has(child.type))
        .map((child) => ({ node: child, score: scoreOf(child) }))
        .sort(byScore);
      const heads = children.filter((child) => !ROW_TYPES.has(child.type)).map((child) => ({ node: child, score: 0 }));
      groups.push({ node, score: ranked[0]?.score ?? 0, children: [...heads, ...ranked] });
    } else fixed.push({ node, score: 0 });
  }
  return [...fixed, ...loose.sort(byScore), ...groups.sort(byScore)];
}

/** A new collection of `shown` in that order, built as React Aria's own `filter` builds one: cloned nodes, re-linked. */
export function relink<C extends RankCollection>(collection: C, shown: Shown[]): C {
  const next = new (collection.constructor as new () => C)();
  const link = (list: Shown[], parentKey: Key | null) =>
    list.forEach(({ node, children }, index) => {
      const clone = node.clone();
      clone.index = index;
      clone.parentKey = parentKey;
      clone.prevKey = list[index - 1]?.node.key ?? null;
      clone.nextKey = list[index + 1]?.node.key ?? null;
      if (children) {
        clone.firstChildKey = children[0]?.node.key ?? null;
        clone.lastChildKey = children.at(-1)?.node.key ?? null;
        next.addNode(clone);
        link(children, clone.key);
      } else next.addDescendants(clone, collection);
    });
  link(shown, null);
  next.commit(shown[0]?.node.key ?? null, shown.at(-1)?.node.key ?? null);
  return next;
}

/** The keys the highlight moves through, in the order shown: each action row, a submenu's by its action row; disabled rows (and
 *  Menu.Item's `aria-disabled` ones, `muted`) are passed over, as Linear's keyboard passes them. */
export function rowKeys(collection: RankCollection): Key[] {
  const keys: Key[] = [];
  const visit = (nodes: Iterable<RankNode>) => {
    for (const node of nodes) {
      if (node.type === "item") {
        if (!node.props.isDisabled && !node.props.muted) keys.push(node.key);
      } else if (node.type === "submenutrigger" && node.firstChildKey != null) keys.push(node.firstChildKey);
      else if (node.type === "section") visit(collection.getChildren(node.key));
    }
  };
  visit(collection);
  return keys;
}

/**
 * Where a key moves the highlight from `at` (an index into the rows, -1 for none) over `count` rows (Linear's handleMoveFocus):
 * `step` rows on, wrapping, or with `clamp` stopping at the ends; from none, the first step lands on an end (↓ the first row, ↑ the
 * last), as a menu opened by the pointer starts with nothing highlighted.
 */
export function stepIndex(at: number, step: number, count: number, clamp = false): number {
  if (!count) return -1;
  if (at < 0) return step > 0 ? 0 : count - 1;
  return clamp ? Math.max(0, Math.min(count - 1, at + step)) : (((at + step) % count) + count) % count;
}
