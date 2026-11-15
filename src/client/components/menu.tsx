/* oxlint-disable react/refs -- Rows, popups and the level's shared state are read from refs in event handlers and layout effects. */
import { Throttler } from "@tanstack/pacer";
import {
  createContext,
  use,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ContextType,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  Autocomplete,
  CollectionRendererContext,
  Header,
  Input,
  ListLayout,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection,
  MenuStateContext,
  Popover as AriaPopover,
  PopoverContext,
  RootMenuTriggerStateContext,
  Separator,
  SubmenuTrigger,
  TextField,
  Virtualizer,
  type Key,
  type Rect,
} from "react-aria-components";
import { Icon } from "./icons";
import { MenuSurfaceContext, placedProps, watchPlacement } from "./menu-surface";
import { LIMIT_HEIGHT, LIMIT_ROWS, LIMIT_ROWS_HEIGHT, MENU, menuRoom, settle, submenuPlacement } from "./menu-geometry";
import { arrange, EMPTY_STATE, relink, rowKeys, stepIndex, type RankCollection, type RankNode } from "./menu-rank";
import { openedByPointer } from "./menu-pristine";
import { keyboardMode, movedPointer } from "./pointer-intent";
import { isMac, Shortcut, type Keys } from "./keycap";
import { NO_AUTOFILL } from "@/client/components/field";
import { menuFilter } from "@/client/lib/fuzzy-score";
import { safeTriangle, TRIANGLE_EXPIRY, triangleStays } from "./safe-triangle";
import { heldKey, keyUpMark, menuKey, navigates, NO_KEYUP } from "./menu-keys";

// The geometry lives on its own so menu-surface.tsx can share it without importing this module back.
export { MENU, menuRoom };

/**
 * How wide a menu is (Linear's `k3e`, which `IB` calls with `fixedWidth`, `customMinWidth` and `customMaxWidth`): its widest
 * rendered row (`Math.ceil(Math.max(rect.width, scrollWidth))` of each `[data-list-row]`), at most `Vw.ITEM_MAX_WIDTH` for the whole
 * row, at least its minimum, and only ever growing while it is open: nothing (undefined) when no row is wider than `current`.
 */
export function grownWidth(widths: number[], current: number | undefined, min: number): number | undefined {
  if (!widths.length) return undefined;
  const widest = widths.reduce((max, width) => Math.max(max, Math.ceil(width)), 0);
  if (widest <= (current ?? 0)) return undefined;
  return Math.min(Math.max(min, MENU.ITEM_MAX_WIDTH), Math.max(widest, current ?? min));
}

/** Linear's list `overscanCount`: rows rendered past each end of the visible ones. */
export const OVERSCAN = 10;

/**
 * The rows Linear's virtualized list (react-window, `overscanCount: 10`) renders, and so the only ones `k3e` measures: those crossing
 * the visible band `clip` and `overscan` more either side, as [start, end) indexes into `rows` (in list order). With none on screen,
 * the first ones, as a list scrolled to its top renders.
 */
export function renderedRows(
  rows: readonly { top: number; bottom: number }[],
  clip: { top: number; bottom: number },
  overscan = OVERSCAN,
): [number, number] {
  let first = -1,
    last = -1;
  rows.forEach((row, index) => {
    if (row.bottom <= clip.top || row.top >= clip.bottom) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return [0, Math.min(rows.length, overscan + 1)];
  return [Math.max(0, first - overscan), Math.min(rows.length, last + 1 + overscan)];
}

/**
 * Linear's list is react-window with `overscanCount: 10`; React Aria's Virtualizer lays a menu's rows out with ListLayout, which
 * renders only the rows crossing the visible band. This one renders OVERSCAN rows past each end as well, so a menu renders what
 * Linear's renders (and k3e measures the same rows).
 */
export class MenuLayout extends ListLayout<unknown> {
  override getVisibleLayoutInfos(rect: Rect) {
    return super.getVisibleLayoutInfos(overscanned(rect));
  }
  /** A divider is always DIVIDER_HEIGHT. ListLayout forgets every row's measured size when the list's width changes (k3e widening
   *  the menu) and estimates the rows not rendered at a row's height again, so a scrolled list's divider above counted 32px, not 12:
   *  the list grew 20px under a list scrolled to its end, and its last row sat cut off below it. */
  protected override buildItem(...args: Parameters<ListLayout<unknown>["buildNode"]>) {
    const built = super.buildItem(...args);
    if (args[0].type !== "separator") return built;
    built.layoutInfo.rect.height = MENU.DIVIDER_HEIGHT;
    built.layoutInfo.estimatedSize = false;
    built.validRect = built.layoutInfo.rect.intersection(this.requestedRect);
    return built;
  }
}
/** `rect` grown by OVERSCAN rows above and below, never above the list's top. */
export function overscanned<R extends { y: number; height: number; copy(): R }>(rect: R, rows = OVERSCAN): R {
  const band = rect.copy(),
    pad = rows * MENU.ITEM_HEIGHT;
  band.y = Math.max(0, rect.y - pad);
  band.height = rect.y + rect.height + pad - band.y;
  return band;
}
const LAYOUT = { estimatedRowHeight: MENU.ITEM_HEIGHT, estimatedHeadingHeight: 30 };

// What k3e measures: Linear's `[data-list-row]`, which its search row, action rows and empty state carry.
const LIST_ROWS = ".menu-input, .menu-item, .menu-empty, [data-list-row]";

/** The menu `node`'s own list (a submenu's list is inside its popup, portalled elsewhere, but a menu inline in a row may nest). */
const ownList = (node: HTMLElement) =>
  [...node.querySelectorAll<HTMLElement>(".menu-list")].find((list) => list.closest(".menu") === node) ?? null;
/** The menu `node`'s own search field. */
const ownInput = (node: HTMLElement | null) =>
  node
    ? ([...node.querySelectorAll<HTMLInputElement>(".menu-input input")].find((input) => input.closest(".menu") === node) ??
      null)
    : null;

/** The band of the window `node` shows: the window, cut by every ancestor that clips its overflow up to the first fixed one. */
function visibleBand(node: Element) {
  let top = 0,
    bottom = innerHeight;
  for (let element: Element | null = node; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.overflowY !== "visible") {
      const box = element.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
    if (style.position === "fixed") break;
  }
  return { top, bottom };
}

/**
 * One `k3e` measure of the menu `node`: the rows Linear's list would render, each at its own content width (`min-content`, k3e's
 * `--item-min-width`), grow its min-width (`floor` is its CSS minimum, raised to Vw.ITEM_MIN_WIDTH_WITH_DESCRIPTION by a description
 * row: k3e's `customMinWidth`). Returns the new width, or undefined when it stays.
 */
function fitRows(node: HTMLElement, current: number | undefined, floor: number) {
  const rows = [...node.querySelectorAll<HTMLElement>(LIST_ROWS)].filter(
    (row) => row.closest(".menu") === node && row.getClientRects().length,
  );
  const [start, end] = renderedRows(
    rows.map((row) => row.getBoundingClientRect()),
    visibleBand(ownList(node) ?? node),
  );
  const shown = rows.slice(start, end);
  const widths = shown.map((row) => row.style.width);
  for (const row of shown) row.style.width = "min-content";
  const natural = shown.map((row) => Math.max(row.getBoundingClientRect().width, row.scrollWidth));
  shown.forEach((row, i) => (row.style.width = widths[i]!));
  const min = node.querySelector(".menu-description") ? Math.max(floor, MENU.ITEM_MIN_WIDTH_WITH_DESCRIPTION) : floor;
  const next = grownWidth(natural, current, min);
  if (next !== undefined) node.style.minWidth = `${next}px`;
  return next;
}

/**
 * Sizes a menu as `k3e` does, by writing its root's min-width (no re-render): as it mounts, as its rows change (a search, rows
 * arriving, the list scrolling new rows in: at once and once more within 150ms, Linear's throttle), and as the window resizes. The
 * Virtualizer places rows absolutely, so the list adds nothing to the menu's width itself, as Linear's `width: var(--row-width)` list.
 */
function useRowWidth(root: RefObject<HTMLDivElement | null>, measured: boolean) {
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !measured) return;
    const floor = parseFloat(getComputedStyle(node).minWidth) || 0;
    let current: number | undefined;
    const measure = () => {
      current = fitRows(node, current, floor) ?? current;
    };
    measure();
    const changed = new Throttler(measure, { wait: 150, leading: true, trailing: true });
    const rows = new MutationObserver(() => changed.maybeExecute());
    rows.observe(node, { childList: true, subtree: true, characterData: true });
    let frame = 0;
    const resized = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    addEventListener("resize", resized);
    return () => {
      rows.disconnect();
      changed.cancel();
      cancelAnimationFrame(frame);
      removeEventListener("resize", resized);
    };
  }, [root, measured]);
}

