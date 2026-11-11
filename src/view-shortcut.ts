export function viewShortcutId(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code"
  >,
) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return null;
  return (
    (
      {
        KeyV: "view-create",
        KeyS: "view-save",
        KeyF: "view-favorite",
      } as Record<string, string>
    )[event.code] ?? null
  );
}
