import { useEffect } from "react";

/** How many action menus are open. Linear's action manager skips every global shortcut while its action menu is open
 *  (`bMn`: `if(t.isActionMenuOpen()…) return false`), wherever focus is, so a key whose hint a menu row shows (the PR menu's
 *  "Copy branch name ⇧⌘.") never runs the issue command behind the menu. A module count, not store state: it is read only at a key
 *  press and must not re-render anything. */
let open = 0;

export const actionMenuOpen = () => open > 0;

/** Counts the calling menu as open while it is mounted. */
export function useOpenActionMenu() {
  useEffect(() => {
    open++;
    return () => {
      open--;
    };
  }, []);
}