/** Linear's v3e: a list too tall for its room is cut where the last row in view still shows at least this share of itself. */
export const LAST_ROW_SHOWN = 0.55;

/**
 * How tall a menu's list may be: its own height (`own`, its natural height or its own CSS cap), the window's room less what the
 * popup shows around the list (`popup`, the popup's height less the list's), and each box around it with a max-height of its own
 * (`boxes`: that max-height and the box's height less the list's).
 */
export function listRoom(
  own: number,
  boxes: readonly { max: number; around: number }[],
  popup?: { room: number; around: number },
): number {
  return Math.min(own, popup ? popup.room - popup.around : Infinity, ...boxes.map((box) => box.max - box.around));
}

/**
 * Linear's `_3e` height for a list of `natural` height given `room`: all of it when it fits; otherwise the tallest cut that fits
 * where the last row in view shows at least LAST_ROW_SHOWN of itself (`O`'s `Math.ceil(offset + rowHeight * v3e)` per row, then
 * `b3e`: the last of those at most the room, else the first). `rows` are each row's top and height inside the list, its padding
 * included, in order.
 */
export function listHeight(rows: readonly { top: number; height: number }[], natural: number, room: number): number {
  if (natural <= room) return natural;
  if (rows.length && !coversRoom(rows, room)) return NaN;
  const cuts = rows.map((row) => Math.ceil(row.top + row.height * LAST_ROW_SHOWN)).sort((a, b) => a - b);
  if (!cuts.length) return room;
  let cut = cuts[0]!;
  for (const at of cuts) if (at <= room) cut = at;
  return cut;
}

/**
 * Whether `rows` (as listHeight takes them) are every row from the list's top down past `room`, with no gap between them: the
 * Virtualizer renders only the rows around what is in view, so a list scrolled far down holds none of the rows a cut is made in
 * (and the row with focus it keeps rendered wherever it is). Without them, listHeight gives NaN: the cut can't be known, so the
 * list keeps the one it has.
 */
export function coversRoom(rows: readonly { top: number; height: number }[], room: number): boolean {
  let bottom = rows[0]?.top ?? Infinity;
  if (bottom > MENU.ITEM_HEIGHT) return false;
  for (const row of rows) {
    if (row.top > bottom + 1) return false;
    bottom = Math.max(bottom, row.top + row.height);
    if (bottom >= room) return true;
  }
  return false;
}

/**
 * Linear's `limitHeight` caps for a list that overflows its room (`_3e`'s `M`): the height down to the end of its LIMIT_ROWS-th row
 * (its padding above included), and 80% of the window less what the menu shows around the list (`Math.floor(v * .8)` caps the
 * whole menu). `rows` are as listHeight takes them.
 */
export function limitCap(rows: readonly { top: number; height: number }[], windowHeight: number, around: number): number {
  const last = rows.length >= LIMIT_ROWS ? rows[LIMIT_ROWS - 1]! : null;
  return Math.min(last ? last.top + last.height : LIMIT_ROWS_HEIGHT, Math.floor(windowHeight * 0.8) - around);
}

// What _3e counts as rows: Linear's action, divider, text divider and group header rows, and the empty state.
const HEIGHT_ROWS =
  '[role^="menuitem"], .menu-group-header, .menu-divider, .menu-text-divider, .menu-empty, [data-list-row]';
// The popup a menu sits in: a surface, a submenu or a toolbar popover.
const POPUP = '[data-surface], [data-popover], .menu-submenu, [role="dialog"]';

/**
 * One `_3e` measure of the menu `node`: caps its list's max-height so the menu stays inside its room (menuRoom, and every box
 * around it with a max-height of its own), cut so the last row in view shows at least LAST_ROW_SHOWN. The search and anything else
 * outside the list stay put; only the list scrolls. A menu outside any popup is only cut to its list's own cap.
 */
function fitHeight(node: HTMLElement) {
  const list = ownList(node);
  if (!list) return;
  const popup = node.closest<HTMLElement>(POPUP);
  const boxes: HTMLElement[] = [];
  if (popup)
    for (let box = list.parentElement; box; box = box.parentElement) {
      boxes.push(box);
      if (box === popup) break;
    }
  const scrolled = list.scrollTop,
    kept = list.style.maxHeight;
  // What each box shows around the list, read with the list collapsed so no box's own cap cuts it (and offsetHeight leaves out
  // what overflows it, such as a submenu's safe triangle). Two writes, each followed by its batch of reads.
  list.style.maxHeight = "0px";
  const collapsed = list.offsetHeight;
  const caps = boxes.map((box) => {
    const max = getComputedStyle(box).maxHeight;
    return { max: max.endsWith("px") ? parseFloat(max) : Infinity, around: box.offsetHeight - collapsed };
  });
  // Back to its own cap (Menu.List's maxHeight) or its natural height.
  list.style.maxHeight = "";
  const own = list.offsetHeight,
    natural = list.scrollHeight;
  const room = listRoom(
    own,
    caps.filter((cap) => cap.max < Infinity),
    caps.length ? { room: menuRoom(innerHeight), around: caps.at(-1)!.around } : undefined,
  );
  let height = natural;
  // Only a list that overflows its room is cut further to Linear's limitHeight caps.
  if (natural > room) {
    const top = list.getBoundingClientRect().top - list.scrollTop;
    const rows = [...list.querySelectorAll<HTMLElement>(HEIGHT_ROWS)]
      .filter((row) => row.closest(".menu") === node && row.getClientRects().length)
      .map((row) => {
        const box = row.getBoundingClientRect();
        return { top: box.top - top, height: box.height };
      })
      .sort((a, b) => a.top - b.top);
    const limited = list.hasAttribute("data-limit");
    height = listHeight(rows, natural, limited ? Math.min(room, limitCap(rows, innerHeight, caps.at(-1)?.around ?? 0)) : room);
  }
  if (Number.isNaN(height)) list.style.maxHeight = kept;
  else if (height < own) list.style.maxHeight = `${height}px`;
  list.scrollTop = scrolled;
}

/**
 * Sizes a menu's height as Linear's `_3e` does (fitHeight), by writing its list's max-height (no re-render): as it mounts, as its
 * rows change, as its popup is placed or moved (a submenu's room comes from its row), and as the window resizes. Not throttled, as
 * Linear works it out on every render: a mutation batch is one measure, before the frame paints, so a popup never shows uncut.
 */
function useListHeight(root: RefObject<HTMLDivElement | null>, measured: boolean) {
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !measured) return;
    const measure = () => fitHeight(node);
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    const popup = node.closest(POPUP);
    if (popup) observer.observe(popup, { attributes: true, attributeFilter: ["style"] });
    // A frame on, after the popup's own placement has taken the new window size.
    let frame = 0;
    const resized = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    addEventListener("resize", resized, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      removeEventListener("resize", resized);
    };
  }, [root, measured]);
}

// Linear's _6e: a keyboard highlight resting on a submenu row previews its submenu after this long.
const PREVIEW_DELAY = 300;
// React Aria's SubmenuTrigger opens on hover after `delay`; Linear opens at once, from Menu's own pointer handling, so its timer is
// pushed out of reach (the largest delay setTimeout takes).
const NO_HOVER_OPEN = 2_147_483_647;
// A submenu's SubmenuTrigger key: its action row keeps the row's value, which the highlight and onValueChange use.
const SUBMENU = "submenu:";

type Point = { x: number; y: number };
/** The open submenu of a level: its row's value, how it opened (focus moves in only for "focus"), and where the pointer was. */
type Opened = { key: string; how: "pointer" | "preview" | "focus"; at?: Point };
type TreeState = NonNullable<ContextType<typeof MenuStateContext>>;
type TriggerState = NonNullable<ContextType<typeof RootMenuTriggerStateContext>>;
/** A score for `value` against `search`, 0 to leave the row out: menuFilter's shape. */
export type MenuFilter = (value: string, search: string, keywords?: string[]) => number;

