/** The modifier keys held right now, as Linear's `l4` (startup-entry.Dt5YDWdY.js) keeps them: every keydown, keyup and
 *  pointerdown on the window (capture phase) sets them from the event; blur, focus and paste clear them. An action that runs
 *  from a menu or the command palette gets no event, so it reads ⌥ here (Linear's Copy ID → "Copy ID as link"). */
import { useSyncExternalStore } from "react";

export type Modifiers = { altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };
type Tracked = Readonly<Modifiers & { modKey: boolean }> & {
  /** Calls `listener` whenever ⌥ goes down or up, for names that change while it is held. */
  subscribe: (listener: () => void) => () => void;
};

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export function trackModifiers(target: Pick<EventTarget, "addEventListener">) {
  const state: Modifiers & { modKey: boolean } = { altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, modKey: false };
  const listeners = new Set<() => void>();
  const notify = (wasAlt: boolean) => {
    if (wasAlt !== state.altKey) for (const listener of listeners) listener();
  };
  const update = (event: Event) => {
    const e = event as KeyboardEvent | PointerEvent;
    const wasAlt = state.altKey;
    state.altKey = e.altKey;
    state.metaKey = e.metaKey;
    state.ctrlKey = e.ctrlKey;
    state.shiftKey = e.shiftKey;
    state.modKey = isMac() ? e.metaKey : e.ctrlKey;
    notify(wasAlt);
  };
  const reset = () => {
    const wasAlt = state.altKey;
    state.altKey = state.metaKey = state.ctrlKey = state.shiftKey = state.modKey = false;
    notify(wasAlt);
  };
  for (const type of ["keydown", "keyup", "pointerdown"]) target.addEventListener(type, update, true);
  for (const type of ["blur", "focus", "paste"]) target.addEventListener(type, reset);
  return Object.assign(state, {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  }) as Tracked;
}

const none: Tracked = { altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, modKey: false, subscribe: () => () => {} };
/** One tracker for the app, on the window (none on the server or in a test without one). */
export const modifiers: Tracked =
  typeof window !== "undefined" && typeof window.addEventListener === "function" ? trackModifiers(window) : none;
/** Whether ⌥ is held, re-rendering when it goes down or up: Linear's action names read `fu.altKey` as the menu draws. */
export const useAltKey = () => useSyncExternalStore(modifiers.subscribe, () => modifiers.altKey, () => false);
