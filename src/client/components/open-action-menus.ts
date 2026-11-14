import { useEffect, useEffectEvent } from "react";

/** The open action menus' close callbacks, the latest on top. Linear's action manager skips every global shortcut while its action
 *  menu is open (`bMn`: `if(t.isActionMenuOpen()…) return false`), wherever focus is, so a key whose hint a menu row shows (the PR
 *  menu's "Copy branch name ⇧⌘.") never runs the issue command behind the menu. A module list, not store state: it is read only at
 *  a key press and must not re-render anything. */
const open: (() => void)[] = [];

export const actionMenuOpen = () => open.length > 0;

/** Counts `close` as an open action menu until the returned function runs. */
export function registerActionMenu(close: () => void) {
  open.push(close);
  return () => {
    const at = open.lastIndexOf(close);
    if (at >= 0) open.splice(at, 1);
  };
}

/** Linear's global Escape (`yMn`: `y_(gl.isEscape, …)` with runWithInputElementFocus): with an action menu open it closes it,
 *  wherever focus is. A menu that has focus closes on its own Escape first and marks the event handled, so this only reaches a
 *  menu whose focus went to the page (a click on its padding). Returns whether it closed one. */
export function closeActionMenuOnEscape(event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault" | "stopPropagation">) {
  const close = open.at(-1);
  if (!close || event.key !== "Escape" || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  event.preventDefault();
  event.stopPropagation();
  close();
  return true;
}

const onKeyDown = (event: KeyboardEvent) => void closeActionMenuOnEscape(event);

/** Counts the calling menu as open while it is mounted; Escape closes it through `close` even with focus outside it. */
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