/** The list's state and its rows in the order shown, which the list hands its level once it renders. */
type Shared = { state: TreeState | null; order: string[]; list: HTMLElement | null };

/** A level's open submenu, held outside React so each submenu row subscribes to its own (openedFor) and only the rows whose
 *  answer changes re-render. */
type OpenedStore = { get: () => Opened | null; set: (next: Opened | null) => void; subscribe: (listener: () => void) => () => void };
function openedStore(): OpenedStore {
  let opened: Opened | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => opened,
    set: (next) => {
      if (next === opened) return;
      opened = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
/** What submenu row `value` sees of its level's open submenu: the opening when it is its own, else null. The same object while it
 *  stays open, so a row whose answer is unchanged doesn't re-render. */
export const openedFor = (opened: Opened | null, value: string) => (opened?.key === value ? opened : null);
/** The level's store, made as it is first asked for. */
const storeOf = (ref: RefObject<OpenedStore | null>) => (ref.current ??= openedStore());

/** A submenu row opening takes its level's highlight, unless it holds it already. `level` is the level as it is now. */
export function openedIn(level: { highlight: (value: string) => void; highlighted: string }, key: string) {
  if (key !== level.highlighted) level.highlight(key);
}

/**
 * Whether an opening of a submenu moves focus into it now: only one a key opened (Linear's openSubMenuForFocusedItem, `focus: !0`),
 * and only once the popup is `placed`, as an unplaced popup is hidden and can't take focus.
 */
export const focusOnOpen = (opened: Pick<Opened, "how">, placed: boolean) => placed && opened.how === "focus";

/**
 * What one menu level shares with its list, rows and submenus (Linear's i3e). One value for the menu's life, as i3e is memoised:
 * its actions read the level's latest props and state through refs, so a highlight, a search or a submenu opening never re-renders
 * every submenu row through it. What does change per render (the search and the ranking) is the list's (ListContext), read once per
 * level; which submenu is open is the store's, read per row (openedFor).
 */
type Level = {
  actions: {
    /** The level's open submenu, an external store (useSyncExternalStore). */
    subscribe: (listener: () => void) => () => void;
    opened: () => Opened | null;
    /** The list's state and its rows in order, handed up once the list renders. */
    /** `heading`: the list opens on a heading or divider rather than a row. */
    share: (shared: Shared, heading: boolean) => void;
    /** The level's own search (a submenu hands focus back to it). */
    input: () => HTMLInputElement | null;
    /** The highlight to start with, given the rows shown. */
    initial: (order: string[]) => string | null;
    /** Moves the highlight to `key`, taking React Aria's focus only where the level may (takesFocus). */
    highlight: (key: string | null) => void;
    /** The highlight moved from `previous` to `key`. */
    moved: (key: string | null, previous: string | null) => void;
    open: (key: string, how: Opened["how"], at?: Point) => void;
    /** The pointer over `target` at `at`: highlights the row it is on and opens that row's submenu (Linear's row mouseenter). */
    point: (target: Element, at: Point, touch: boolean) => void;
    /** The pointer resting at a point once the open submenu's safe triangle has expired: the row there takes it. */
    rest: (at: Point) => void;
    close: () => void;
    /** Closes every level: the surface. */
    closeAll: () => void;
  };
};
const LevelContext = createContext<Level | null>(null);
/** What the level's search, input and list render with: one consumer of each per level, never one per row. */
type List = {
  search: string;
  /** The controlled highlight (MenuRoot's `value`), which the list follows when its owner moves it. */
  value: string | undefined;
  /** The scores the last filter pass gave, by node key; null while nothing is filtered. */
  scores: Map<Key, number> | null;
  /** React Aria's Menu filter for the search, which fills `scores`. */
  filter: ((text: string, node: RankNode) => boolean) | undefined;
  label: string;
};
const ListContext = createContext<List | null>(null);
/** What a submenu gives the menu inside it: stepping back to its parent (← and Backspace). */
const SubmenuContext = createContext<{ back: () => void } | null>(null);
/** What a page gives the menu inside it: leaving the page on Backspace in its empty search (Menu.Back). */
const PageBackContext = createContext<(() => void) | null>(null);

/**
 * Linear's onEmptySearchBackspace (J4e, passed by the command menu `rMn` as its `O`): the menu inside is a page of another, and
 * Backspace in its empty search runs `onBack`, with a submenu's guard (not a held key that just emptied it). ⌘K's root drops its
 * targeted issue this way, and a nested page such as Change status goes back to ⌘K (`closeSubActions`). A submenu inside keeps its
 * own back.
 */
function MenuBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return <PageBackContext value={onBack}>{children}</PageBackContext>;
}

/**
 * What a pointer move onto row `next` does, given the row the pointer was last on (`under`) and the highlighted row: a move
 * within the highlighted row does nothing, so a submenu a key closed stays closed; entering a row, or moving on one a key moved
 * the highlight off, highlights it and opens its submenu. Entering the row that already holds the highlight still opens its
 * submenu ("enter"), as a menu that opened with its first row highlighted must open it when the pointer reaches it (Linear's
 * openSubMenuOnFocus).
 */
export function pointerStep(next: string, under: string | null, highlighted: string): "stay" | "enter" | "highlight" {
  if (next !== highlighted) return "highlight";
  return next === under ? "stay" : "enter";
}

/**
 * Where the highlight goes once the rows are `values`: when the highlighted row, seen in an earlier render (`shown`), left the
 * list, onto the first row, as Linear's command menu moves a focused row id it no longer finds to the first action (`B6e`);
 * otherwise nowhere (null). A whole group going (⌘K's issue commands after ⌫ drops the issue) must not leave the highlight on a
 * removed row (R3-palette-shortcuts-D3).
 */
export function vanishedHighlight(highlighted: string, shown: string | null, values: string[]): string | null {
  if (!highlighted || shown !== highlighted || values.includes(highlighted)) return null;
  return values[0] ?? null;
}

/**
 * What a list last showed: its highlight, its search (null until it has shown a row), its controlled value and its rows; and,
 * while a search's pick still follows the first row, the row it picked (`follow`, null for an empty list; absent once the user
 * moved the highlight or nothing follows).
 */
type Seen = {
  key: string | null;
  search: string | null;
  value: string | undefined;
  order: string[];
  follow?: string | null;
};
const UNSEEN: Seen = { key: null, search: null, value: undefined, order: [] };

const sameRows = (a: string[], b: string[]) => a.length === b.length && a.every((row, i) => row === b[i]);

/**
 * Where the list's highlight goes this render (`next`, undefined to leave it) and what to remember of it. The menu's start
 * (`initial`) waits for its first rows: React Aria builds a collection on a second pass, so a list mounting inside an opening
 * submenu renders with none at first, and choosing then would open the submenu with nothing highlighted. After that: onto `value`
 * when its owner moves it, onto the first row after a search, onto the first when the highlighted row left the list (B6e).
 *
 * The same second pass means a search's first render still shows the rows of the search before it, so the pick follows the
 * first row as the rows change until the user moves the highlight: typing "next week" in Due date left its one row unhighlighted
 * (Enter did nothing), and "d" in Issue options left the highlight on the second row.
 */
export function settleHighlight(
  last: Seen,
  now: { key: string | null; search: string; value: string | undefined; order: string[] },
  initial: (order: string[]) => string | null,
): { next: string | null | undefined; seen: Seen } {
  const { key, search, value, order } = now;
  if (last.search === null)
    return order.length
      ? { next: initial(order), seen: { key, search, value, order } }
      : { next: undefined, seen: { ...last, key } };
  // React Aria clearing the highlight of a row that left is not the user moving it.
  const following = last.follow !== undefined && (key === null || key === last.follow);
  let next: string | null | undefined;
  let follow: string | null | undefined;
  if (value !== undefined && value !== last.value && order.includes(value)) next = value;
  else if (last.search !== search || (following && !sameRows(last.order, order))) next = follow = order[0] ?? null;
  else if (following) follow = last.follow;
  else if (key !== null) next = vanishedHighlight(key, last.order.includes(key) ? key : null, order) ?? undefined;
  return { next, seen: { key, search, value, order, ...(follow !== undefined && { follow }) } };
}

/**
 * Whether a level's highlight takes React Aria's focus with it (its row's data-focused and virtual focus). A submenu focus hasn't
 * entered yet keeps its highlight to itself: taking virtual focus would take it from the parent the user is still in (Linear's
 * submenu has no focus over its parent until requestFocus). Focus entering it then shows it (Linear's M3e).
 */
export const takesFocus = (inSubmenu: boolean, holdsFocus: boolean) => !inSubmenu || holdsFocus;

/** The row a submenu highlights as focus enters it: the one it holds, else its first (M3e's `onMoveFocus("first")`). */
export const enteredHighlight = (key: string | null, order: string[]) =>
  key !== null && order.includes(key) ? key : (order[0] ?? null);

const highlight = (state: TreeState | null, key: string | null, focus = true) => {
  const manager = state?.selectionManager;
  if (!manager) return;
  if (focus) manager.setFocused(true);
  manager.setFocusedKey(key);
};
const rowOf = (list: HTMLElement | null, key: string | null) =>
  key == null ? null : (list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null);
const isSubmenuRow = (state: TreeState | null, key: string | null) => {
  const parent = key == null ? null : state?.collection.getItem(key)?.parentKey;
  return parent != null && state?.collection.getItem(parent)?.type === "submenutrigger";
};

/**
 * The root menu trigger state React Aria's SubmenuTrigger reads its open state from, less its `close` and `openSubmenu` (the
 * level's actions, added where the level is: handed to a function, the compiler takes them to read refs during render and skips
 * compiling the menu). Each level gives its own, holding only its own open submenu at index 0, so a row's level is 0 however deep
 * it is or when it mounts (a virtualized row scrolled in while a submenu is open would otherwise take level 1).
 * Its closeSubmenu does nothing: the level closes its submenu itself (a highlight move, ←, Backspace, Escape). React Aria's
 * SubmenuTrigger also asks to close on any focus landing in the parent list, the virtual focus Autocomplete hands the list as
 * focus comes back to its search among it: the pointer leaving a submenu (Linear's yieldFocus) closed it.
 */
export function levelTrigger(open: Opened | null): Omit<TriggerState, "close" | "openSubmenu"> {
  return {
    isOpen: true,
    setOpen: () => {},
    open: () => {},
    toggle: () => {},
    focusStrategy: null,
    point: null,
    setPoint: () => {},
    expandedKeysStack: { length: 0, 0: open ? SUBMENU + open.key : undefined } as unknown as Key[],
    closeSubmenu: () => {},
  };
}

/** Hands the root node to the caller's `ref` too; a module function, as the React Compiler won't compile a component that
 *  writes to a prop. */
function forward(ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

type MenuRootProps = Omit<ComponentProps<"div">, "onChange" | "defaultValue"> & {
  /** The search, controlled; `defaultSearch` starts an uncontrolled one. */
  search?: string;
  defaultSearch?: string;
  onSearchChange?: (search: string) => void;
  /** How rows are scored against the search (menuFilter, every menu's by default); "none" lists every row as given. */
  filter?: MenuFilter | "none";
  /** The highlighted row's value, controlled; `defaultValue` is the row highlighted as the menu opens. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** The highlight as the menu opens with no `value`: the first row; none (Linear's focusedIndex -1, the first ↓ lands on the first
   *  row); or "opener": none when a pointer opened the menu, the first row when a key did (Linear's keyboardInvoked). */
  start?: "first" | "none" | "opener";
  width?: number | "auto";
  /** The list's accessible name. */
  label?: string;
};

/**
 * Linear's action menu (`IB`/`B3e`) on React Aria's Autocomplete and Menu: the search keeps focus and the highlight is React Aria's
 * virtual focus, which this root drives with Linear's J4e rules for every menu:
 * - A highlight change closes any other open submenu. A highlight moved by a navigation key previews a submenu row after 300ms;
 *   one moved by the pointer opens it at once. Rows the pointer crosses on its way into an open submenu are covered by the
 *   submenu's safe triangle, so they never see it (Linear's JCe).
 * - ↓/↑ (and Ctrl+n/j/p/k) step, wrapping; with ⌘ or ⌥ they jump to the ends, as Home and End do. Tab and Shift+Tab step like ↓
 *   and ↑; PageDown and PageUp move a page and stop at the ends.
 * - → opens the highlighted submenu row when the caret is at the end of the search.
 * - Space, with the search empty (or mid-search right after ↑/↓ on a checkbox row), opens a submenu row, toggles a checkbox row
 *   and keeps the menu open, or picks any other row.
 * - Enter picks the highlighted row; on a checkbox row it picks it and closes the menu, Shift+Enter toggles it and keeps it open.
 * - With the search empty, a digit picks the row whose `data-number` it is.
 * - Typing ranks the rows best first (menuFilter), as Linear's B3e lists its results, and highlights the first.
 *
 * Its width is `width`: by default measured from its rows as Linear's `k3e` does (useRowWidth); a number is Linear's `fixedWidth`
 * (a property picker's 206px); "auto" also leaves the box around it to set it, for the menus that aren't Linear's `IB` (the command
 * menu's 720px, a Select's list). Every `IB` menu (not "auto") is as tall as Linear's `_3e` allows (useListHeight).
 */
function MenuRoot({
  search: searchProp,
  defaultSearch = "",
  onSearchChange,
  filter = menuFilter,
  value,
  defaultValue,
  onValueChange,
  start = "first",
  width,
  label,
  className = "",
  style,
  ref,
  onKeyDown,
  onPointerMove,
  onPointerLeave,
  children,
  ...props
}: MenuRootProps) {
  const root = useRef<HTMLDivElement>(null);
  useRowWidth(root, typeof width !== "number");
  useListHeight(root, width !== "auto");
  const surface = use(MenuSurfaceContext);
  const submenu = use(SubmenuContext);
  const pageBack = use(PageBackContext);
  const [ownSearch, setOwnSearch] = useState(defaultSearch);
  const search = searchProp ?? ownSearch;
  const store = useRef<OpenedStore>(null);
  const shared = useRef<Shared>({ state: null, order: [], list: null });
  // How the highlight last moved (a navigation key previews a submenu row), whether the last key was ↑/↓, the row under the pointer,
  // and the pending preview.
  const input = useRef<"navigation" | "pointer" | "other">("other"),
    arrowed = useRef(false),
    keyUp = useRef(NO_KEYUP),
    under = useRef<string | null>(null),
    preview = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(preview.current), []);
  // The scores of one search, filled as React Aria's Menu filters its collection and read as the list ranks what it kept.
  const ranking = useMemo(() => {
    if (filter === "none" || !search) return { scores: null, filter: undefined };
    const scores = new Map<Key, number>();
    return {
      scores,
      filter: (text: string, node: RankNode) => {
        const score = filter(text, search, node.props.keywords as string[] | undefined);
        scores.set(node.key, score);
        return score > 0;
      },
    };
  }, [filter, search]);
  const list: List = {
    search,
    value,
    scores: ranking.scores,
    filter: ranking.filter,
    label: label ?? props["aria-label"] ?? "Menu",
  };
  // The level's actions run from its rows' handlers and its list's layout effects, so they read its props through a ref, brought up
  // to date before any layout effect of this commit runs (the list's among them).
  const latest = useRef({ value, defaultValue, start, onValueChange, surface, submenu });
  useInsertionEffect(() => {
    latest.current = { value, defaultValue, start, onValueChange, surface, submenu };
  });
  // One value for the menu's life (Linear's i3e memoises it the same way): its actions only read refs and the store, so the React
  // Compiler keeps the first one (no useState initializer: one reading refs runs during render and makes the compiler skip the menu,
  // BJ-233).
  const level: Level = {
    actions: {
      subscribe: (listener) => storeOf(store).subscribe(listener),
      opened: () => storeOf(store).get(),
      share: (next, heading) => {
        shared.current = next;
        // eT.getListPadding: no top padding over a leading heading or divider (index.css), told by the first node shown, as the
        // virtualized rows' DOM order isn't the list's.
        if (next.list) next.list.dataset.lead = heading ? "heading" : "row";
      },
      input: () => ownInput(root.current),
      initial: (order) => {
        const { value, defaultValue, start } = latest.current;
        const wanted = value ?? defaultValue;
        if (wanted !== undefined && order.includes(wanted)) return wanted;
        if (start === "none" || (start === "opener" && openedByPointer())) return null;
        return order[0] ?? null;
      },
      highlight: (key) =>
        highlight(
          shared.current.state,
          key,
          takesFocus(!!latest.current.submenu, !!root.current?.contains(document.activeElement)),
        ),
      moved: (key, previous) => {
        if (key !== null || previous !== null) latest.current.onValueChange?.(key ?? "");
        clearTimeout(preview.current);
        const opened = storeOf(store),
          now = opened.get();
        if (key !== null && now && now.key !== key) opened.set(null);
        if (key === null || input.current !== "navigation" || !isSubmenuRow(shared.current.state, key)) return;
        rowOf(shared.current.list, key)?.scrollIntoView({ block: "nearest" });
        preview.current = setTimeout(() => {
          if (shared.current.state?.selectionManager.focusedKey === key && opened.get()?.key !== key)
            opened.set({ key, how: "preview" });
        }, PREVIEW_DELAY);
      },
      open: (key, how, at) => {
        clearTimeout(preview.current);
        const opened = storeOf(store);
        if (opened.get()?.key !== key || how === "focus") opened.set({ key, how, at });
        const { state } = shared.current;
        openedIn(
          { highlighted: (state?.selectionManager.focusedKey as string | null) ?? "", highlight: level.actions.highlight },
          key,
        );
      },
      close: () => {
        clearTimeout(preview.current);
        storeOf(store).set(null);
      },
      closeAll: () => latest.current.surface?.close(),
      point: (target, at, touch) => {
        input.current = "pointer";
        const row = target.closest<HTMLElement>('[role^="menuitem"]');
        const { state } = shared.current;
        if (
          !row ||
          row.closest(".menu") !== root.current ||
          row.hasAttribute("data-disabled") ||
          row.getAttribute("aria-disabled") === "true" ||
          !row.dataset.key
        ) {
          under.current = null;
          return;
        }
        const next = row.dataset.key;
        const step = pointerStep(next, under.current, (state?.selectionManager.focusedKey as string | null) ?? "");
        under.current = next;
        if (step === "stay") return;
        if (step === "highlight") level.actions.highlight(next);
        if (!touch && isSubmenuRow(state, next)) level.actions.open(next, "pointer", at);
      },
      rest: ({ x, y }) => {
        // Linear's row takes this mouseenter only out of keyboard mode (`$4e`): a key pressed since keeps its highlight.
        if (keyboardMode()) return;
        const target = document.elementFromPoint(x, y);
        if (target && root.current?.contains(target)) level.actions.point(target, { x, y }, false);
      },
    },
  };
  const open = useSyncExternalStore(level.actions.subscribe, level.actions.opened, level.actions.opened);
  // A new trigger state only as a submenu opens or closes: every SubmenuTrigger reads it (its row's aria-expanded), as React Aria
  // re-renders each on every highlight move anyway.
  const trigger: TriggerState = {
    ...levelTrigger(open),
    // Closing every level is closing the surface.
    close: () => level.actions.closeAll(),
    openSubmenu: (key) => level.actions.open(String(key).slice(SUBMENU.length), "focus"),
  };
  // Autocomplete moves its input's focus to the search whenever a row takes virtual focus. A submenu the pointer or a preview
  // opened leaves focus in its parent (Linear's yieldFocus), so its rows' virtual focus stays inside it until focus moves in.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const keep = (event: FocusEvent) => {
      if (!event.isTrusted && !node.contains(document.activeElement)) event.stopPropagation();
    };
    // Focus entering a submenu from outside it shows its highlight, on the first row when it has none (Linear's M3e).
    const entered = (event: FocusEvent) => {
      const from = event.relatedTarget;
      if (!event.isTrusted || !latest.current.submenu || (from instanceof Node && node.contains(from))) return;
      if ((event.target as Element).closest(".menu") !== node) return;
      const { state, order } = shared.current;
      highlight(state, enteredHighlight((state?.selectionManager.focusedKey as string | null) ?? null, order));
    };
    node.addEventListener("focusin", keep, true);
    node.addEventListener("focusin", entered);
    return () => {
      node.removeEventListener("focusin", keep, true);
      node.removeEventListener("focusin", entered);
    };
  }, []);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".menu") !== root.current) return;
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const { state, order, list } = shared.current;
    const key = (state?.selectionManager.focusedKey as string | null | undefined) ?? null,
      at = key === null ? -1 : order.indexOf(key),
      row = rowOf(list, key),
      search = target instanceof HTMLInputElement ? target : null,
      afterArrow = arrowed.current;
    input.current = navigates(event) ? "navigation" : "other";
    if (event.key !== " ") arrowed.current = event.key === "ArrowDown" || event.key === "ArrowUp";
    // The row showing this digit, when one does in this level.
    const numbered = /^\d$/.test(event.key)
      ? [...(list?.querySelectorAll<HTMLElement>(`[data-number="${event.key}"]`) ?? [])].find(
          (item) => item.closest(".menu") === root.current,
        )
      : undefined;
    const action = menuKey({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      held: heldKey(event, keyUp.current, Date.now()),
      mac: isMac(),
      search: search && { value: search.value, start: search.selectionStart, end: search.selectionEnd },
      row: row && { checkbox: row.hasAttribute("aria-checked"), submenu: key !== null && isSubmenuRow(state, key) },
      numbered: !!numbered,
      inSubmenu: !!submenu,
      onPage: !!pageBack,
      childOpen: !!level.actions.opened(),
      afterArrow,
      hasSurface: !!surface,
      page: Math.max(1, Math.floor((list?.clientHeight ?? 0) / MENU.ITEM_HEIGHT)),
    });
    if (action.type === "none") return;
    // Autocomplete would clear the highlight on an arrow it doesn't use; the caret still moves.
    if (action.type === "caret") return event.stopPropagation();
    // Past Autocomplete (which would only clear the search) to whatever owns the menu.
    if (action.type === "release") return event.preventDefault();
    event.preventDefault();
    event.stopPropagation();
    // A checkbox row toggles from its checkbox, which keeps the menu open; any other row picks (a click React Aria reads as a press).
    const toggle = (item: HTMLElement) => (item.querySelector<HTMLElement>("input.menu-checkbox") ?? item).click();
    switch (action.type) {
      case "move": {
        const to = stepIndex(at, action.step, order.length, action.clamp ?? false);
        if (to >= 0) highlight(state, order[to]!);
        return;
      }
      case "end":
        if (order.length) highlight(state, order[action.last ? order.length - 1 : 0]!);
        return;
      case "number":
        return numbered?.click();
      case "open":
        return level.actions.open(key!, "focus");
      case "back":
        return submenu ? submenu.back() : pageBack?.();
      case "closeChild":
        return level.actions.close();
      case "toggle":
        return row && toggle(row);
      case "pick":
        return row?.click();
      case "pickClose": {
        const node = root.current;
        row?.click();
        // A row that closes the menu itself unmounts it first.
        setTimeout(() => {
          if (node?.isConnected) surface?.close();
        });
        return;
      }
      case "close":
        // Every level (Linear's closeParent): React Aria's search input stops the key before it can bubble to the surface's own Escape.
        return surface?.close();
    }
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    // Only a pointer the user moved highlights: not a list scrolling under a still one, nor ⌘ pressed over a row (movedPointer).
    if (!movedPointer(event)) return;
    const target = event.target as Element;
    if (target.closest(".menu") !== root.current) return;
    level.actions.point(target, { x: event.clientX, y: event.clientY }, event.pointerType === "touch");
  };
  return (
    <LevelContext value={level}>
      <ListContext value={list}>
        <RootMenuTriggerStateContext value={trigger}>
          <Autocomplete
            inputValue={search}
            onInputChange={(next) => {
              setOwnSearch(next);
              onSearchChange?.(next);
              // Linear closes a preview when the search changes.
              level.actions.close();
            }}
            disableAutoFocusFirst
          >
            <div
              {...props}
              ref={(node) => {
                root.current = node;
                forward(ref, node);
              }}
              data-width={width === undefined ? "rows" : undefined}
              style={typeof width === "number" ? { ...style, width } : style}
              className={`menu ${className}`}
              onKeyDownCapture={(event) => {
                props.onKeyDownCapture?.(event);
                if (!event.isPropagationStopped()) keyDown(event);
              }}
              onKeyUpCapture={(event) => {
                props.onKeyUpCapture?.(event);
                if ((event.target as Element).closest(".menu") === root.current) keyUp.current = keyUpMark(event, Date.now());
              }}
              onPointerMove={pointerMove}
              onPointerLeave={(event) => {
                onPointerLeave?.(event);
                under.current = null;
              }}
              // A press in the search keeps the highlight (Autocomplete clears it).
              onPointerDownCapture={(event) => {
                props.onPointerDownCapture?.(event);
                const target = event.target as Element;
                if (target instanceof HTMLInputElement && target.closest(".menu") === root.current) event.stopPropagation();
              }}
            >
              {children}
            </div>
          </Autocomplete>
        </RootMenuTriggerStateContext>
      </ListContext>
    </LevelContext>
  );
}

