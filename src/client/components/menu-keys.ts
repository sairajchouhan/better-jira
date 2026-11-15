/**
 * What a key does in a menu: Linear's J4e (startup-root.CnUSfl4j.js @~1849407), as a pure decision the menu then carries out
 * (menu.tsx's keyDown). One place for every menu kind, so each rule has its unit test.
 */

/** What the menu knows as the key goes down. */
export type KeyFacts = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** J4e's `h`: a held key, or the same key pressed again within 200ms of its keyup (`heldKey`). */
  held: boolean;
  /** Linear's `lm.isMac`: Home/End move the highlight only on a Mac; elsewhere they move the search's caret. */
  mac: boolean;
  /** The menu's own search field, or null when the key went down elsewhere in the menu. */
  search: { value: string; start: number | null; end: number | null } | null;
  /** The highlighted row: null with none; `checkbox` for a multi-select row, `submenu` for one that opens a submenu. */
  row: { checkbox: boolean; submenu: boolean } | null;
  /** Whether a row shows this digit (`data-number`). */
  numbered: boolean;
  /** Whether this menu is a submenu, and whether a submenu of its own is open. */
  inSubmenu: boolean;
  childOpen: boolean;
  /** Whether the last key was ↑ or ↓ (J4e's `O`), and whether the menu sits in a surface that can close. */
  afterArrow: boolean;
  hasSurface: boolean;
  /** Rows to a page (PageUp/PageDown). */
  page: number;
};

export type KeyAction =
  /** Not the menu's: the key does what it would anyway (types, moves the caret, reaches the page). */
  | { type: "none" }
  /** Not the menu's, but kept from React Aria's Autocomplete, which would move or clear the highlight on an arrow; the caret moves. */
  | { type: "caret" }
  /** Taken and nothing else: no default, no further handlers. */
  | { type: "swallow" }
  /** Moves the highlight `step` rows, wrapping, or with `clamp` stopping at the ends (Linear's handleMoveFocus). */
  | { type: "move"; step: number; clamp?: boolean }
  /** Moves the highlight to the first or last row. */
  | { type: "end"; last: boolean }
  /** Picks the row showing the digit. */
  | { type: "number" }
  /** Opens the highlighted submenu row and moves focus into it (openSubMenuForFocusedItem). */
  | { type: "open" }
  /** Closes this submenu, focus back in its parent. */
  | { type: "back" }
  /** Closes this menu's open submenu (J4e's `closeSubMenu`). */
  | { type: "closeChild" }
  /** Picks the row: a press, or on a checkbox row a toggle from its checkbox, which keeps the menu open. */
  | { type: "toggle" }
  /** Picks the row with a press. */
  | { type: "pick" }
  /** Picks a checkbox row and closes the menu. */
  | { type: "pickClose" }
  /** Closes every level (closeParent). */
  | { type: "close" }
  /** Escape outside any surface: left to whatever owns the menu, past React Aria's Autocomplete (which would only clear its search). */
  | { type: "release" };

// J4e's Ctrl+n/j and Ctrl+p/k (Emacs and vi) step like ↓ and ↑.
const CTRL_STEPS: Record<string, number> = { n: 1, j: 1, p: -1, k: -1 };

const plainOf = (e: Pick<KeyFacts, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) =>
  !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

/** J4e's last keyup (`k`): its key and when, with the time zeroed for an arrow's own keyup. */
export type KeyUp = { key: string; time: number };
export const NO_KEYUP: KeyUp = { key: "", time: 0 };
const ARROWS = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];

/** J4e's onKeyUp: remembers the key, but an arrow's keyup clears the time, so ←/→ pressed again at once still act. */
export const keyUpMark = (event: { key: string; repeat: boolean }, now: number): KeyUp => ({
  key: event.key,
  time: !event.repeat && ARROWS.includes(event.key) ? 0 : now,
});

/** J4e's `h`: a held key, or the same key again within 200ms of its keyup (a Backspace that just emptied the search). */
export const heldKey = (event: { key: string; repeat: boolean }, last: KeyUp, now: number) =>
  event.repeat || (event.key === last.key && now - last.time < 200);

/** Whether the key moves the highlight the way that lets a resting highlight preview a submenu (canOpenSubmenuOnFocus). */
export const navigates = (e: Pick<KeyFacts, "key" | "altKey" | "ctrlKey" | "metaKey">) =>
  ["ArrowDown", "ArrowUp", "Tab", "PageDown", "PageUp", "Home", "End"].includes(e.key) ||
  (e.ctrlKey && !e.metaKey && !e.altKey && e.key in CTRL_STEPS);

/** Linear's J4e for one key. */
export function menuKey(e: KeyFacts): KeyAction {
  const plain = plainOf(e);
  const text = e.search?.value ?? "";
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key in CTRL_STEPS) return { type: "move", step: CTRL_STEPS[e.key]! };
  // With the search empty, a number key picks the row showing it (Linear's picker numbers: 0 for "No priority").
  if (/^\d$/.test(e.key) && plain && !text) return e.numbered ? { type: "number" } : { type: "none" };
  switch (e.key) {
    case "ArrowDown":
    case "ArrowUp":
      // Shift with text in the search selects it, as in any field.
      if (e.shiftKey && text) return { type: "caret" };
      if (e.metaKey || e.altKey) return { type: "end", last: e.key === "ArrowDown" };
      return { type: "move", step: e.key === "ArrowDown" ? 1 : -1 };
    case "Tab":
      return { type: "move", step: e.shiftKey ? -1 : 1 };
    case "Home":
    case "End":
      return e.mac ? { type: "end", last: e.key === "End" } : { type: "caret" };
    case "PageDown":
    case "PageUp":
      return { type: "move", step: e.key === "PageDown" ? e.page : -e.page, clamp: true };
    case "ArrowRight": {
      // Opens the highlighted submenu row with the caret at the end of the search; a held → doesn't.
      const atEnd = !e.search || e.search.start === text.length;
      return !e.held && atEnd && e.row?.submenu ? { type: "open" } : { type: "caret" };
    }
    case "ArrowLeft": {
      // With the caret at the start (or the search empty), a submenu closes itself and a menu closes its open submenu, with any
      // modifier held (J4e checks none).
      const atStart = !text || (e.search?.start === 0 && e.search?.end === 0);
      if (e.held || !atStart) return { type: "caret" };
      if (e.inSubmenu) return { type: "back" };
      return e.childOpen ? { type: "closeChild" } : { type: "caret" };
    }
    case "Backspace":
      // A submenu steps back on Backspace in its empty search, with any modifier, not on a held key that just emptied it nor
      // one pressed again within 200ms (J4e's onEmptySearchBackspace); the search changing closes any submenu of its own.
      return e.inSubmenu && e.search && !text && !e.held ? { type: "back" } : { type: "none" };
    case " ":
      // Mid-search Space types, unless it follows ↑/↓ on a checkbox row (J4e's `x`).
      if (text && !(e.afterArrow && plain && e.row?.checkbox)) return { type: "none" };
      return e.row ? { type: "toggle" } : { type: "swallow" };
    case "Enter":
      if (!e.row) return { type: "swallow" };
      if (!e.row.checkbox) return { type: "pick" };
      // On a multi-select row, Shift+Enter and ⌘/Ctrl+Enter toggle it and keep the menu open (J4e's preventClose).
      return e.shiftKey || e.metaKey || e.ctrlKey ? { type: "toggle" } : { type: "pickClose" };
    case "Escape":
      return e.hasSurface ? { type: "close" } : { type: "release" };
  }
  return { type: "none" };
}
