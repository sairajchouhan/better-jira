/** Alt+letter view shortcuts, read by key code so a layout's Alt characters (Option+V is √ on a Mac) still match. */
const VIEW_KEYS: Record<string, string> = {
  KeyV: "view-create",
  KeyS: "view-save",
  KeyF: "view-favorite",
};
/** The shortcut ids `viewShortcutId` handles, which the hotkey manager must not register too. */
export const VIEW_SHORTCUT_IDS = Object.values(VIEW_KEYS);

export function viewShortcutId(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code"
  >,
) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return null;
  return VIEW_KEYS[event.code] ?? null;
}