/** Linear's Zw: a 36px search row over a hairline, with an optional trailing `hotkey` (the registry chord that opens the menu, drawn as
 *  Linear's small Shortcut: ign's inputAdditionalContent). `hideWhenEmpty` keeps it focused but visually hidden until typing starts
 *  (B3e's hideInputWhenEmpty, used by action menus). Its text is the menu's `search`. */
function MenuInput({
  hotkey,
  hideWhenEmpty = false,
  chip,
  className,
  "aria-label": label,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange" | "className"> & {
  className?: string;
  hotkey?: string | readonly string[];
  hideWhenEmpty?: boolean;
  /** Drawn before the search: the nested command page's parent name (Linear's `nameAsParent` chip). */
  chip?: ReactNode;
}) {
  const hidden = hideWhenEmpty && !use(ListContext)?.search;
  return (
    <TextField aria-label={label ?? props.placeholder} className={hidden ? "sr-only" : `menu-input ${className ?? ""}`}>
      {chip && <span className="menu-input-chip">{chip}</span>}
      <Input {...NO_AUTOFILL} {...props} className={hidden ? "sr-only" : undefined} />
      {hotkey && <Shortcut aria-hidden keys={hotkey} size="small" />}
    </TextField>
  );
}

type RootProps = ComponentProps<ContextType<typeof CollectionRendererContext>["CollectionRoot"]>;
const BaseRendererContext = createContext<ContextType<typeof CollectionRendererContext> | null>(null);

