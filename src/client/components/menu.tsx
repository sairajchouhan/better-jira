/* oxlint-disable react/refs -- The submenu reads its floating node and focus target from refs in event handlers and floating-ui callbacks. */
import {
  autoUpdate,
  flip,
  FloatingNode,
  offset,
  shift,
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
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { MenuSurfaceContext } from "./menu-surface";
import { Shortcut, type Keys } from "./keycap";
import { NO_AUTOFILL } from "@/client/components/field";
import { safeTriangle } from "./safe-triangle";

/**
 * Linear's one menu primitive, `IB = Object.assign(B3e, {List, Item, GroupHeader, Divider, TextDivider, Input})` in
 * startup-root.CnUSfl4j.js; every action menu, property picker and filter menu renders through it. Its geometry is `Vw`, copied
 * here. The `.menu*` classes in index.css spell these values out and are the only menu row styles; e2e/menu-geometry.pw.ts pins them.
 */
export const MENU = {
  BORDER_RADIUS: 12,
  INPUT_HEIGHT: 36,
  VIEWPORT_PADDING: 16,
  ITEM_HEIGHT: 32,
  ITEM_WITH_DESCRIPTION_HEIGHT: 64,
  ITEM_WITH_ONE_LINE_DESCRIPTION_HEIGHT: 48,
  ITEM_MIN_WIDTH_WITH_DESCRIPTION: 320,
  ITEM_MAX_WIDTH: 400,
  ITEM_MAX_WIDTH_WITH_CHECKMARK: 350,
  LIST_PADDING: 6,
  ITEM_SCROLL_MARGIN: 24,
  FOOTER_PADDING_BOTTOM: 6,
  LIST_EMPTY_STATE_HEIGHT: 42,
  DIVIDER_HEIGHT: 12,
  TEXT_DIVIDER_HEIGHT: 30,
  GROUP_HEADER_HEIGHT: 30,
  ITEM_PADDING_LEFT: 14,
  ITEM_PADDING_RIGHT: 18,
  ICON_COLUMN_WIDTH: 16,
  CHECKMARK_COLUMN_WIDTH: 16,
  INDENTATION_SLOT_WIDTH: 16,
  LABEL_GAP: 8,
} as const;

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
 */
function MenuRoot({
  className = "",
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
}: ComponentProps<typeof Command>) {
  const root = useRef<HTMLDivElement>(null);
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

/** Linear's N6e: the scrolling rows, 6px above and below. Keyboard scrolling keeps ITEM_SCROLL_MARGIN of context past the highlight. */
function MenuList({ maxHeight, ...props }: ComponentProps<typeof Command.List> & { maxHeight?: string }) {
  return (
    <Command.List
      {...props}
      className="menu-list"
      style={{ maxHeight, scrollPaddingBlock: MENU.ITEM_SCROLL_MARGIN }}
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
 *  and close the menu. */
const stay = (settled: RefObject<{ row: number; y: number } | null>): Middleware => ({
  name: "stay",
  fn: ({ y, rects }) => {
    const row = rects.reference.y;
    if (settled.current?.row === row) return { y: settled.current.y };
    settled.current = { row, y };
    return {};
  },
});

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
    // Where the open submenu first settled, keyed by its row's top (see `stay`).
    settled = useRef<{ row: number; y: number } | null>(null);
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
      shift({ padding: { top: 10, bottom: 10, left: 12, right: 12 }, crossAxis: true }),
      stay(settled),
    ],
  });
  useEffect(() => {
    if (!open) settled.current = null;
  }, [open]);
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
            ref={refs.setFloating}
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
