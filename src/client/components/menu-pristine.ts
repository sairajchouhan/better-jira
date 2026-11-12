import { useState, type KeyboardEvent } from "react";

// The last input was the pointer (a press or a move) rather than a key. Read as a menu mounts, it tells a click or a hover open
// from a key or a keyboard preview without the opener passing it down (Linear's selectionSource / keyboardInvoked).
let pointer = false;
if (typeof window !== "undefined") {
  const by = (next: boolean) => () => {
    pointer = next;
  };
  addEventListener("pointerdown", by(true), true);
  addEventListener("pointermove", by(true), true);
  addEventListener("keydown", by(false), true);
}
export const openedByPointer = () => pointer;

// Keys that move the highlight (Menu moves it from "none" to an end) or open/toggle a row, so each first reveals the highlight.
const WAKES = new Set(["ArrowDown", "ArrowUp", "Tab", "PageDown", "PageUp", "Home", "End", " "]);

/**
 * Linear opens a menu from a pointer with no row highlighted: Enter does nothing, the first ↓, Tab, PageDown or Space highlights the
 * first row and ↑ the last, and moving the pointer or typing wakes it. cmdk always selects its first row, so until then
 * `[data-pristine]` hides that selection (index.css) and Menu treats it as none. Spread `props` on the Menu; call `wake` when the
 * search changes. `initial` defaults to how the menu opened: pristine from the pointer, highlighted from a key.
 */
export function usePristine(initial: boolean | (() => boolean) = openedByPointer) {
  const [pristine, setPristine] = useState(initial);
  const wake = () => setPristine(false);
  return {
    pristine,
    wake,
    props: {
      "data-pristine": pristine || undefined,
      onPointerMove: wake,
      onKeyDown: (event: KeyboardEvent) => {
        if (!pristine) return;
        if (event.key === "Enter") event.preventDefault();
        if (WAKES.has(event.key)) wake();
      },
    },
  };
}