/**
 * The rows as Menu shows them, between React Aria's Menu and the Virtualizer that lays them out: ranked by the search (arrange),
 * with the empty state only when no row is listed. Hands the level the list's state and its rows in order, and keeps the
 * highlight where Linear's B3e keeps it: on the first row after a search, back on the first when the highlighted row left the
 * list, on `value` when its owner moves it.
 */
function MenuRows(props: RootProps) {
  const base = use(BaseRendererContext)!;
  const level = use(LevelContext)!;
  const list = use(ListContext)!;
  const state = use(MenuStateContext)!;
  const { scores } = list;
  const shown = useMemo(() => {
    const collection = props.collection as unknown as RankCollection;
    const rows = arrange(collection, scores ? (node) => scores.get(node.key) ?? 0 : undefined);
    const same = !scores && rows.length === [...collection].length;
    return same ? collection : relink(collection, rows);
  }, [props.collection, scores]);
  const order = useMemo(() => rowKeys(shown).map(String), [shown]);
  const seen = useRef<Seen>(UNSEEN);
  const key = (state.selectionManager.focusedKey as string | null | undefined) ?? null;
  useLayoutEffect(() => {
    level.actions.share(
      { state, order, list: props.scrollRef?.current ?? null },
      leadsWithHeading(shown as unknown as RankCollection),
    );
    const last = seen.current;
    const settled = settleHighlight(last, { key, search: list.search, value: list.value, order }, level.actions.initial);
    seen.current = settled.seen;
    const { next } = settled;
    if (next !== undefined && next !== key) level.actions.highlight(next);
    else if (key !== last.key) level.actions.moved(key, last.key);
  });
  const Root = base.CollectionRoot;
  return <Root {...props} collection={shown as unknown as RootProps["collection"]} />;
}

