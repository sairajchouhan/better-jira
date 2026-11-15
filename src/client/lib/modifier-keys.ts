/** The modifier keys held right now, as Linear's `l4` (startup-entry.Dt5YDWdY.js) keeps them: every keydown, keyup and
 *  pointerdown on the window (capture phase) sets them from the event; blur, focus and paste clear them. An action that runs
 *  from a menu or the command palette gets no event, so it reads ⌥ here (Linear's Copy ID → "Copy ID as link"). */
export type Modifiers = { altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export function trackModifiers(target: Pick<EventTarget, "addEventListener">) {
  const state: Modifiers & { modKey: boolean } = { altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, modKey: false };
  const update = (event: Event) => {
    const e = event as KeyboardEvent | PointerEvent;
    state.altKey = e.altKey;
    state.metaKey = e.metaKey;
    state.ctrlKey = e.ctrlKey;
    state.shiftKey = e.shiftKey;
    state.modKey = isMac() ? e.metaKey : e.ctrlKey;
  };
  const reset = () => {
    state.altKey = state.metaKey = state.ctrlKey = state.shiftKey = state.modKey = false;
  };
  for (const type of ["keydown", "keyup", "pointerdown"]) target.addEventListener(type, update, true);
  for (const type of ["blur", "focus", "paste"]) target.addEventListener(type, reset);
  return state as Readonly<typeof state>;
}

const none: Modifiers & { modKey: boolean } = { altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, modKey: false };
/** One tracker for the app, on the window (none on the server or in a test without one). */
export const modifiers: Readonly<Modifiers & { modKey: boolean }> =
  typeof window !== "undefined" && typeof window.addEventListener === "function" ? trackModifiers(window) : none;
