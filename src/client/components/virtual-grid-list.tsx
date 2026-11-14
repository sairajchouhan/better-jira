import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Button,
  DropIndicator,
  GridList,
  GridListItem,
  isTextDropItem,
  useDragAndDrop,
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
 * is ours: only the rows near the viewport mount, and the selected, focused and dragged rows always stay mounted, so selection
 * scrolling, menu anchors, focus and an in-flight drag keep their element.
 *
 * Moving between rows is the app's, not React Aria's: its ↑/↓/←/→ (and j/k) shortcuts move the selection, which is Linear's
 * focused item, so the keys React Aria's grid would take for its own focus pass to them (`passRowKeysToShortcuts`). The selection
 * shows through React Aria's `data-selected`/`aria-selected` on the row, and a drag of a selected row carries every selected
 * row of its list, as Linear's board does.
 */

/** Keys React Aria's grid moves its own focus with (and stops); the app's shortcuts answer them instead. */
const NAVIGATION = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/**
 * For a React Aria grid's `onKeyDownCapture`: a navigation key pressed on a row, or on a control in it, goes to the app's
 * shortcuts (the document's listeners) instead of React Aria, which would move its own focus and stop the key there. Keys
 * in a field, menu or dialog inside the row stay theirs.
 */
export function passRowKeysToShortcuts(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest("[role=row]") || target.closest('input, textarea, [contenteditable="true"], [role=dialog], [role=menu], [role=listbox]'))
    return;
  if (isShortcutKey(event)) passToShortcuts(event);
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

/** The key a drop at `target` lands before, among `keys` with the dragged ones left out; undefined is the end. */
export function landsBefore(target: DropTarget, keys: readonly string[], dragged: ReadonlySet<string>): string | undefined {
  if (target.type === "root") return undefined;
  const at = keys.indexOf(String(target.key));
  if (at < 0) return undefined;
  const from = target.dropPosition === "after" ? at + 1 : at;
  return keys.slice(from).find((k) => !dragged.has(k));
}

/**
 * The keys a drag of `picked` carries, in list order: with any selected row among them, every selected row of the list,
 * mounted or not (React Aria knows only the mounted ones); else just `picked`.
 */
export function dragKeys(keys: readonly string[], picked: readonly string[], chosen: ReadonlySet<string>): string[] {
  if (!picked.some((key) => chosen.has(key))) return [...picked];
  const set = new Set(picked);
  return keys.filter((key) => chosen.has(key) || set.has(key));
}

/** Drag and drop between every list sharing `type`: rows move by a drop, never onto another row. */
export type ListDrop = {
  /** The drag type the lists share; a list accepts only drags of its own type. */
  type: string;
  /** Dropped `keys` land before `before`, or at the end. */
  onDrop: (keys: string[], before: string | undefined) => void;
  /** The image under the pointer while dragging. */
  renderPreview: (keys: string[]) => ReactNode;
};

const ItemContext = createContext<{ style?: CSSProperties; draggable: boolean } | null>(null);

/** Card heights while a drag is under way: the dragged row's, the size of the gap a list opens where it will land. */
const GAP_VAR = "--drag-gap";

