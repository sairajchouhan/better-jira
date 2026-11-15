/**
 * The menu geometry menu.tsx and menu-surface.tsx share: Linear's `Vw` constants and the `_3e` rooms. Its own module so the two
 * never import each other.
 */

/**
 * Linear's one menu primitive, `IB = Object.assign(B3e, {List, Item, GroupHeader, Divider, TextDivider, Input})` in
 * startup-root.CnUSfl4j.js; every action menu, property picker and filter menu renders through it. Its geometry is `Vw`, copied
 * here. The `.menu*` classes in index.css spell these values out and are the only menu row styles.
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

/**
 * The most a menu may be tall (Linear's `_3e` `D`, startup-root.CnUSfl4j.js): the window less Vw.VIEWPORT_PADDING above and below
 * (`y = height - 2 * VIEWPORT_PADDING`). A submenu, opened beside its row (`positioning: "horizontal"`), may instead run from that row
 * to VIEWPORT_PADDING off the bottom when that is over half the window (`height - row.top - VIEWPORT_PADDING > height * .5`).
 */
export function menuRoom(windowHeight: number, rowTop?: number): number {
  const below = rowTop === undefined ? 0 : windowHeight - rowTop - MENU.VIEWPORT_PADDING;
  return below > windowHeight * 0.5 ? below : windowHeight - 2 * MENU.VIEWPORT_PADDING;
}

/** Linear's `y3e`: an action menu (`rgn`, `limitHeight: j ?? true`) too tall for its room is cut to its first 18 rows. */
export const LIMIT_ROWS = 18;

/**
 * Linear's `limitHeight` (true) as Menu.List's `maxHeight`: not a cap of its own. Only a list too tall for its room is cut, and
 * then to no more than its first LIMIT_ROWS rows and 80% of the window (`_3e`'s `M` pushes those caps only after `t<=r` fails;
 * limitCap in menu.tsx). A list that fits shows every row, however many.
 */
export const LIMIT_HEIGHT = "limit";

/** The 18-row height when fewer than LIMIT_ROWS rows are laid out (a virtualized list's DOM): rows of ITEM_HEIGHT and the top padding. */
export const LIMIT_ROWS_HEIGHT = LIMIT_ROWS * MENU.ITEM_HEIGHT + MENU.LIST_PADDING;

/** Linear's `D` falls back to the whole window when the preferred side has less than this share of it (`i < v * .3`). */
export const PREFERRED_SIDE_MIN = 0.3;

/**
 * Where a menu under its trigger goes and how tall it may be (Linear's `_3e` `D` for a non-horizontal positioning, then `x3e`
 * over ["bottom", "top"]). Its room is the preferred side's, below the trigger: the window under it less the gap and
 * VIEWPORT_PADDING; when that is under PREFERRED_SIDE_MIN of the window (or the trigger has no width) it is the whole window less
 * VIEWPORT_PADDING each end instead. The menu, cut to that room, sits `gap` under the trigger when it fits there, else `gap` over
 * it when it fits there, else as low as fits, `edge` inside the window (`S3e` clamps, and x3e falls back to its first placement).
 * `height` is the menu's own height; the room is taken from the window alone, never from it, so a cut menu can grow back.
 */
export function anchoredPlacement({
  trigger,
  height,
  windowHeight,
  gap,
  edge = 12,
}: {
  trigger: { top: number; bottom: number; width: number };
  height: number;
  windowHeight: number;
  gap: number;
  edge?: number;
}): { below: boolean; top: number; maxHeight: number } {
  const below = windowHeight - trigger.bottom - gap - MENU.VIEWPORT_PADDING;
  const room =
    trigger.width === 0 || below < windowHeight * PREFERRED_SIDE_MIN
      ? Math.max(below, windowHeight - 2 * MENU.VIEWPORT_PADDING)
      : below;
  const maxHeight = Math.max(100, room),
    shown = Math.min(height, maxHeight);
  if (trigger.bottom + gap + shown <= windowHeight - edge) return { below: true, top: trigger.bottom + gap, maxHeight };
  if (trigger.top - gap - shown >= edge) return { below: false, top: trigger.top - gap - shown, maxHeight };
  return { below: true, top: Math.max(edge, windowHeight - shown - edge), maxHeight };
}

/** A submenu's room across: Linear's x3e keeps it 12px inside the window's sides (`rT`) and 10px inside its top and bottom (`nT`). */
const SIDE_EDGE = 12,
  END_EDGE = 10;

/**
 * Where a submenu opens beside its row (Linear's x3e with `positioning: "horizontal"`, then S3e's clamp): on `side`, overlapping its
 * menu's border box (`edge`) by 2px, with its first row (`first` px into the submenu) level with the row; it swaps to the other side
 * only when its own doesn't fit and that one does (when neither fits, the roomier side), never dropping under its row, and is
 * clamped 12px inside the window across and 10px down (over its menu when neither side fits). Its height is capped to `menuRoom`
 * from its row; `height` is its height under that cap.
 */
export function submenuPlacement({
  row,
  edge,
  width,
  height,
  first,
  side,
  view,
}: {
  row: { top: number };
  edge: { left: number; right: number };
  width: number;
  height: number;
  first: number;
  side: "right" | "left";
  view: { width: number; height: number };
}): { left: number; top: number; maxHeight: number } {
  const right = edge.right - 2,
    left = edge.left + 2 - width;
  const overflow = (x: number) => Math.max(0, x + width - (view.width - SIDE_EDGE)) + Math.max(0, SIDE_EDGE - x);
  const [preferred, other] = side === "right" ? [right, left] : [left, right];
  const x = !overflow(preferred) || (overflow(other) > 0 && overflow(other) >= overflow(preferred)) ? preferred : other;
  const maxHeight = menuRoom(view.height, row.top),
    shown = Math.min(height, maxHeight);
  return {
    left: Math.max(SIDE_EDGE, Math.min(view.width - SIDE_EDGE - width, x)),
    top: Math.max(END_EDGE, Math.min(view.height - END_EDGE - shown, row.top - first)),
    maxHeight,
  };
}

/**
 * Keeps an open submenu where it first settled while its row stays put: typing in its search shrinks its list from the bottom, as
 * in Linear, and re-aligning or un-clamping a shorter list would move the search out from under the pointer. `settled` is this
 * opening's memory (a new popup starts over); returns the top to use and the memory to keep.
 */
export function settle(
  settled: { row: number; top: number } | null,
  row: number,
  top: number,
): { top: number; settled: { row: number; top: number } } {
  if (settled && settled.row === row) return { top: settled.top, settled };
  return { top, settled: { row, top } };
}
