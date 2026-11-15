import { movedPointer } from "./pointer-intent";

// The last input was the pointer (a press or a move) rather than a key. Read as a menu mounts, it tells a click or a hover open
// from a key or a keyboard preview without the opener passing it down (Linear's selectionSource / keyboardInvoked).
let pointer = false;
if (typeof window !== "undefined") {
  const by = (next: boolean) => () => {
    pointer = next;
  };
  addEventListener("pointerdown", by(true), true);
  // A move of no distance (a list scrolling under a still pointer, ⌘ pressed) is the browser's, not the user's (movedPointer).
  addEventListener("pointermove", (event: PointerEvent) => movedPointer(event) && by(true)(), true);
  addEventListener("keydown", by(false), true);
}
export const openedByPointer = () => pointer;