export function VirtualGridList<T>({
  "aria-label": label,
  items,
  itemKey,
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
  /** The app's selected item (Linear's focused one): kept mounted, scrolled to, and shown selected. */
  selected: string | null;
  /** More items shown selected (a column's "Select all"); a drag of any of them carries all. */
  selectedKeys?: ReadonlySet<string>;
  estimate: number;
  drop?: ListDrop;
  /** A key pressed on a row itself (not on a control inside it), before React Aria's own handling. */
  onRowKeyDown?: (key: string, event: KeyboardEvent) => void;
  className?: string;
  /** Renders one item as a `<VirtualGridList.Item>`. */
  children: (item: T) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  // Unknown until the first layout effect measures it, so a new collection mounts no items it would drop before paint.
  const [viewport, setViewport] = useState<{ top: number; bottom: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dragged, setDragged] = useState<ReadonlySet<string>>(() => new Set());
  const startFrame = useRef(0);
  const keys = items.map(itemKey);
  const offsets = [0];
  for (const key of keys) offsets.push(offsets.at(-1)! + (heights.get(key) ?? estimate));
  const measure = () => {
    const node = root.current, parent = scroller.current;
    if (!node || !parent) return;
    const rect = node.getBoundingClientRect(), clip = parent.getBoundingClientRect();
    const top = clip.top - rect.top, bottom = clip.bottom - rect.top;
    setViewport((v) => (v?.top === top && v.bottom === bottom ? v : { top, bottom }));
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
  // Every render re-measures before paint: a layout switch, a collapse or new items never paint a stale window.
  // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    if (!list.current) return;
    const observer = new ResizeObserver((entries) =>
      setHeights((current) => {
        let next: Map<string, number> | null = null;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.key!;
          const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
          if (height <= 0 || current.get(key) === height) continue;
          if (!next) next = new Map(current);
          next.set(key, height);
        }
        return next ?? current;
      }),
    );
    for (const child of list.current.querySelectorAll<HTMLElement>(":scope > [data-key]")) observer.observe(child);
    return () => observer.disconnect();
  });
  // Many groups or lanes share one viewport, so each windows itself, however short: most sit outside it.
  const overscan = estimate * 4, top = viewport ? viewport.top - overscan : 0, bottom = viewport ? viewport.bottom + overscan : 0;
  const [start, end] = windowOf(offsets, top, bottom);
  const pinned = new Set(
    [selected, focused, ...dragged].map((key) => keys.indexOf(key!)).filter((index) => index >= 0 && (index < start || index >= end)),
  );
  // Pinned items keep their place in DOM order, so Tab and the arrow keys move on from them towards the window.
  const rendered = [
    ...[...pinned].filter((index) => index < start).sort((a, b) => a - b),
    ...Array.from({ length: end - start }, (_, index) => start + index),
    ...[...pinned].filter((index) => index >= end).sort((a, b) => a - b),
  ];
  // A selection made while its item was outside the window scrolls to the item's estimated place; once the window
  // reaches it and it takes its measured place, it is scrolled to once more. Scrolling back later never snaps to it.
  const selectedPinned = selected !== null && [...pinned].some((index) => keys[index] === selected);
  const settling = useRef<string | null>(null);
  useLayoutEffect(() => { settling.current = selectedPinned ? selected : null; }, [selected]); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies
  useLayoutEffect(() => {
    if (!selected || settling.current !== selected || selectedPinned) return;
    settling.current = null;
    list.current?.querySelector(`:scope > [data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  });

  const chosen = new Set(selectedKeys);
  if (selected) chosen.add(selected);
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
    getItems: (picked) => dragKeys(keys, [...picked].map(String), chosen).map((key) => ({ [drop!.type]: key, "text/plain": key })),
    renderDragPreview: (dragging) => <>{drop!.renderPreview(dragging.map((item) => item[drop!.type]!))}</>,
    renderDropIndicator: (target) => <DropIndicator target={target} className="ui-drop-gap" />,
    dropTargetDelegate: delegate,
    acceptedDragTypes: drop ? [drop.type] : [],
    getDropOperation: (target) => (target.type === "item" && target.dropPosition === "on" ? "cancel" : "move"),
    onDragStart: (event) => {
      const moving = new Set([...event.keys].map(String));
      const row = list.current?.querySelector(`:scope > [data-key="${CSS.escape([...moving][0]!)}"]`);
      if (row) document.documentElement.style.setProperty(GAP_VAR, `${row.getBoundingClientRect().height}px`);
      // A frame later, as React Aria marks the rows dragging: Chrome ends a drag whose source changes during dragstart.
      startFrame.current = requestAnimationFrame(() => setDragged(moving));
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
      <GridList
        ref={list}
        aria-label={label}
        // A letter is one of Linear's issue shortcuts on the focused row, never a jump to a row starting with it.
        disallowTypeAhead
        // The app owns the selection: React Aria only shows it, and its own changes (a click, Escape) are ignored.
        selectionMode="multiple"
        selectedKeys={chosen}
        onSelectionChange={ignore}
        escapeKeyBehavior="none"
        dragAndDropHooks={drop ? dragAndDropHooks : undefined}
        className="ui-virtual-grid"
        style={{ paddingTop: offsets[start], paddingBottom: offsets.at(-1)! - offsets[end]!, flexGrow: 1 }}
      >
        {rendered.map((index) => (
          <ItemContext
            key={keys[index]}
            value={{ draggable: !!drop, style: pinned.has(index) ? { position: "absolute", top: offsets[index], width: "100%" } : undefined }}
          >
            {children(items[index]!)}
          </ItemContext>
        ))}
      </GridList>
    </div>
  );
}

const ignore = () => {};

/** One row: `id` is the item's key (its `data-key`), `textValue` its accessible name; `data-menu` marks it while its
 *  right-click menu is open. Its state is on the row (`data-selected`, `data-menu`, `data-focus-visible`, `data-dragging`),
 *  for the look inside (`in-data-*`). Draggable rows carry React Aria's drag button, visually hidden, for screen readers;
 *  the keyboard moves rows with the app's ⌥ arrow commands, as Linear's board does. */
function Item({
  id,
  textValue,
  className,
  "data-menu": menu,
  children,
}: {
  id: string;
  textValue: string;
  className?: string;
  "data-menu"?: boolean;
  children: ReactNode;
}) {
  const context = use(ItemContext);
  if (!context) throw new Error("VirtualGridList.Item renders inside VirtualGridList");
  return (
    <GridListItem
      id={id}
      data-key={id}
      data-menu={menu || undefined}
      textValue={textValue}
      className={`ui-virtual-row ${className ?? ""}`}
      style={context.style}
    >
      {context.draggable && <Button slot="drag" className="sr-only" />}
      {children}
    </GridListItem>
  );
}

VirtualGridList.Item = Item;