/** Whether a list opens on a heading, a text divider or a divider rather than a row (or the empty state). */
export function leadsWithHeading(collection: RankCollection): boolean {
  const [first] = collection;
  if (!first) return false;
  if (first.type === "section") return [...collection.getChildren(first.key)][0]?.type === "header";
  return first.type === "separator" || (first.type === "header" && !first.props[EMPTY_STATE]);
}

/** React Aria's Virtualizer renderer with MenuRows as its root, so the rows it lays out are the ranked ones. */
function RankedRows({ children }: { children: ReactNode }) {
  const base = use(CollectionRendererContext);
  const renderer = useMemo(() => ({ ...base, CollectionRoot: MenuRows }), [base]);
  return (
    <BaseRendererContext value={base}>
      <CollectionRendererContext value={renderer}>{children}</CollectionRendererContext>
    </BaseRendererContext>
  );
}

/**
 * Linear's N6e: the scrolling rows, 6px above and below, virtualized as Linear's react-window list is (MenuLayout, 10 rows of
 * overscan). Keyboard scrolling keeps ITEM_SCROLL_MARGIN of context past the highlight. `maxHeight` is Linear's `maxHeight` prop, a
 * cap of the menu's own (`--list-max`, index.css); the menu cuts it further to its room (useListHeight owns the list's max-height).
 * LIMIT_HEIGHT is Linear's `limitHeight` instead: no cap until the list overflows its room (limitCap).
 * Its children are React Aria collection nodes only (Menu's rows, groups, dividers, Empty) and components that render them: a plain
 * element among them (a `<div>` around Menu.Empty) never becomes a node, keeps the collection dirty, and loops until React gives up.
 */
function MenuList({ maxHeight, children }: { maxHeight?: string; children: ReactNode }) {
  const level = use(ListContext)!;
  return (
    <Virtualizer layout={MenuLayout} layoutOptions={LAYOUT}>
      <RankedRows>
        <AriaMenu
          aria-label={level.label}
          // Autocomplete hands React Aria's Menu a `filter` through context; the level gives its own, which scores each row for the
          // ranking (it reads the same node fields, RankNode).
          {...({ filter: level.filter } as object)}
          shouldCloseOnSelect={false}
          autoFocus={false}
          className="menu-list"
          data-limit={maxHeight === LIMIT_HEIGHT || undefined}
          style={
            {
              "--list-max": maxHeight === LIMIT_HEIGHT ? undefined : maxHeight,
              scrollPaddingBlock: MENU.ITEM_SCROLL_MARGIN,
            } as CSSProperties
          }
        >
          {children}
        </AriaMenu>
      </RankedRows>
    </Virtualizer>
  );
}
type ItemSlots = {
  /** The 16px icon column. */
  icon?: ReactNode;
  /** A multi-select row: Linear's leading checkbox in this state. */
  checkbox?: boolean;
  /** Toggles from the checkbox itself, keeping the menu open (B4e's onCheckboxClick); `checkboxLabel` names it. */
  onCheckboxClick?: () => void;
  checkboxLabel?: string;
  /** A single-select row: the trailing checkmark when true. */
  checked?: boolean;
  /** The row's hotkey as a registry chord ("Shift+T", ["G", "I"]), drawn as Linear's small Shortcut (the action row's `detail`). */
  shortcut?: Keys;
  /** Trailing text: a number key, a count, a date. */
  hint?: ReactNode;
  /** A muted second line; the row grows to fit it. */
  description?: ReactNode;
};

// The checkbox's own press toggles it alone: kept from the row, which React Aria would press (pick) too.
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

/** Linear's v6e row content: [checkbox] [icon] label [checkmark] [hint ▶], in that order whatever the menu. */
function ItemContent({
  icon,
  checkbox,
  onCheckboxClick,
  checkboxLabel,
  checked,
  shortcut,
  hint,
  description,
  submenu,
  children,
}: ItemSlots & { submenu?: boolean; children: ReactNode }) {
  return (
    <>
      {checkbox !== undefined &&
        (onCheckboxClick ? (
          <input
            type="checkbox"
            tabIndex={-1}
            aria-label={checkboxLabel}
            checked={checkbox}
            onChange={onCheckboxClick}
            onClick={stop}
            onPointerDown={stop}
            onPointerUp={stop}
            onMouseDown={stop}
            className="menu-checkbox"
          />
        ) : (
          <span aria-hidden className="menu-checkbox" />
        ))}
      <span className="menu-label">
        {icon && (
          <span aria-hidden className="menu-icon">
            {icon}
          </span>
        )}
        {description ? (
          <span className="menu-text">
            <span className="menu-name">{children}</span>
            <span className="menu-description">{description}</span>
          </span>
        ) : (
          <span className="menu-name">{children}</span>
        )}
        {checked && (
          <span aria-hidden className="menu-checkmark">
            <Icon name="check" size={16} />
          </span>
        )}
        {(shortcut || hint != null || submenu) && (
          <span className="menu-hint">
            {/* Out of the row's name, as v6e names the row by its label alone (aria-labelledby). */}
            {shortcut && <Shortcut aria-hidden keys={shortcut} size="small" />}
            {hint}
            {submenu && <span aria-hidden data-submenu-arrow className="menu-arrow" />}
          </span>
        )}
      </span>
    </>
  );
}

