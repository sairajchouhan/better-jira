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
import { MenuSurfaceContext, watchPlacement } from "./menu-surface";
import { MENU, menuRoom, settle, submenuPlacement } from "./menu-geometry";
import { arrange, EMPTY_STATE, relink, rowKeys, stepIndex, type RankCollection, type RankNode } from "./menu-rank";
import { openedByPointer } from "./menu-pristine";
import { Shortcut, type Keys } from "./keycap";
import { NO_AUTOFILL } from "@/client/components/field";
import { menuFilter } from "@/client/lib/fuzzy-score";
import { safeTriangle } from "./safe-triangle";

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
  const cuts = rows.map((row) => Math.ceil(row.top + row.height * LAST_ROW_SHOWN)).sort((a, b) => a - b);
  if (!cuts.length) return room;
  let cut = cuts[0]!;
  for (const at of cuts) if (at <= room) cut = at;
  return cut;
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
  const scrolled = list.scrollTop;
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
  if (natural > room) {
    const top = list.getBoundingClientRect().top - list.scrollTop;
    const rows = [...list.querySelectorAll<HTMLElement>(HEIGHT_ROWS)]
      .filter((row) => row.closest(".menu") === node && row.getClientRects().length)
      .map((row) => {
        const box = row.getBoundingClientRect();
        return { top: box.top - top, height: box.height };
      })
      .sort((a, b) => a.top - b.top);
    height = listHeight(rows, natural, room);
  }
  if (height < own) list.style.maxHeight = `${height}px`;
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

// Linear's J4e moves the highlight on these, and only these let a highlighted submenu row open its preview (canOpenSubmenuOnFocus).
const NAVIGATION = new Set(["ArrowDown", "ArrowUp", "Tab", "PageDown", "PageUp", "Home", "End"]);
// J4e's Ctrl+n/j and Ctrl+p/k (Emacs and vi) step like ↓ and ↑.
const CTRL_STEPS: Record<string, number> = { n: 1, j: 1, p: -1, k: -1 };
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

