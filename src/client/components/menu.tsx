/* oxlint-disable react/refs -- The submenu reads its floating node and focus target from refs in event handlers and floating-ui callbacks. */
import {
  autoUpdate,
  flip,
  FloatingNode,
  offset,
  shift,
  size,
  useFloating,
  useFloatingNodeId,
  type Middleware,
} from "@floating-ui/react";
import { Throttler } from "@tanstack/pacer";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import {
  createContext,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { MenuSurfaceContext } from "./menu-surface";
import { MENU, menuRoom } from "./menu-geometry";
import { Shortcut, type Keys } from "./keycap";
import { NO_AUTOFILL } from "@/client/components/field";
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

// What k3e measures: Linear's `[data-list-row]`, which its search row, action rows and empty state carry.
const LIST_ROWS = ".menu-input, .menu-item, .menu-empty, [data-list-row]";

/** The band of the window `node` shows: the window, cut by every ancestor that clips its overflow up to the first fixed one (a
 *  submenu is fixed beside the menu it is portalled into, so that menu's scroll box doesn't clip it). */
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
    (row) => row.closest("[cmdk-root]") === node && row.getClientRects().length,
  );
  const [start, end] = renderedRows(
    rows.map((row) => row.getBoundingClientRect()),
    visibleBand(node.querySelector("[cmdk-list]") ?? node),
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
 * arriving: at once and once more within 150ms, Linear's throttle), and as it scrolls or the window resizes. The list adds nothing
 * to the menu's width itself (`contain: inline-size`, index.css), so a long list's widest row far down never sets it.
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
    const moved = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !target.contains(node) && !node.contains(target)) return;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    addEventListener("scroll", moved, { capture: true, passive: true });
    addEventListener("resize", moved);
    return () => {
      rows.disconnect();
      changed.cancel();
      cancelAnimationFrame(frame);
      removeEventListener("scroll", moved, { capture: true });
      removeEventListener("resize", moved);
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
  "[cmdk-item], [cmdk-group-heading], [cmdk-separator], .menu-group-header, .menu-text-divider, .menu-empty, [data-list-row]";
// The popup a menu sits in: a modal surface, a submenu or a toolbar popover.
const POPUP = '[role="dialog"], [data-popover]';

/**
 * One `_3e` measure of the menu `node`: caps its list's max-height so the menu stays inside its room (menuRoom, and every box
 * around it with a max-height of its own), cut so the last row in view shows at least LAST_ROW_SHOWN. The search and anything else
 * outside the list stay put; only the list scrolls. A menu outside any popup is only cut to its list's own cap.
 */
function fitHeight(node: HTMLElement) {
  const list = [...node.querySelectorAll<HTMLElement>("[cmdk-list]")].find((l) => l.closest("[cmdk-root]") === node);
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
      .filter((row) => row.closest("[cmdk-root]") === node && row.getClientRects().length)
      .map((row) => {
        const box = row.getBoundingClientRect();
        return { top: box.top - top, height: box.height };
      });
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

// cmdk's own row query: every enabled row, in order.
const ROWS = '[cmdk-item]:not([aria-disabled="true"])';
// Linear's J4e moves the highlight on these, and only these let a highlighted submenu row open its preview (canOpenSubmenuOnFocus).
const NAVIGATION = new Set(["ArrowDown", "ArrowUp", "Tab", "PageDown", "PageUp", "Home", "End"]);

/** What one menu level shares with its submenu rows (Linear's i3e). */
type MenuLevel = {
  actions: {
    /** Adds a submenu row, so a highlight change can close it or preview it; returns the removal. */
    register: (value: string, submenu: SubmenuHandle) => () => void;
    /** A submenu opened: its row takes the highlight. */
    opened: (value: string) => void;
  };
  meta: { root: RefObject<HTMLDivElement | null> };
};
type Point = { x: number; y: number };
type SubmenuHandle = {
  open: boolean;
  close: () => void;
  preview: () => void;
  /** The pointer highlighted the row at `at`: open the submenu without moving focus (Linear's openSubMenuOnFocus). */
  hover: (at: Point) => void;
};
const MenuLevelContext = createContext<MenuLevel | null>(null);

/**
 * What a pointer move onto row `next` does, given the row the pointer was last on (`under`) and the highlighted row: a move
 * within the highlighted row does nothing, so a submenu a key closed stays closed; entering a row, or moving on one a key moved
 * the highlight off, highlights it and opens its submenu. Entering the row that already holds the highlight still opens its
 * submenu ("enter"): cmdk selects a pristine menu's first row unseen, and the pointer reaching it must open it (Linear's
 * openSubMenuOnFocus).
 */
export function pointerStep(next: string, under: string | null, highlighted: string): "stay" | "enter" | "highlight" {
  if (next !== highlighted) return "highlight";
  return next === under ? "stay" : "enter";
}

/**
 * Where the highlight goes once the rows are `values`: when the highlighted row, seen in an earlier render (`shown`), left the
 * list, onto the first row, as Linear's command menu moves a focused row id it no longer finds to the first action (`B6e`);
 * otherwise nowhere (null). cmdk alone can't: it reselects while the leaving rows are still in the DOM, so a whole group going
 * (⌘K's issue commands after ⌫ drops the issue) leaves the highlight on a removed row (R3-palette-shortcuts-D3).
 */
export function vanishedHighlight(highlighted: string, shown: string | null, values: string[]): string | null {
  if (!highlighted || shown !== highlighted || values.includes(highlighted)) return null;
  return values[0] ?? null;
}

/**
 * The cmdk root, owning the highlight so every menu shares Linear's J4e rules:
 * - A highlight change closes any other open submenu. A highlight moved by a navigation key previews a submenu row after 300ms;
 *   one moved by the pointer opens it at once. Rows the pointer crosses on its way into an open submenu are covered by the
 *   submenu's safe triangle, so they never see it (Linear's JCe).
 * - Tab and Shift+Tab step like ↓ and ↑; PageDown and PageUp move a page and stop at the ends.
 * - → opens the highlighted submenu row when the caret is at the end of the search.
 * - Space, with the search empty (or mid-search right after ↑/↓ on a checkbox row), opens a submenu row, toggles a checkbox row
 *   and keeps the menu open, or picks any other row.
 * - Enter on a checkbox row picks it and closes the menu; Shift+Enter toggles it and keeps the menu open.
 * - With the search empty, a digit picks the row whose `data-number` it is.
 *
 * Its width is `width`: by default measured from its rows as Linear's `k3e` does (useRowWidth); a number is Linear's `fixedWidth`
 * (a property picker's 206px); "auto" leaves it to the box around it and its rows' content, for the menus that aren't Linear's `IB`
 * (the command menu's 720px, a Select's list). Every `IB` menu (not "auto") is as tall as Linear's `_3e` allows (useListHeight).
 */
function MenuRoot({
  className = "",
  width,
  style,
  ref,
  value,
  defaultValue,
  onValueChange,
  onKeyDown,
  onPointerMove,
  onPointerLeave,
  onChange,
  children,
  ...props
}: ComponentProps<typeof Command> & { width?: number | "auto" }) {
  const root = useRef<HTMLDivElement>(null);
  useRowWidth(root, width === undefined);
  useListHeight(root, width !== "auto");
  const surface = use(MenuSurfaceContext);
  const [own, setOwn] = useState(defaultValue ?? "");
  const highlighted = value ?? own;
  const submenus = useRef(new Map<string, SubmenuHandle>());
  // Whether the last key moved the highlight; whether it was ↑/↓; whether to scroll the highlight into view; the row the pointer is on.
  const previews = useRef(false),
    arrowed = useRef(false),
    scrolls = useRef(false),
    under = useRef<string | null>(null);
  const highlight = (next: string) => {
    setOwn(next);
    onValueChange?.(next);
    for (const [key, submenu] of submenus.current) if (key !== next) submenu.close();
    if (previews.current) submenus.current.get(next)?.preview();
  };
  const level: MenuLevel = {
    actions: {
      register: (key, submenu) => {
        submenus.current.set(key, submenu);
        return () => {
          if (submenus.current.get(key) === submenu) submenus.current.delete(key);
        };
      },
      opened: (key) => {
        if (key !== highlighted) highlight(key);
      },
    },
    meta: { root },
  };
  const rows = () =>
    [...(root.current?.querySelectorAll<HTMLElement>(ROWS) ?? [])].filter(
      (row) => row.closest("[cmdk-root]") === root.current,
    );
  /** Moves the highlight `step` rows, wrapping, or with `clamp` stopping at the ends (Linear's handleMoveFocus). */
  const move = (step: number, clamp = false) => {
    const all = rows(),
      // A pristine menu (Linear's focusedIndex -1) shows no highlight, so the first step lands on an end.
      at = root.current?.hasAttribute("data-pristine")
        ? -1
        : all.findIndex((row) => row.getAttribute("aria-selected") === "true"),
      n = all.length;
    if (!n) return;
    const to =
      at < 0 ? (step > 0 ? 0 : n - 1) : clamp ? Math.max(0, Math.min(n - 1, at + step)) : (at + step + n) % n;
    scrolls.current = true;
    highlight(all[to]!.getAttribute("data-value") ?? "");
  };
  const shown = useRef<string | null>(null);
  // Reads the rendered rows, which every child render can change, so it runs after each render.
  useLayoutEffect(() => {
    const values = rows().map((row) => row.getAttribute("data-value") ?? "");
    const next = vanishedHighlight(highlighted, shown.current, values);
    if (values.includes(highlighted)) shown.current = highlighted;
    if (next !== null) highlight(next);
  });
  // cmdk scrolls its own keyboard moves before a controlled value lands, so the menu scrolls the highlight itself (the rows'
  // aria-selected catches up a render later, so the row is found by its value).
  useLayoutEffect(() => {
    if (!scrolls.current) return;
    scrolls.current = false;
    rows()
      .find((row) => row.getAttribute("data-value") === highlighted)
      ?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Runs when the highlight changes; `rows` reads the DOM.
  }, [highlighted]);
  return (
    <MenuLevelContext value={level}>
      <Command
        loop
        {...props}
        value={highlighted}
        disablePointerSelection
        onValueChange={(next) => {
          scrolls.current = true;
          highlight(next);
        }}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          previews.current = false;
          const row = (event.target as Element).closest<HTMLElement>("[cmdk-item]");
          if (!row || row.closest("[cmdk-root]") !== root.current || row.getAttribute("aria-disabled") === "true") {
            under.current = null;
            return;
          }
          const next = row.getAttribute("data-value") ?? "";
          const step = pointerStep(next, under.current, highlighted);
          under.current = next;
          if (step === "stay") return;
          if (step === "highlight") highlight(next);
          if (event.pointerType !== "touch") submenus.current.get(next)?.hover({ x: event.clientX, y: event.clientY });
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          under.current = null;
        }}
        onChange={(event) => {
          onChange?.(event);
          if ((event.target as Element).closest("[cmdk-root]") !== root.current) return;
          // Linear closes a preview when the search changes.
          previews.current = false;
          for (const submenu of submenus.current.values()) submenu.close();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          const target = event.target as HTMLElement;
          if (event.defaultPrevented || event.nativeEvent.isComposing || target.closest("[cmdk-root]") !== root.current)
            return;
          const search = target instanceof HTMLInputElement ? target : null,
            pristine = root.current?.hasAttribute("data-pristine"),
            row = pristine ? undefined : rows().find((item) => item.getAttribute("aria-selected") === "true"),
            plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey,
            afterArrow = arrowed.current;
          previews.current =
            NAVIGATION.has(event.key) || (event.ctrlKey && ["n", "j", "p", "k"].includes(event.key));
          if (event.key !== " ") arrowed.current = event.key === "ArrowDown" || event.key === "ArrowUp";
          // A checkbox row toggles from its checkbox, which keeps the menu open; any other row picks.
          const toggle = (item: HTMLElement) =>
            (item.querySelector<HTMLElement>("input.menu-checkbox") ?? item).click();
          // A pristine menu has no highlight for cmdk's own ↓ to step from, so its first ↓, ↑ or Space lands on an end itself
          // (and so previews a submenu row there).
          if (pristine && (event.key === "ArrowDown" || event.key === "ArrowUp" || (event.key === " " && !search?.value))) {
            event.preventDefault();
            move(event.key === "ArrowUp" ? -1 : 1);
            return;
          }
          // With the search empty, a number key picks the row showing it (Linear's picker numbers: 0 for "No priority").
          if (/^\d$/.test(event.key) && plain && !search?.value) {
            const numbered = rows().find((item) => item.dataset.number === event.key);
            if (numbered) {
              event.preventDefault();
              numbered.click();
            }
            return;
          }
          switch (event.key) {
            case "Tab":
              event.preventDefault();
              move(event.shiftKey ? -1 : 1);
              return;
            case "PageDown":
            case "PageUp": {
              event.preventDefault();
              const list = root.current?.querySelector("[cmdk-list]");
              const page = Math.max(1, Math.floor((list?.clientHeight ?? 0) / MENU.ITEM_HEIGHT));
              move(event.key === "PageDown" ? page : -page, true);
              return;
            }
            case "ArrowRight":
              if (
                row?.hasAttribute("aria-haspopup") &&
                (!search || search.selectionStart === search.value.length)
              ) {
                event.preventDefault();
                row.click();
              }
              return;
            case " ":
              if (!row || (search?.value && !(afterArrow && plain && row.hasAttribute("aria-checked")))) return;
              event.preventDefault();
              toggle(row);
              return;
            case "Enter":
              if (!row?.hasAttribute("aria-checked")) return;
              if (event.shiftKey) {
                event.preventDefault();
                toggle(row);
              } else {
                const node = root.current;
                // After cmdk's own Enter has picked the row; a row that closes the menu itself unmounts it first.
                setTimeout(() => {
                  if (node?.isConnected) surface?.close();
                });
              }
          }
        }}
        ref={(node) => {
          root.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        data-width={width === undefined ? "rows" : undefined}
        style={typeof width === "number" ? { ...style, width } : style}
        className={`menu ${className}`}
      >
        {children}
      </Command>
    </MenuLevelContext>
  );
}

/** Linear's Zw: a 36px search row over a hairline, with an optional trailing `hotkey` (the registry chord that opens the menu, drawn as
 *  Linear's small Shortcut: ign's inputAdditionalContent). `hideWhenEmpty` keeps it focused but visually hidden until typing starts
 *  (B3e's hideInputWhenEmpty, used by action menus). */
function MenuInput({
  hotkey,
  hideWhenEmpty = false,
  chip,
  ...props
}: ComponentProps<typeof Command.Input> & {
  hotkey?: string | readonly string[];
  hideWhenEmpty?: boolean;
  /** Drawn before the search: the nested command page's parent name (Linear's `nameAsParent` chip). */
  chip?: ReactNode;
}) {
  const hidden = hideWhenEmpty && !props.value;
  return (
    <div className={hidden ? "sr-only" : "menu-input"}>
      {chip && <span className="menu-input-chip">{chip}</span>}
      <Command.Input {...NO_AUTOFILL} {...props} className={hidden ? "sr-only" : undefined} />
      {hotkey && <Shortcut aria-hidden keys={hotkey} size="small" />}
    </div>
  );
}

/**
 * Linear's N6e: the scrolling rows, 6px above and below. Keyboard scrolling keeps ITEM_SCROLL_MARGIN of context past the highlight.
 * `maxHeight` is Linear's `maxHeight` prop, a cap of the menu's own (`--list-max`, index.css); the menu cuts it further to its room
 * (useListHeight owns the list's max-height).
 */
function MenuList({ maxHeight, ...props }: ComponentProps<typeof Command.List> & { maxHeight?: string }) {
  return (
    <Command.List
      {...props}
      className="menu-list"
      style={{ "--list-max": maxHeight, scrollPaddingBlock: MENU.ITEM_SCROLL_MARGIN } as CSSProperties}
    />
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
            onClick={(event) => event.stopPropagation()}
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

/** Linear's Item: a full-width 32px row owning 14/18 padding; its highlight is inset 6px with radius 8 (fT.itemContainer). */
function MenuItem({
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
}: Omit<ComponentProps<typeof Command.Item>, "className" | "children"> &
  ItemSlots & { children: ReactNode }) {
  return (
    <Command.Item
      aria-checked={checkbox ?? props["aria-checked"]}
      {...props}
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
    </Command.Item>
  );
}

/** A cmdk group under Linear's 30px GroupHeader (aT); filtering hides it with its last row. */
function MenuGroup(props: Omit<ComponentProps<typeof Command.Group>, "className">) {
  return <Command.Group {...props} className="menu-group" />;
}

/** Linear's GroupHeader (aT) outside a cmdk group. */
function MenuGroupHeader({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="menu-group-header">
      {children}
    </div>
  );
}

/** Linear's Divider (pT): 12px with a centred hairline. Hidden while the menu is filtered. */
function MenuDivider() {
  return <Command.Separator className="menu-divider" />;
}

/** Linear's TextDivider (O6e): a 30px muted caption between rows. */
function MenuTextDivider({ children }: { children: ReactNode }) {
  return <div className="menu-text-divider">{children}</div>;
}

/** Linear's 42px empty state. `always` shows it outside cmdk's own filtering (menus with shouldFilter={false}).
 *  Linear derives it from its rows during render (B3e), so a menu never opens showing it. cmdk's Empty reads its count, which is 0
 *  on the first commit, before the rows register: a popup measured then is 42px too tall and jumps when it re-measures (the
 *  sidebar Help menu). So it waits one commit for cmdk to count the rows. */
function MenuEmpty({ children, always = false }: { children: ReactNode; always?: boolean }) {
  const [counted, setCounted] = useState(always);
  // oxlint-disable-next-line react/set-state-in-effect -- waits for cmdk's store, external to React, to register the rows
  useLayoutEffect(() => setCounted(true), []);
  if (always) return <div className="menu-empty">{children}</div>;
  return counted ? <Command.Empty className="menu-empty">{children}</Command.Empty> : null;
}

type Container = RefObject<HTMLElement | null>;

/** How far the row's edge on `side` sits inside its popup's border, so the submenu overlaps the popup by Linear's 2px. */
function edgeInset(row: Element, side: "right" | "left") {
  const box = row.getBoundingClientRect();
  for (let node = row.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (parseFloat(side === "right" ? style.borderRightWidth : style.borderLeftWidth)) {
      const edge = node.getBoundingClientRect();
      return side === "right" ? edge.right - box.right : box.left - edge.left;
    }
  }
  return 0;
}

/** Keeps an open submenu where it first settled while its row stays put. Typing in its search shrinks the list from the bottom, as in
 *  Linear: re-aligning on a list with no first row, or un-shifting a shorter one, would move the search out from under the pointer
 *  and close the menu. Each opening mounts a new popup node, which starts over. One per submenu (`useState(stay)`): the memory is
 *  the middleware's own, since a ref handed to it during render would make the React Compiler skip the row (BJ-233). */
export const stay = (): Middleware => {
  let settled: { popup: Element; row: number; y: number } | null = null;
  return {
    name: "stay",
    fn: ({ y, rects, elements }) => {
      const row = rects.reference.y;
      if (settled?.popup === elements.floating && settled.row === row) return { y: settled.y };
      settled = { popup: elements.floating, row, y };
      return {};
    },
  };
};

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
 * `placed` is null until floating-ui has placed the submenu and then changes whenever it moves: the triangle is drawn against
 * the box the submenu has, never the unplaced one, which would leave it over the wrong parent rows while the pointer rests.
 */
function SafeTriangle({
  popup,
  from,
  placed,
}: {
  popup: RefObject<HTMLElement | null>;
  from: RefObject<Point | null>;
  placed: string | null;
}) {
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
    const move = (event: PointerEvent) => throttle.maybeExecute({ x: event.clientX, y: event.clientY });
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
      point = at.current ?? from.current;
    if (node && ready.current && point) drawTriangle(node, popup.current, point);
  }, [placed, popup, from]);
  return <div ref={ref} aria-hidden data-safe-triangle style={{ display: "none" }} />;
}

/**
 * A row that opens a nested menu (Linear's Item `SubMenu`): the pointer highlighting it opens it, ArrowRight, Enter or Space opens and
 * focuses it, a keyboard highlight that rests on the row for 300ms previews it without moving focus (Linear's _6e). The pointer
 * entering the submenu focuses it; leaving it hands focus back to this menu and leaves it open (Linear's requestFocus and
 * yieldFocus), until this menu's highlight moves to another row. ArrowLeft and Backspace on an empty search return to this menu;
 * Escape closes the whole menu, as Linear's does. It opens beside the row on `side`,
 * overlapping its menu by 2px, with its first row level with this one, and only swaps sides when it doesn't fit. The nested menu is
 * portalled into `container` so it stays inside the parent popup's focus scope.
 */
function MenuSubmenu({
  value,
  label,
  open,
  onOpenChange,
  container,
  side = "right",
  popupLabel = value,
  children,
  ...slots
}: Omit<ItemSlots, "checkbox" | "onCheckboxClick" | "checkboxLabel" | "checked" | "description"> & {
  value: string;
  label: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: Container;
  side?: "right" | "left";
  /** The nested menu's accessible name; the row's value by default. */
  popupLabel?: string;
  children: ReactNode;
}) {
  const id = useId(),
    nodeId = useFloatingNodeId(),
    level = use(MenuLevelContext),
    surface = use(MenuSurfaceContext),
    row = useRef<HTMLDivElement>(null),
    focusOnOpen = useRef(false),
    // A keyboard preview keeps focus in the parent menu until → or the pointer moves in.
    previewing = useRef(false),
    previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    // Where the pointer opened the submenu from, the safe triangle's first corner.
    hoveredAt = useRef<Point | null>(null),
    [keep] = useState(stay);
  const setOpen = (next: boolean) => {
    // An explicit open or close supersedes a pending keyboard preview, which would otherwise reopen a menu just closed.
    clearTimeout(previewTimer.current);
    if (next) level?.actions.opened(value);
    onOpenChange(next);
  };
  const { refs, floatingStyles, isPositioned, x, y } = useFloating({
    nodeId,
    open,
    onOpenChange: (next) => {
      focusOnOpen.current = false;
      previewing.current = false;
      setOpen(next);
    },
    placement: side === "right" ? "right-start" : "left-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ elements }) => {
        const first = elements.floating.querySelector("[cmdk-item]");
        return {
          mainAxis: edgeInset(elements.reference as Element, side) - 2,
          alignmentAxis: first
            ? elements.floating.getBoundingClientRect().top - first.getBoundingClientRect().top
            : 0,
        };
      }),
      // Linear's x3e: a submenu keeps to a side, only swapping right and left, and is clamped 10px inside the window down and 12px
      // across (over its parent when neither side fits); it never drops under its row.
      flip({ padding: 12, crossAxis: false }),
      // Its room (_3e for "horizontal"): from its row to the bottom when that is over half the window, else the window less 16px
      // each end; its menu cuts its list to fit (useListHeight), and shift then moves it up into the window.
      size({
        apply: ({ elements }) => {
          const room = menuRoom(innerHeight, elements.reference.getBoundingClientRect().top);
          elements.floating.style.maxHeight = `${room}px`;
        },
      }),
      shift({ padding: { top: 10, bottom: 10, left: 12, right: 12 }, crossAxis: true }),
      keep,
    ],
  });
  const parentInput = () => level?.meta.root.current?.querySelector<HTMLInputElement>("input");
  /** Linear's yieldFocus: focus goes back to the parent menu, so its Escape and keys work, and the submenu stays open. */
  const yieldFocus = () => {
    if (refs.floating.current?.contains(document.activeElement)) parentInput()?.focus();
  };
  const focusInside = () => {
    previewing.current = false;
    const node = refs.floating.current;
    (node?.querySelector<HTMLElement>("input") ?? node?.querySelector<HTMLElement>("select,button"))?.focus();
  };
  const back = () => {
    setOpen(false);
    parentInput()?.focus();
  };
  useEffect(() =>
    level?.actions.register(value, {
      open,
      close: () => {
        clearTimeout(previewTimer.current);
        if (open) onOpenChange(false);
      },
      hover: (at) => {
        if (open) return;
        hoveredAt.current = at;
        focusOnOpen.current = false;
        previewing.current = false;
        setOpen(true);
      },
      preview: () => {
        clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(() => {
          if (open || row.current?.getAttribute("aria-selected") !== "true") return;
          focusOnOpen.current = false;
          previewing.current = true;
          setOpen(true);
        }, 300);
      },
    }),
  );
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  // ← at the start of the search, or Backspace on an empty one (not a held key that just emptied it), steps back one level.
  useHotkey(
    "ArrowLeft",
    (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (input?.value && input.selectionStart !== 0) return;
      event.preventDefault();
      back();
    },
    { target: refs.floating, capture: true, ignoreInputs: false, preventDefault: false },
  );
  useHotkey(
    "Backspace",
    (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input || input.value || event.repeat) return;
      event.preventDefault();
      back();
    },
    { target: refs.floating, capture: true, ignoreInputs: false, preventDefault: false },
  );
  useEffect(() => {
    if (open && isPositioned && focusOnOpen.current) {
      focusInside();
      focusOnOpen.current = false;
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Focus only on the open/positioned transition; the render-local helper changes each render.
  }, [open, isPositioned]);
  useEffect(() => {
    if (!open) return;
    const node = refs.floating.current;
    return () => {
      // By the time this runs the submenu's node is gone, and the focus it held has fallen to <body>.
      const active = document.activeElement;
      if (!active || active === document.body || node?.contains(active)) parentInput()?.focus();
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Cleanup resolves the parent menu's input when the submenu closes.
  }, [open, refs.floating]);
  useEffect(() => {
    if (!open) hoveredAt.current = null;
  }, [open]);
  return (
    <FloatingNode id={nodeId}>
      <Command.Item
        ref={(node) => {
          row.current = node;
          refs.setReference(node);
        }}
        value={value}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onSelect={() => {
          focusOnOpen.current = true;
          if (open) focusInside();
          else setOpen(true);
        }}
        className="menu-item"
      >
        <ItemContent {...slots} submenu>
          {label}
        </ItemContent>
      </Command.Item>
      {open &&
        container.current &&
        createPortal(
          <div
            id={id}
            // Through a function: the setter itself as `ref` makes the React Compiler skip this row (BJ-233).
            ref={(node) => refs.setFloating(node)}
            style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
            role="dialog"
            aria-label={popupLabel}
            // The pointer over the submenu's rows takes focus in; over its safe triangle it is on its way out, so it yields. Events
            // from a nested submenu (portalled beside this one, a React child) are that one's to handle.
            onPointerMove={(event) => {
              const target = event.target as Element;
              if (!event.currentTarget.contains(target) || event.buttons) return;
              if (target.hasAttribute("data-safe-triangle")) yieldFocus();
              else if (!event.currentTarget.contains(document.activeElement)) focusInside();
            }}
            onPointerLeave={(event) => {
              if (!event.buttons) yieldFocus();
            }}
            // cmdk moves focus to a menu's search when it first highlights a row; a preview hands it straight back.
            onFocus={() => {
              if (previewing.current) parentInput()?.focus();
            }}
            // Escape closes every level (Linear's closeParent); Tab moves this menu's highlight and reaches the popup's focus trap.
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Tab") return;
              event.stopPropagation();
              if (event.key === "Escape" && surface) {
                event.preventDefault();
                surface.close();
              }
            }}
          >
            <SafeTriangle popup={refs.floating} from={hoveredAt} placed={isPositioned ? `${x},${y}` : null} />
            {children}
          </div>,
          container.current,
        )}
    </FloatingNode>
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