type MenuItemProps = ItemSlots & {
  /** The row's id and search text; unique within its menu. */
  value: string;
  /** What the row is searched by instead of its value (menuFilter). */
  keywords?: string[];
  onSelect?: () => void;
  disabled?: boolean;
  "aria-disabled"?: boolean | "true" | "false";
  /** A multi-select row without a drawn checkbox. */
  "aria-checked"?: boolean;
  title?: string;
  /** The digit that picks the row (Linear's picker numbers). */
  "data-number"?: number | string;
  onPointerDown?: ComponentProps<"div">["onPointerDown"];
  children: ReactNode;
};

/** A row's DOM props: React Aria's, with a checkbox row's role and state, a muted row's aria-disabled and its title laid over them.
 *  What isn't ours stays React Aria's (a disabled row's aria-disabled). */
export function rowDom(
  dom: ComponentProps<"div">,
  { checks, muted, title }: { checks?: boolean; muted: boolean; title?: string },
): ComponentProps<"div"> {
  return {
    ...dom,
    title,
    role: checks !== undefined ? "menuitemcheckbox" : dom.role,
    "aria-checked": checks ?? dom["aria-checked"],
    "aria-disabled": muted || dom["aria-disabled"] || undefined,
  };
}

/** Linear's Item: a full-width 32px row owning 14/18 padding; its highlight is inset 6px with radius 8 (fT.itemContainer). */
function MenuItem({
  value,
  keywords,
  onSelect,
  disabled,
  "aria-disabled": ariaDisabled,
  "aria-checked": ariaChecked,
  title,
  icon,
  checkbox,
  onCheckboxClick,
  checkboxLabel,
  checked,
  shortcut,
  hint,
  description,
  children,
  ...props
}: MenuItemProps) {
  const checks = checkbox ?? ariaChecked;
  // `aria-disabled` reads as disabled and the keys pass it over (rowKeys), but a press still runs it: the filter
  // menu's Linear-only fields say why they are unavailable. `disabled` is React Aria's: no press at all.
  const muted = ariaDisabled === true || ariaDisabled === "true";
  return (
    <AriaMenuItem
      // React Aria can't change a mounted row's id (it throws, unmounting the app): a row whose value changes, like the labels
      // picker's "Create new label" row as you type, is a new row.
      key={value}
      id={value}
      textValue={value}
      // Kept on React Aria's node for the ranking (menuFilter's keywords) and the keys (rowKeys); not DOM attributes.
      {...({ keywords, muted } as object)}
      isDisabled={disabled}
      onAction={onSelect}
      // The row's `data-value`, which the row's own lookups read.
      data-value={value}
      {...props}
      render={
        checks !== undefined || title || muted
          ? (dom) => <div {...rowDom(dom as ComponentProps<"div">, { checks, muted, title })} />
          : undefined
      }
      className="menu-item"
    >
      <ItemContent
        icon={icon}
        checkbox={checkbox}
        onCheckboxClick={onCheckboxClick}
        checkboxLabel={checkboxLabel}
        checked={checked}
        shortcut={shortcut}
        hint={hint}
        description={description}
      >
        {children}
      </ItemContent>
    </AriaMenuItem>
  );
}

/** A group of rows under Linear's 30px GroupHeader (aT); a search leaves it out with its last row. */
function MenuGroup({ heading, children }: { heading?: ReactNode; children: ReactNode }) {
  return (
    <MenuSection className="menu-group">
      {heading != null && <Header className="menu-group-header">{heading}</Header>}
      {children}
    </MenuSection>
  );
}

/** Linear's GroupHeader (aT) outside a group. */
function MenuGroupHeader({ children }: { children: ReactNode }) {
  return <Header className="menu-group-header">{children}</Header>;
}

/** Linear's Divider (pT): 12px with a centred hairline. Hidden while the menu is searched. */
function MenuDivider() {
  return <Separator className="menu-divider" />;
}

/** Linear's TextDivider (O6e): a 30px muted caption between rows. */
function MenuTextDivider({ children }: { children: ReactNode }) {
  return <Header className="menu-text-divider">{children}</Header>;
}

/** Linear's 42px empty state, shown only while no row is listed (B3e derives it from its rows during render, so a menu never opens
 *  showing it); `always` shows it whatever is listed, for menus that list their own rows (filter "none"). */
function MenuEmpty({ children, always = false }: { children: ReactNode; always?: boolean }) {
  return (
    <Header className="menu-empty" {...{ [EMPTY_STATE]: always ? "always" : "empty" }}>
      {children}
    </Header>
  );
}

/** How far the row's edge on `side` sits inside its popup's border, so the submenu overlaps the popup by Linear's 2px. */
function popupEdge(row: Element) {
  const box = row.getBoundingClientRect();
  let left = box.left,
    right = box.right;
  for (let node = row.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (parseFloat(style.borderRightWidth) || parseFloat(style.borderLeftWidth)) {
      const edge = node.getBoundingClientRect();
      left = edge.left;
      right = edge.right;
      break;
    }
  }
  return { left, right };
}

/** Writes the safe triangle from `point` to `popup`'s box into `node`'s style, or hides it while the pointer is inside the popup
 *  or off the parent menu that its `row` is in. */
function drawTriangle(node: HTMLElement, popup: HTMLElement | null, row: HTMLElement | null | undefined, { x, y }: Point) {
  const box = popup?.getBoundingClientRect(),
    style = box && safeTriangle(box, x, y, { parent: row?.closest(POPUP)?.getBoundingClientRect(), row: row?.getBoundingClientRect() });
  node.style.cssText = style
    ? Object.entries(style)
        .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
        .join(";")
    : "display:none";
}

/**
 * Linear's JCe: an invisible box over the parent menu, from the pointer (sampled every 50ms, as Linear's throttled qCe) to the
 * submenu, clipped to the triangle between them (safeTriangle). Rows under it get no pointer events, so a diagonal move into the
 * submenu crosses other rows without opening theirs. It follows the pointer by writing its style, never by re-rendering.
 * `placed` is null until the submenu has its place and then changes whenever it moves: the triangle is drawn against the box the
 * submenu has, never the unplaced one, which would leave it over the wrong parent rows while the pointer rests.
 * TRIANGLE_EXPIRY after the last sample with the pointer off the submenu's own row (`row`), it hides until the pointer is back on
 * that row, and the row then under the pointer takes it (`rest`), as Linear's row takes the mouseenter the triangle's unmounting
 * brings: highlighted, its own submenu opening.
 * React Aria's own submenu guard (useSafelyMouseToSubmenu) turns the parent's pointer events off by its own estimate instead; the
 * menu list keeps them on (index.css) so this one decides.
 */