/** A plain ← or Backspace: the keys that step back out of a submenu. */
export const backKey = (event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (event.key === "ArrowLeft" || event.key === "Backspace") &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey;

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
    /** The highlight moved from `previous` to `key`. */
    moved: (key: string | null, previous: string | null) => void;
    open: (key: string, how: Opened["how"], at?: Point) => void;
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

const highlight = (state: TreeState | null, key: string | null) => {
  const manager = state?.selectionManager;
  if (!manager) return;
  manager.setFocused(true);
  manager.setFocusedKey(key);
};
const rowOf = (list: HTMLElement | null, key: string | null) =>
  key == null ? null : (list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null);
const isSubmenuRow = (state: TreeState | null, key: string | null) => {
  const parent = key == null ? null : state?.collection.getItem(key)?.parentKey;
  return parent != null && state?.collection.getItem(parent)?.type === "submenutrigger";
};

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
  const [ownSearch, setOwnSearch] = useState(defaultSearch);
  const search = searchProp ?? ownSearch;
  const store = useRef<OpenedStore>(null);
  const shared = useRef<Shared>({ state: null, order: [], list: null });
  // How the highlight last moved (a navigation key previews a submenu row), whether the last key was ↑/↓, the row under the pointer,
  // and the pending preview.
  const input = useRef<"navigation" | "pointer" | "other">("other"),
    arrowed = useRef(false),
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
  const latest = useRef({ value, defaultValue, start, onValueChange, surface });
  useInsertionEffect(() => {
    latest.current = { value, defaultValue, start, onValueChange, surface };
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
          { highlighted: (state?.selectionManager.focusedKey as string | null) ?? "", highlight: (k) => highlight(state, k) },
          key,
        );
      },
      close: () => {
        clearTimeout(preview.current);
        storeOf(store).set(null);
      },
      closeAll: () => latest.current.surface?.close(),
    },
  };
  const open = useSyncExternalStore(level.actions.subscribe, level.actions.opened, level.actions.opened);
  // React Aria's SubmenuTrigger reads its open state from a root menu trigger state; each level gives its own, holding only its own
  // open submenu at index 0, so a row's level is 0 however deep it is or when it mounts (a virtualized row scrolled in while a
  // submenu is open would otherwise take level 1). Closing every level is closing the surface. A new one only as a submenu opens or
  // closes: every SubmenuTrigger reads it (its row's aria-expanded), as React Aria re-renders each on every highlight move anyway.
  const trigger: TriggerState = {
    isOpen: true,
    setOpen: () => {},
    open: () => {},
    toggle: () => {},
    focusStrategy: null,
    point: null,
    setPoint: () => {},
    close: () => level.actions.closeAll(),
    expandedKeysStack: { length: 0, 0: open ? SUBMENU + open.key : undefined } as unknown as Key[],
    openSubmenu: (key) => level.actions.open(String(key).slice(SUBMENU.length), "focus"),
    closeSubmenu: (key) => {
      if (SUBMENU + level.actions.opened()?.key === key) level.actions.close();
    },
  };
  // Autocomplete moves its input's focus to the search whenever a row takes virtual focus. A submenu the pointer or a preview
  // opened leaves focus in its parent (Linear's yieldFocus), so its rows' virtual focus stays inside it until focus moves in.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const keep = (event: FocusEvent) => {
      if (!event.isTrusted && !node.contains(document.activeElement)) event.stopPropagation();
    };
    node.addEventListener("focusin", keep, true);
    return () => node.removeEventListener("focusin", keep, true);
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
      plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey,
      afterArrow = arrowed.current;
    const ctrlStep = event.ctrlKey && !event.metaKey && !event.altKey ? CTRL_STEPS[event.key] : undefined;
    input.current = NAVIGATION.has(event.key) || ctrlStep ? "navigation" : "other";
    if (event.key !== " ") arrowed.current = event.key === "ArrowDown" || event.key === "ArrowUp";
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    /** Moves the highlight `step` rows, wrapping, or with `clamp` stopping at the ends (Linear's handleMoveFocus). */
    const move = (step: number, clamp = false) => {
      handled();
      const to = stepIndex(at, step, order.length, clamp);
      if (to >= 0) highlight(state, order[to]!);
    };
    const end = (last: boolean) => {
      handled();
      if (order.length) highlight(state, order[last ? order.length - 1 : 0]!);
    };
    // A checkbox row toggles from its checkbox, which keeps the menu open; any other row picks (a click React Aria reads as a press).
    const toggle = (item: HTMLElement) => (item.querySelector<HTMLElement>("input.menu-checkbox") ?? item).click();
    if (ctrlStep) return move(ctrlStep);
    // With the search empty, a number key picks the row showing it (Linear's picker numbers: 0 for "No priority").
    if (/^\d$/.test(event.key) && plain && !search?.value) {
      const numbered = [...(list?.querySelectorAll<HTMLElement>(`[data-number="${event.key}"]`) ?? [])].find(
        (item) => item.closest(".menu") === root.current,
      );
      if (numbered) {
        handled();
        numbered.click();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (event.metaKey || event.altKey) return end(event.key === "ArrowDown");
        return move(event.key === "ArrowDown" ? 1 : -1);
      case "Tab":
        return move(event.shiftKey ? -1 : 1);
      case "Home":
      case "End":
        return end(event.key === "End");
      case "PageDown":
      case "PageUp": {
        const page = Math.max(1, Math.floor((list?.clientHeight ?? 0) / MENU.ITEM_HEIGHT));
        return move(event.key === "PageDown" ? page : -page, true);
      }
      case "ArrowRight":
        // Autocomplete would clear the highlight on an arrow it doesn't use; the caret still moves.
        event.stopPropagation();
        if (key !== null && isSubmenuRow(state, key) && (!search || search.selectionStart === search.value.length)) {
          handled();
          level.actions.open(key, "focus");
        }
        return;
      case "ArrowLeft":
      case "Backspace":
        // Autocomplete would clear the highlight on an arrow it doesn't use; the caret still moves.
        if (event.key === "ArrowLeft") event.stopPropagation();
        // A plain ← at the start of the search, or Backspace on an empty one (not a held key that just emptied it), steps back one
        // level. This one handler on the open submenu's menu, not a hotkey per submenu row (which cost every hover to re-sync).
        if (!submenu || !backKey(event)) return;
        if (
          event.key === "ArrowLeft"
            ? search?.value && !(search.selectionStart === 0 && search.selectionEnd === 0)
            : !search || search.value || event.repeat
        )
          return;
        handled();
        submenu.back();
        return;
      case " ":
        if (!row) {
          if (search?.value) return;
          return move(1);
        }
        if (search?.value && !(afterArrow && plain && row.hasAttribute("aria-checked"))) return;
        handled();
        toggle(row);
        return;
      case "Enter": {
        handled();
        if (!row) return;
        if (!row.hasAttribute("aria-checked")) return row.click();
        if (event.shiftKey) return toggle(row);
        const node = root.current;
        row.click();
        // A row that closes the menu itself unmounts it first.
        setTimeout(() => {
          if (node?.isConnected) surface?.close();
        });
        return;
      }
      case "Escape":
        // Closes every level (Linear's closeParent), here: React Aria's search input stops the key before it can bubble to the
        // surface's own Escape (and Autocomplete would only clear the search).
        handled();
        surface?.close();
        return;
    }
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    const target = event.target as Element;
    if (target.closest(".menu") !== root.current) return;
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
    if (step === "highlight") highlight(state, next);
    if (event.pointerType !== "touch" && isSubmenuRow(state, next))
      level.actions.open(next, "pointer", { x: event.clientX, y: event.clientY });
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
  const seen = useRef<{ key: string | null; search: string | null; value: string | undefined; order: string[] }>({
    key: null,
    search: null,
    value: undefined,
    order: [],
  });
  const key = (state.selectionManager.focusedKey as string | null | undefined) ?? null;
  useLayoutEffect(() => {
    level.actions.share(
      { state, order, list: props.scrollRef?.current ?? null },
      leadsWithHeading(shown as unknown as RankCollection),
    );
    const last = seen.current;
    let next: string | null | undefined;
    const { value, search } = list;
    if (last.search === null) next = level.actions.initial(order);
    else if (value !== undefined && value !== last.value && order.includes(value)) next = value;
    else if (last.search !== search) next = order[0] ?? null;
    else if (key !== null) next = vanishedHighlight(key, last.order.includes(key) ? key : null, order) ?? undefined;
    seen.current = { key, search, value, order };
    if (next !== undefined && next !== key) highlight(state, next);
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
          style={{ "--list-max": maxHeight, scrollPaddingBlock: MENU.ITEM_SCROLL_MARGIN } as CSSProperties}
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
      id={value}
      textValue={value}
      // Kept on React Aria's node for the ranking (menuFilter's keywords) and the keys (rowKeys); not DOM attributes.
      {...({ keywords, muted } as object)}
      isDisabled={disabled}
      onAction={onSelect}
      // The row's `data-value`, which the e2e specs and the row's own lookups read.
      data-value={value}
      {...props}
      render={
        checks !== undefined || title || muted
          ? (dom) => (
              <div
                {...(dom as ComponentProps<"div">)}
                title={title}
                role={checks !== undefined ? "menuitemcheckbox" : (dom as ComponentProps<"div">).role}
                aria-checked={checks}
                aria-disabled={muted || undefined}
              />
            )
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

/** Writes the safe triangle from `point` to `popup`'s box into `node`'s style, or hides it while the pointer is inside the popup. */
function drawTriangle(node: HTMLElement, popup: HTMLElement | null, { x, y }: Point) {
  const box = popup?.getBoundingClientRect(),
    style = box && safeTriangle(box, x, y);
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
 * React Aria's own submenu guard (useSafelyMouseToSubmenu) turns the parent's pointer events off by its own estimate instead; the
 * menu list keeps them on (index.css) so this one decides.
 */
function SafeTriangle({ popup, from, placed }: { popup: RefObject<HTMLElement | null>; from?: Point; placed: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // The point the triangle was last sampled at, and whether the submenu has its place to draw against.
  const at = useRef<Point | null>(null),
    ready = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const throttle = new Throttler(
      (point: Point) => {
        at.current = point;
        if (ready.current) drawTriangle(node, popup.current, point);
      },
      { wait: 50, leading: true, trailing: true },
    );
    const move = (event: globalThis.PointerEvent) => throttle.maybeExecute({ x: event.clientX, y: event.clientY });
    addEventListener("pointermove", move, { passive: true });
    return () => {
      removeEventListener("pointermove", move);
      throttle.cancel();
    };
  }, [popup]);
  // Once the submenu is placed, and again whenever it moves, the triangle is redrawn from the last sample: at first, where the
  // pointer opened the submenu, so the first move toward it is already covered.
  useEffect(() => {
    ready.current = placed !== null;
    const node = ref.current,
      point = at.current ?? from;
    if (node && ready.current && point) drawTriangle(node, popup.current, point);
  }, [placed, popup, from]);
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
      const next = submenuPlacement({
        row: box,
        edge: popupEdge(anchor),
        width: node.offsetWidth,
        height: node.scrollHeight + node.offsetHeight - node.clientHeight,
        first: first ? first.getBoundingClientRect().top - frame.top : 0,
        side,
        view: { width: innerWidth, height: innerHeight },
      });
      const kept = settle(settled, box.top, next.top);
      settled = kept.settled;
      return { ...next, top: kept.top };
    }, setPlace);
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
  // A submenu opened by a key takes focus at once; the pointer's and a preview's leave it in the parent.
  useLayoutEffect(() => {
    if (opened.how === "focus") focusInside();
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- On each opening; the helper reads the popup.
  }, [opened]);
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
      style={{
        position: "fixed",
        top: place?.top ?? 0,
        left: place?.left ?? 0,
        right: "auto",
        bottom: "auto",
        maxHeight: place?.maxHeight,
        zIndex: 60,
        visibility: place ? "visible" : "hidden",
      }}
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
        <SafeTriangle popup={popup} from={opened.at} placed={place ? `${place.left},${place.top}` : null} />
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
    <SubmenuTrigger delay={NO_HOVER_OPEN} {...({ id: SUBMENU + value, keywords } as object)}>
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
});
