import {
  createContext,
  memo,
  startTransition,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Button,
  CollectionRendererContext,
  DefaultCollectionRenderer,
  DropIndicator,
  GridList,
  GridListItem,
  isTextDropItem,
  useDragAndDrop,
  type CollectionRenderer,
  type DropTarget,
} from "react-aria-components";
import "./virtual-grid-list.css";

/**
 * A React Aria `GridList` windowed within the scroll container it sits in (BJ-111), with React Aria's drag and drop.
 *
 * React Aria gives the rows their grid semantics (`row`/`gridcell`, so a card's badges and links are valid children), the
 * roving tab stop Linear's board items have, keyboard and screen-reader drag and drop, and the native mouse drag.
 *
 * Not React Aria's `Virtualizer`, which needs the collection to own its scroll container and places every row and drop
 * indicator absolutely: lists and swimlanes window many groups against one shared scroller with sticky headers, and Linear's
 * board opens a gap where a card will land (IssueList `Ll`), which an absolutely placed indicator can't do. So the window
 * is ours, through React Aria's own seam for it (`CollectionRendererContext`): the collection holds every item, built once,
 * and only the rows near the viewport render, in flow between spacers. The selected, focused, dragged and drop-target rows
 * always render, at their place in the list, so selection scrolling, menu anchors, focus and an in-flight drag keep their
 * element. A scroll never changes the collection, so the rows already mounted never re-render (Linear's board column is
 * windowed the same way, IssueList.CUOYX8Am.js `ju`/`wu`).
 *
 * Moving between rows is the app's, not React Aria's: its ↑/↓/←/→ (and j/k) shortcuts move the selection, which is Linear's
 * focused item, so the keys React Aria's grid would take for its own focus pass to them (`passRowKeysToShortcuts`). The selection
 * is the app's alone: React Aria's grid has no selection (`selectionMode` none), and each row draws the app's as
 * `data-selected`/`aria-selected`. A grid whose selection React Aria may not change can't be handed to it: after a drop that
 * adds rows to a list, React Aria selects them, and a controlled selection that ignores the change re-renders it forever
 * (React error #185, the whole app gone). A drag of a selected row carries every selected row of its list, as Linear's board does.
 */

/** Keys React Aria's grid moves its own focus with (and stops); the app's shortcuts answer them instead. */
const NAVIGATION = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/**
 * For a React Aria grid's `onKeyDownCapture`: a navigation key pressed on a row, or on a control in it, goes to the app's
 * shortcuts (the document's listeners) instead of React Aria, which would move its own focus and stop the key there. Keys
 * in a field, menu or dialog inside the row stay theirs.
 */
export function passRowKeysToShortcuts(event: KeyboardEvent) {
  if (ownsKey(event.target as HTMLElement) && isShortcutKey(event)) passToShortcuts(event);
}

/**
 * Whether a key on `target` is the app's: on an item row (React Aria gives each its `data-key`) or a control in it, outside any
 * field, menu or dialog there. A drop target of React Aria's keyboard drag is a row too, but has no key: its arrows pick
 * where the drag lands and must never also move the app's selection.
 */
export function ownsKey(target: Pick<Element, "closest">) {
  return !!target.closest("[role=row][data-key]") && !target.closest('input, textarea, [contenteditable="true"], [role=dialog], [role=menu], [role=listbox]');
}

