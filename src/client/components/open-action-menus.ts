import { useEffect, useEffectEvent } from "react";
import { isMac } from "./keycap";

/** The open action menus' close callbacks, the latest on top. Linear's action manager skips every global shortcut while its action
 *  menu is open (`bMn`: `if(t.isActionMenuOpen()…) return false`), wherever focus is, so a key whose hint a menu row shows (the PR
 *  menu's "Copy branch name ⇧⌘.") never runs the issue command behind the menu. A module list, not store state: it is read only at
 *  a key press and must not re-render anything. */
const open: (() => void)[] = [];

export const actionMenuOpen = () => open.length > 0;

const openers = new Set<() => void>();
/** Calls `listener` whenever an action menu opens: Linear's view peek closes on the action manager's `onOpen`. */
export function onActionMenuOpen(listener: () => void) {
  openers.add(listener);
  return () => void openers.delete(listener);
}

/** Counts `close` as an open action menu until the returned function runs. */
export function registerActionMenu(close: () => void) {
  open.push(close);
  for (const listener of openers) listener();
  return () => {
    const at = open.lastIndexOf(close);
    if (at >= 0) open.splice(at, 1);
  };
}

type MenuKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "defaultPrevented"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "preventDefault"
  | "stopPropagation"
>;

/** The global keys that close the open action menu, wherever focus is (Linear's `yMn`):
 *  - Escape (`y_(gl.isEscape, …)` with runWithInputElementFocus). A menu that has focus closes on its own Escape first and marks
 *    the event handled, so this only reaches a menu whose focus went to the page (a click on its padding).
 *  - ⌘K (Ctrl+K off a Mac), which toggles the command menu: with an action menu open it calls `closeActionMenu()` instead of
 *    opening, so ⌘K never stacks the palette on a menu, and a second ⌘K opens it (BJ-221).
 *  Only the top menu closes, and the key goes no further. Returns whether it closed one. */
export function closeActionMenuOnKey(event: MenuKeyEvent, mac: boolean) {
  const close = open.at(-1);
  if (!close || event.defaultPrevented) return false;
  const escape =
    event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  const commandK =
    event.key.toLowerCase() === "k" &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.altKey &&
    !event.shiftKey;
  if (!escape && !commandK) return false;
  event.preventDefault();
  event.stopPropagation();
  close();
  return true;
}

const onKeyDown = (event: KeyboardEvent) => void closeActionMenuOnKey(event, isMac());

/** Counts the calling menu as open while it is mounted; Escape and ⌘K close it through `close` even with focus outside it. */
export function useOpenActionMenu(close: () => void) {
  const closeLatest = useEffectEvent(() => close());
  useEffect(() => {
    const unregister = registerActionMenu(() => closeLatest());
    if (open.length === 1) document.addEventListener("keydown", onKeyDown);
    return () => {
      unregister();
      if (!open.length) document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