function SafeTriangle({
  popup,
  row,
  from,
  placed,
  rest,
}: {
  popup: RefObject<HTMLElement | null>;
  row: RefObject<HTMLElement | null> | undefined;
  from?: Point;
  placed: string | null;
  rest: (point: Point) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The point the triangle was last sampled at, whether the submenu has its place to draw against, and whether it has expired.
  const at = useRef<Point | null>(null),
    ready = useRef(false),
    expired = useRef(false),
    expiry = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The latest `rest`, read when the triangle expires.
  const resting = useRef(rest);
  useInsertionEffect(() => {
    resting.current = rest;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const stays = (point: Point) => triangleStays(row?.current?.getBoundingClientRect(), point.x, point.y);
    const sample = (point: Point) => {
      at.current = point;
      if (expired.current) {
        if (!stays(point)) return;
        expired.current = false;
      }
      if (ready.current) drawTriangle(node, popup.current, row?.current, point);
      clearTimeout(expiry.current);
      expiry.current = setTimeout(() => {
        if (stays(point)) return;
        expired.current = true;
        node.style.cssText = "display:none";
        resting.current(point);
      }, TRIANGLE_EXPIRY);
    };
    const throttle = new Throttler(sample, { wait: 50, leading: true, trailing: true });
    const move = (event: globalThis.PointerEvent) => throttle.maybeExecute({ x: event.clientX, y: event.clientY });
    addEventListener("pointermove", move, { passive: true });
    return () => {
      removeEventListener("pointermove", move);
      throttle.cancel();
      clearTimeout(expiry.current);
    };
  }, [popup, row]);
  // Once the submenu is placed, and again whenever it moves, the triangle is redrawn from the last sample: at first, where the
  // pointer opened the submenu, so the first move toward it is already covered.
  useEffect(() => {
    ready.current = placed !== null;
    const node = ref.current,
      point = at.current ?? from;
    if (node && ready.current && point && !expired.current) drawTriangle(node, popup.current, row?.current, point);
  }, [placed, popup, row, from]);
  return <div ref={ref} aria-hidden data-safe-triangle style={{ display: "none" }} />;
}

/**
 * The open submenu's popup: React Aria's Popover (non-modal, mounted in the root popup so it shares its focus scope), placed beside
 * its row as Linear's x3e places it (submenuPlacement) and kept there while its row stays put (settle). The pointer over its rows
 * takes focus in; over its safe triangle it is on its way out, so it yields focus back to the parent menu, as on leaving it
 * (Linear's requestFocus and yieldFocus). ← and Backspace on an empty search step back; Escape closes every level.
 */
function SubmenuPopup({ value, side, label, children }: { value: string; side: "right" | "left"; label: string; children: ReactNode }) {
  const level = use(LevelContext)!;
  // Subscribed to its own row's answer only, so a submenu opening or closing re-renders the two rows that changed.
  const seen = () => openedFor(level.actions.opened(), value);
  const opened = useSyncExternalStore(level.actions.subscribe, seen, seen);
  if (!opened) return null;
  return (
    <OpenSubmenu level={level} opened={opened} side={side} label={label}>
      {children}
    </OpenSubmenu>
  );
}

function OpenSubmenu({
  level,
  opened,
  side,
  label,
  children,
}: {
  level: Level;
  opened: Opened;
  side: "right" | "left";
  label: string;
  children: ReactNode;
}) {
  const surface = use(MenuSurfaceContext);
  // SubmenuTrigger hands its popover the row it opens from.
  const row = (use(PopoverContext) as { triggerRef?: RefObject<HTMLElement | null> } | null)?.triggerRef;
  const popup = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const node = popup.current,
      anchor = row?.current;
    if (!node || !anchor) return;
    let settled: { row: number; top: number } | null = null;
    return watchPlacement(node, () => {
      const box = anchor.getBoundingClientRect(),
        frame = node.getBoundingClientRect(),
        first = node.querySelector('[role^="menuitem"]');
      const { lowest, ...next } = submenuPlacement({
        row: box,
        edge: popupEdge(anchor),
        width: node.offsetWidth,
        height: node.scrollHeight + node.offsetHeight - node.clientHeight,
        first: first ? first.getBoundingClientRect().top - frame.top : 0,
        side,
        view: { width: innerWidth, height: innerHeight },
      });
      const kept = settle(settled, box.top, next.top, lowest);
      settled = kept.settled;
      return { ...next, top: kept.top };
    }, setPlace, anchor.closest(POPUP));
  }, [row, side]);
  const parentInput = level.actions.input;
  /** Linear's yieldFocus: focus goes back to the parent menu, so its Escape and keys work, and the submenu stays open. */
  const yieldFocus = () => {
    if (popup.current?.contains(document.activeElement)) parentInput()?.focus();
  };
  const focusInside = () => {
    const node = popup.current;
    (node?.querySelector<HTMLElement>(".menu-input input") ?? node?.querySelector<HTMLElement>("select,button,.menu[tabindex]"))?.focus();
  };
  const back = () => {
    level.actions.close();
    parentInput()?.focus();
  };
  // A submenu opened by a key takes focus (Linear's requestFocus) as soon as it is placed: until then it is `visibility: hidden`,
  // which focus() skips without a word. The pointer's and a preview's leave focus in the parent.
  const placed = place !== null;
  useLayoutEffect(() => {
    if (focusOnOpen(opened, placed)) focusInside();
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- On each opening, once placed; the helper reads the popup.
  }, [opened, placed]);
  // Closing with focus inside hands it back to the parent menu.
  useEffect(() => {
    const node = popup.current;
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || node?.contains(active)) parentInput()?.focus();
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Cleanup resolves the parent menu's input when the submenu closes.
  }, []);
  return (
    <AriaPopover
      isOpen
      onOpenChange={(open) => {
        if (!open) surface?.close();
      }}
      isKeyboardDismissDisabled
      // A press in another popup of this menu (a Select's list, a nested submenu) isn't outside it.
      shouldCloseOnInteractOutside={(element) => !element.closest("[data-surface], [data-popover], .menu-submenu")}
      className="menu-submenu"
      {...placedProps(place ?? undefined, 60)}
    >
      <div
        ref={popup}
        // Its own dialog, so React Aria's Popover neither takes focus as it opens (a preview keeps it in the parent) nor traps it.
        role="dialog"
        aria-label={label}
        className="menu-submenu-box"
        style={{ maxHeight: place?.maxHeight }}
        onPointerMove={(event) => {
          const target = event.target as Element;
          if (!event.currentTarget.contains(target) || event.buttons) return;
          if (target.hasAttribute("data-safe-triangle")) yieldFocus();
          else if (!event.currentTarget.contains(document.activeElement)) focusInside();
        }}
        onPointerLeave={(event) => {
          if (!event.buttons) yieldFocus();
        }}
      >
        <SafeTriangle
          popup={popup}
          row={row}
          from={opened.at}
          placed={place ? `${place.left},${place.top}` : null}
          rest={level.actions.rest}
        />
        <SubmenuContext value={{ back }}>{children}</SubmenuContext>
      </div>
    </AriaPopover>
  );
}

/**
 * A row that opens a nested menu (Linear's Item `SubMenu`), on React Aria's SubmenuTrigger: the pointer highlighting it opens it,
 * →, Enter or Space opens and focuses it, a keyboard highlight that rests on the row for 300ms previews it without moving focus
 * (Linear's _6e). The pointer entering the submenu focuses it; leaving it hands focus back to this menu and leaves it open, until
 * this menu's highlight moves to another row. It opens beside the row on `side`, overlapping its menu by 2px, with its first row
 * level with this one, and only swaps sides when it doesn't fit.
 */
function MenuSubmenu({
  value,
  label,
  keywords,
  side = "right",
  popupLabel = value,
  children,
  ...slots
}: Omit<ItemSlots, "checkbox" | "onCheckboxClick" | "checkboxLabel" | "checked" | "description"> & {
  value: string;
  label: ReactNode;
  keywords?: string[];
  side?: "right" | "left";
  /** The nested menu's accessible name; the row's value by default. */
  popupLabel?: string;
  children: ReactNode;
}) {
  return (
    // React Aria keys a SubmenuTrigger's node by its `id`, which its types leave out.
    // Keyed by its value for the same reason as Menu.Item: React Aria can't change a mounted row's id.
    <SubmenuTrigger key={value} delay={NO_HOVER_OPEN} {...({ id: SUBMENU + value, keywords } as object)}>
      <AriaMenuItem id={value} textValue={value} {...({ keywords } as object)} data-value={value} className="menu-item">
        <ItemContent {...slots} submenu>
          {label}
        </ItemContent>
      </AriaMenuItem>
      <SubmenuPopup value={value} side={side} label={popupLabel}>
        {children}
      </SubmenuPopup>
    </SubmenuTrigger>
  );
}

export const Menu = Object.assign(MenuRoot, {
  Input: MenuInput,
  List: MenuList,
  Item: MenuItem,
  Submenu: MenuSubmenu,
  Group: MenuGroup,
  GroupHeader: MenuGroupHeader,
  Divider: MenuDivider,
  TextDivider: MenuTextDivider,
  Empty: MenuEmpty,
  Back: MenuBack,
});