/** A key React Aria's grid takes for its own focus or selection: the arrows, Home/End, Page Up/Down and ⌘A/Ctrl+A. */
export const isShortcutKey = (event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">) =>
  NAVIGATION.has(event.key) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a");

/** Hands a key to the document's shortcut listeners, which React Aria's handlers would stop it reaching. */
function passToShortcuts(event: KeyboardEvent) {
  event.stopPropagation();
  const { key, code, altKey, ctrlKey, metaKey, shiftKey, repeat } = event;
  const copy = new globalThis.KeyboardEvent("keydown", { key, code, altKey, ctrlKey, metaKey, shiftKey, repeat, bubbles: true, cancelable: true });
  if (!document.dispatchEvent(copy)) event.preventDefault();
}

type DropTargetDelegate = NonNullable<Parameters<typeof useDragAndDrop>[0]["dropTargetDelegate"]>;
type Row = { key: string; top: number; bottom: number };
type Gap = { top: number; height: number };
export type DropSpot = { key: string; position: "before" | "after" };

/**
 * Where a drop at `y` lands among the mounted `rows` (in order, relative to the list's top), ignoring the gap already opened
 * for the current target: rows below the gap are measured where they sit without it, so opening the gap never moves the
 * target (no flicker). A collapsed row (the dragged one, `bottom === top`) is skipped. Null: the list is empty.
 */
export function dropSpotAt(y: number, rows: readonly Row[], gap: Gap | null): DropSpot | null {
  const live = rows.filter((r) => r.bottom > r.top);
  if (!live.length) return null;
  if (gap) y = y >= gap.top + gap.height ? y - gap.height : Math.min(y, gap.top);
  for (const r of live) {
    const shift = gap && r.top >= gap.top - 0.5 ? gap.height : 0;
    if (y < (r.top + r.bottom) / 2 - shift) return { key: r.key, position: "before" };
  }
  return { key: live.at(-1)!.key, position: "after" };
}

/** The items `[start, end)` that reach into `top`–`bottom`, from `offsets` (each item's top, then the total height). */
export function windowOf(offsets: readonly number[], top: number, bottom: number): [number, number] {
  const count = offsets.length - 1;
  let start = 0;
  while (start < count && offsets[start + 1]! < top) start++;
  let end = start;
  while (end < count && offsets[end]! < bottom) end++;
  return [start, end];
}

/** The part of a list's box its scroller shows, relative to the list's top (it may start above 0 or end past the list). */
export type Viewport = { top: number; bottom: number };

/** Overscan behind the scroll, and the least a mounted range may cover past the viewport before it moves (Linear: 400). */
const NEAR = 400;
/** The most overscan ahead of the scroll, and the farthest a mounted range may reach past the viewport (Linear: 1200). */
const FAR = 1200;

/**
 * The items to mount for `view`, Linear's board column window (IssueList.CUOYX8Am.js `wu.rangeForViewport`): the mounted
 * `current` range stays while it still covers 400px past either edge of the viewport and reaches no more than 1200px past
 * it, so most scroll frames change nothing and render nothing. A new range overscans 400px behind the scroll and, ahead of
 * it, the viewport's height or twice the scroll step, between 400px and 1200px. `previousTop` is the viewport's last top
 * (its direction and speed); null before the first measure.
 */
export function rangeFor(offsets: readonly number[], current: readonly [number, number] | null, view: Viewport, previousTop: number | null): [number, number] {
  const count = offsets.length - 1, total = offsets[count]!;
  if (current) {
    const end = Math.min(current[1], count), from = offsets[Math.min(current[0], end)]!, to = offsets[end]!;
    if (from <= Math.max(0, view.top - NEAR) && to >= Math.min(total, view.bottom + NEAR) && from >= view.top - FAR && to <= view.bottom + FAR)
      return [Math.min(current[0], end), end];
  }
  const step = previousTop === null ? 0 : view.top - previousTop;
  const ahead = Math.min(FAR, Math.max(NEAR, view.bottom - view.top, Math.abs(step) * 2));
  return step < 0 ? windowOf(offsets, view.top - ahead, view.bottom + NEAR) : windowOf(offsets, view.top - NEAR, view.bottom + ahead);
}

/** Whether the mounted `range` shows everything the viewport does: if not, moving it can't wait (Linear's urgent update). */
export function covers(offsets: readonly number[], range: readonly [number, number] | null, view: Viewport) {
  const count = offsets.length - 1, total = offsets[count]!;
  const top = Math.max(0, view.top), bottom = Math.min(total, view.bottom);
  if (bottom <= top) return true;
  if (!range) return false;
  const end = Math.min(range[1], count);
  return offsets[Math.min(range[0], end)]! <= top && offsets[end]! >= bottom;
}

/**
 * Whether a drop at `target` is allowed in a list of `count` rows: between rows, never onto one; the list itself (its root)
 * only when it has no row to land by. React Aria's keyboard drag steps through every allowed target, so an allowed root in a
 * list with rows was a stop past its first and last rows that dropped at the end, which read as ↑ wrapping to the bottom.
 */
export function dropOperation(target: DropTarget, count: number): "move" | "cancel" {
  if (target.type === "root") return count ? "cancel" : "move";
  return target.dropPosition === "on" ? "cancel" : "move";
}

/** The key a drop at `target` lands before, among `keys` with the dragged ones left out; undefined is the end. */
export function landsBefore(target: DropTarget, keys: readonly string[], dragged: ReadonlySet<string>): string | undefined {
  if (target.type === "root") return undefined;
  const at = keys.indexOf(String(target.key));
  if (at < 0) return undefined;
  const from = target.dropPosition === "after" ? at + 1 : at;
  return keys.slice(from).find((k) => !dragged.has(k));
}

/**
 * What a drag of `picked` does, as Linear's IssueList drag (`_l`): with any multi-selected row among them it carries every
 * selected row of the list, mounted or not (React Aria knows only the mounted ones), in list order; else it carries just
 * `picked` and clears the selection. The focused row (`selected`) is not part of the selection, as Linear's
 * `selectedItems` leaves out its focused item.
 */
export function dragOf(
  keys: readonly string[],
  picked: readonly string[],
  selection: ReadonlySet<string>,
): { moving: string[]; clearsSelection: boolean } {
  if (!picked.some((key) => selection.has(key))) return { moving: [...picked], clearsSelection: selection.size > 0 };
  const set = new Set(picked);
  return { moving: keys.filter((key) => selection.has(key) || set.has(key)), clearsSelection: false };
}
const NO_KEYS: ReadonlySet<string> = new Set();

/** Drag and drop between every list sharing `type`: rows move by a drop, never onto another row. */
export type ListDrop = {
  /** The drag type the lists share; a list accepts only drags of its own type. */
  type: string;
  /** Dropped `keys` land before `before`, or at the end. */
  onDrop: (keys: string[], before: string | undefined) => void;
  /** The image under the pointer while dragging. */
  renderPreview: (keys: string[]) => ReactNode;
  /** Empties the list's `selectedKeys`: a drag of a row outside them leaves them, as Linear's drag start does. */
  clearSelection: () => void;
};

/** The space to leave above each mounted item (`indices`, ascending) so it sits at its offset, then the space below the last. */
export function flowOf(offsets: readonly number[], indices: readonly number[]): { rows: { index: number; gap: number }[]; tail: number } {
  let cursor = 0;
  const rows = indices.map((index) => {
    const gap = offsets[index]! - offsets[cursor]!;
    cursor = index + 1;
    return { index, gap };
  });
  return { rows, tail: offsets.at(-1)! - offsets[cursor]! };
}

/** The items to render: the window `[start, end)` and every `pinned` index outside it, ascending (DOM order is list order). */
export function mountedIndices(start: number, end: number, pinned: Iterable<number>): number[] {
  const outside = new Set([...pinned].filter((index) => index >= 0 && (index < start || index >= end)));
  return [
    ...[...outside].filter((index) => index < start).sort((a, b) => a - b),
    ...Array.from({ length: end - start }, (_, index) => start + index),
    ...[...outside].filter((index) => index >= end).sort((a, b) => a - b),
  ];
}

/**
 * The rows React Aria shows selected: `selectedKeys` and the app's `selected` item, when it is one of this list's (`index`).
 * The selection moving between other lists leaves this one's set, and so its rows, untouched.
 */
export function chosenKeys(selectedKeys: ReadonlySet<string> | undefined, selected: string | null, index: ReadonlyMap<string, number>): Set<string> {
  const set = new Set(selectedKeys);
  if (selected !== null && index.has(selected)) set.add(selected);
  return set;
}

/** What the list's collection renderer needs to window it: keys in order, offsets, the range and the keys always rendered. */
type Window = { keys: readonly string[]; index: ReadonlyMap<string, number>; offsets: readonly number[]; start: number; end: number; pinned: readonly (string | null)[] };
const WindowContext = createContext<Window | null>(null);

type RootProps = ComponentProps<CollectionRenderer["CollectionRoot"]>;
type CollectionNode = RootProps["collection"] extends Iterable<infer N> ? N : never;

/** React Aria's collection renderer, windowed: the mounted rows, each after the space the rows above it would take. */
function WindowRoot({ collection, persistedKeys, renderDropIndicator }: RootProps) {
  const w = use(WindowContext);
  if (!w) throw new Error("The windowed renderer renders inside VirtualGridList");
  const pinned = [...w.pinned, ...(persistedKeys ?? [])].map((key) => (key == null ? -1 : (w.index.get(String(key)) ?? -1)));
  const { rows, tail } = flowOf(w.offsets, mountedIndices(w.start, w.end, pinned));
  return (
    <>
      {rows.map(({ index, gap }) => {
        const node = collection.getItem(w.keys[index]!);
        return node ? (
          <WindowItem key={node.key} gap={gap}>
            <WindowRow node={node} renderDropIndicator={renderDropIndicator} />
          </WindowItem>
        ) : null;
      })}
      {tail > 0 && <Spacer height={tail} />}
    </>
  );
}

function WindowItem({ gap, children }: { gap: number; children: ReactNode }) {
  return (
    <>
      {gap > 0 && <Spacer height={gap} />}
      {children}
    </>
  );
}

function Spacer({ height }: { height: number }) {
  return <div aria-hidden role="presentation" className="ui-virtual-spacer" style={{ height }} />;
}

/** One row with its drop indicators, React Aria's default per item; the row itself re-renders only when its node changes. */
const WindowRow = memo(function WindowRow({ node, renderDropIndicator }: { node: CollectionNode; renderDropIndicator: RootProps["renderDropIndicator"] }) {
  const row = useMemo(() => node.render?.(node), [node]);
  return (
    <>
      {renderDropIndicator?.({ type: "item", key: node.key, dropPosition: "before" })}
      {row}
      {node.nextKey == null && renderDropIndicator?.({ type: "item", key: node.key, dropPosition: "after" })}
    </>
  );
});

const WINDOWED: CollectionRenderer = { ...DefaultCollectionRenderer, CollectionRoot: WindowRoot };

/** Card heights while a drag is under way: the dragged row's, the size of the gap a list opens where it will land. */
const GAP_VAR = "--drag-gap";

export function VirtualGridList<T>({
  "aria-label": label,
  items,
  itemKey,
  itemText,
  rowClassName,
  selected,
  selectedKeys,
  estimate,
  drop,
  onRowKeyDown,
  className,
  children,
}: {
  "aria-label": string;
  items: T[];
  itemKey: (item: T) => string;
  /** A row's accessible name. */
  itemText: (item: T) => string;
  /** Each row's own classes, around its content (a card's 8px gap). */
  rowClassName?: string;
  /** The app's selected item (Linear's focused one): kept mounted, scrolled to, and shown selected. */
  selected: string | null;
  /** More items shown selected (a column's "Select all"); a drag of any of them carries all, a drag of another clears them
   *  (`drop.clearSelection`). */
  selectedKeys?: ReadonlySet<string>;
  estimate: number;
  drop?: ListDrop;
  /** A key pressed on a row itself (not on a control inside it), before React Aria's own handling. */
  onRowKeyDown?: (key: string, event: KeyboardEvent) => void;
  className?: string;
  /** One row's content. The row is the list's: React Aria's, with its state on it (`data-selected`, `data-focus-visible`,
   *  `data-dragging`) for the look inside (`in-data-*`). Keep it stable (no per-render props): every item renders it. */
  children: (item: T) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  // The mounted items `[start, end)`. Null until the first layout effect measures the viewport, so a new collection mounts
  // no items it would drop before paint. Only a change of range renders: a scroll within it renders nothing.
  const [range, setRange] = useState<readonly [number, number] | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dragged, setDragged] = useState<ReadonlySet<string>>(() => new Set());
  const startFrame = useRef(0);
  const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const index = useMemo(() => new Map(keys.map((key, i) => [key, i])), [keys]);
  const offsets = useMemo(() => {
    const result = [0];
    for (const key of keys) result.push(result.at(-1)! + (heights.get(key) ?? estimate));
    return result;
  }, [keys, heights, estimate]);
  // What the scroll handler reads between renders: the latest offsets, the range last asked for and the viewport's last top.
  const geometry = useRef({ offsets, range, top: null as number | null });
  const measure = () => {
    const node = root.current, parent = scroller.current;
    if (!node || !parent) return;
    const rect = node.getBoundingClientRect(), clip = parent.getBoundingClientRect();
    const view = { top: clip.top - rect.top, bottom: clip.bottom - rect.top };
    const g = geometry.current;
    const next = rangeFor(g.offsets, g.range, view, g.top);
    const urgent = !covers(g.offsets, g.range, view);
    g.top = view.top;
    if (g.range?.[0] === next[0] && g.range[1] === next[1]) return;
    g.range = next;
    // Rows the viewport already shows can wait for the browser to paint the scroll; a blank viewport can't (Linear's
    // `startTransition` and `flushSync` split).
    if (urgent) setRange(next);
    else startTransition(() => setRange(next));
  };
  useLayoutEffect(() => {
    let parent = root.current!.parentElement;
    while (parent && !/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    if (!parent) return;
    scroller.current = parent;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    parent.addEventListener("scroll", schedule, { passive: true });
    // A sibling group, lane or column that measures or collapses moves this one without a scroll.
    // ponytail: children present at mount only; a group added later is caught by the per-render measure below.
    const resize = new ResizeObserver(schedule);
    resize.observe(parent);
    for (const child of parent.children) resize.observe(child);
    return () => { parent.removeEventListener("scroll", schedule); resize.disconnect(); cancelAnimationFrame(frame); scroller.current = null; };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- `measure` reads refs only.
  }, []);
  // Every render re-measures before paint, against its own offsets: a layout switch, a collapse or new items never paint a
  // stale window.
  useLayoutEffect(() => {
    geometry.current.offsets = offsets;
    measure();
  });
  // One observer for the list's life, told about each row as it mounts: re-observing every row on every render would report
  // every row again each time.
  const sizes = useRef<{ observer: ResizeObserver; rows: Set<Element> } | null>(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const measured: [string, number][] = [];
      for (const entry of entries) {
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (height > 0) measured.push([(entry.target as HTMLElement).dataset.key!, height]);
      }
      setHeights((current) => {
        const changed = measured.filter(([key, height]) => current.get(key) !== height);
        return changed.length ? new Map([...current, ...changed]) : current;
      });
    });
    sizes.current = { observer, rows: new Set() };
    return () => { observer.disconnect(); sizes.current = null; };
  }, []);
  useLayoutEffect(() => {
    const node = list.current, s = sizes.current;
    if (!node || !s) return;
    for (const row of s.rows) if (row.parentElement !== node) { s.observer.unobserve(row); s.rows.delete(row); }
    for (const row of node.querySelectorAll(":scope > [data-key]")) if (!s.rows.has(row)) { s.observer.observe(row); s.rows.add(row); }
  });
  const count = keys.length;
  const end = range ? Math.min(range[1], count) : 0, start = range ? Math.min(range[0], end) : 0;
  const windowed = useMemo<Window>(
    () => ({ keys, index, offsets, start, end, pinned: [selected, focused, ...dragged] }),
    [keys, index, offsets, start, end, selected, focused, dragged],
  );

  // The selection scrolls into view. One made while its item was outside the window scrolls to the item's estimated place;
  // once the window reaches it and it takes its measured place, it is scrolled to once more. Scrolling back later never
  // snaps to it.
  const at = selected === null ? -1 : (index.get(selected) ?? -1);
  const selectedOutside = at >= 0 && (at < start || at >= end);
  const settling = useRef<string | null>(null);
  const row = (key: string) => list.current?.querySelector(`:scope > [data-key="${CSS.escape(key)}"]`);
  useLayoutEffect(() => {
    settling.current = selectedOutside ? selected : null;
    if (selected) row(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies
  useLayoutEffect(() => {
    if (!selected || settling.current !== selected || selectedOutside) return;
    settling.current = null;
    row(selected)?.scrollIntoView({ block: "nearest" });
  });

  // This list's own selection: another list's selected item never changes this one's React Aria state.
  const own = at >= 0 ? selected : null;
  const chosen = useMemo(() => chosenKeys(selectedKeys, own, index), [selectedKeys, own, index]);
  // The drop target under the pointer, from the mounted rows as they sit without the gap opened for the current target.
  const delegate: DropTargetDelegate = {
    getDropTargetFromPoint(_x, y, isValid) {
      const node = list.current;
      if (!node) return null;
      const origin = node.getBoundingClientRect().top;
      const rows = [...node.querySelectorAll<HTMLElement>(":scope > [data-key]")].map((row) => {
        const r = row.getBoundingClientRect();
        return { key: row.dataset.key!, top: r.top - origin, bottom: r.bottom - origin };
      });
      const open = node.querySelector<HTMLElement>(":scope > .ui-drop-gap[data-drop-target]")?.getBoundingClientRect();
      const spot = dropSpotAt(y, rows, open?.height ? { top: open.top - origin, height: open.height } : null);
      const target: DropTarget = spot ? { type: "item", key: spot.key, dropPosition: spot.position } : { type: "root" };
      return isValid(target) ? target : null;
    },
  };
  const { dragAndDropHooks } = useDragAndDrop<T>({
    isDisabled: !drop,
    getItems: (picked) =>
      dragOf(keys, [...picked].map(String), selectedKeys ?? NO_KEYS).moving.map((key) => ({ [drop!.type]: key, "text/plain": key })),
    renderDragPreview: (dragging) => <>{drop!.renderPreview(dragging.map((item) => item[drop!.type]!))}</>,
    renderDropIndicator: (target) => <DropIndicator target={target} className="ui-drop-gap" />,
    dropTargetDelegate: delegate,
    acceptedDragTypes: drop ? [drop.type] : [],
    getDropOperation: (target) => dropOperation(target, keys.length),
    onDragStart: (event) => {
      // React Aria knows no selection, so it names the picked row alone: the drag carries the app's selection with it.
      const plan = dragOf(keys, [...event.keys].map(String), selectedKeys ?? NO_KEYS);
      const moving = new Set(plan.moving);
      const row = list.current?.querySelector(`:scope > [data-key="${CSS.escape(plan.moving[0]!)}"]`);
      if (row) document.documentElement.style.setProperty(GAP_VAR, `${row.getBoundingClientRect().height}px`);
      // A frame later, as React Aria marks the rows dragging: Chrome ends a drag whose source changes during dragstart.
      startFrame.current = requestAnimationFrame(() => {
        setDragged(moving);
        if (plan.clearsSelection) drop!.clearSelection();
      });
    },
    onDragEnd: () => {
      cancelAnimationFrame(startFrame.current);
      setDragged(new Set());
      document.documentElement.style.removeProperty(GAP_VAR);
    },
    onDrop: async (event) => {
      const moving = await Promise.all(
        event.items.filter(isTextDropItem).filter((item) => item.types.has(drop!.type)).map((item) => item.getText(drop!.type)),
      );
      if (moving.length) drop!.onDrop(moving, landsBefore(event.target, keys, new Set(moving)));
    },
  });

  // Every item is in the collection, each its own memoised element: a scroll, a measure or a selection never builds it again.
  const draggable = !!drop;
  // A row re-renders only when its own selected or dragged state flips.
  const rows = items.map((item, i) => (
    <Row
      key={keys[i]}
      id={keys[i]!}
      item={item}
      text={itemText}
      className={rowClassName}
      draggable={draggable}
      chosen={chosen.has(keys[i]!)}
      dragging={dragged.has(keys[i]!)}
      content={children}
    />
  ));
  return (
    <div
      ref={root}
      data-virtual-items
      className={className}
      // A column: the list grows to the room left, so a drop below the last row still lands in it.
      style={{ position: "relative", overflowAnchor: "none", display: "flex", flexDirection: "column" }}
      onFocus={(event: FocusEvent) =>
        setFocused((event.target as Element).closest<HTMLElement>("[data-key]")?.dataset.key ?? null)
      }
      onBlur={(event: FocusEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
      }}
      // Capture: React Aria's press handling stops Enter and Space on a row from bubbling.
      onKeyDownCapture={(event) => {
        const row = event.target as HTMLElement;
        if (row.getAttribute("role") === "row" && row.dataset.key) onRowKeyDown?.(row.dataset.key, event);
        if (!event.isPropagationStopped()) passRowKeysToShortcuts(event);
      }}
    >
      <CollectionRendererContext value={WINDOWED}>
        <WindowContext value={windowed}>
          <GridList
            ref={list}
            aria-label={label}
            // A letter is one of Linear's issue shortcuts on the focused row, never a jump to a row starting with it.
            disallowTypeAhead
            // No selectionMode: the app owns the selection and each row draws it (see the top of this file).
            escapeKeyBehavior="none"
            // Always the hooks, off by `isDisabled` with no `drop`: GridList calls more hooks with them than without, so
            // swapping them for undefined when `drop` changed would crash the list (React #311).
            dragAndDropHooks={dragAndDropHooks}
            className="ui-virtual-grid"
            style={GROW}
          >
            {rows}
          </GridList>
        </WindowContext>
      </CollectionRendererContext>
    </div>
  );
}

const GROW = { flexGrow: 1 };

type RowProps<T> = {
  id: string;
  item: T;
  text: (item: T) => string;
  className?: string;
  draggable: boolean;
  /** In the app's selection: drawn as React Aria draws its own (`data-selected`, `aria-selected`). */
  chosen: boolean;
  /** Carried by the drag under way, though React Aria only drags the picked row: hidden as that one is (`data-dragging`). */
  dragging: boolean;
  content: (item: T) => ReactNode;
};

/** One item of the collection: React Aria's row, its `id` the item's key (its `data-key`), named by `text`. Memoised, so an
 *  unchanged item never tells React Aria's collection anything new. Draggable rows carry React Aria's drag button, visually
 *  hidden, for screen readers; the keyboard moves rows with the app's ⌥ arrow commands, as Linear's board does. React Aria
 *  writes its own `data-selected` and `data-dragging` last, so the row's element (`render`) sets the app's over them. */
const Row = memo(function Row<T>({ id, item, text, className, draggable, chosen, dragging, content }: RowProps<T>) {
  return (
    <GridListItem
      id={id}
      data-key={id}
      textValue={text(item)}
      className={`ui-virtual-row ${className ?? ""}`}
      render={(props) => (
        <div
          {...props}
          data-selected={chosen || undefined}
          aria-selected={chosen}
          data-dragging={dragging || (props as { "data-dragging"?: boolean })["data-dragging"] || undefined}
        />
      )}
    >
      {draggable && <Button slot="drag" className="sr-only" />}
      {content(item)}
    </GridListItem>
  );
}) as <T>(props: RowProps<T>) => ReactNode;
