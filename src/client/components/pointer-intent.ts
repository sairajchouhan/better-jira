// Hover follows the pointer only when the user moves it, as Linear's lists and menus do (startup-root.BhUCnb9L.js). Arrowing
// through a list never snaps back to the row a still pointer rests on, whether the list scrolled under it or ⌘ went down.

/** What a pointer event says about its move: how far it went since the last one, and from what device. */
export type PointerMove = { movementX: number; movementY: number; pointerType?: string };

/**
 * Whether a pointer move is the user moving the pointer, so a highlight or peek may follow it. Linear's `$4e` skips a move of no
 * distance on a device that isn't pure touch (`!sm.isPureTouchDevice&&e.movementX===0&&e.movementY===0||i(e)`): the browser's own
 * move as content scrolls under a still pointer, or as ⌘ goes down with it resting, which Linear's option rows also skip by
 * name (`KLr`: `e.metaKey&&e.movementY===0&&e.movementX===0`). A touch always counts, as Linear's pure-touch exemption.
 */
export const movedPointer = (event: PointerMove) =>
  event.pointerType === "touch" || event.movementX !== 0 || event.movementY !== 0;

/**
 * Linear's keyboard mode (`Yw`): on with any keydown, off only with a pointer move that went somewhere (`movedPointer`). While on,
 * a row the pointer comes to rest over, without moving, doesn't take the highlight (Linear's `$4e` onMouseEnter guard).
 */
export function keyboardModeAfter(on: boolean, event: { type: string } & Partial<PointerMove>): boolean {
  if (event.type === "keydown") return true;
  if ((event.type === "pointermove" || event.type === "mousemove") && movedPointer(event as PointerMove)) return false;
  return on;
}

let keyboard = false;
if (typeof window !== "undefined") {
  // Capture, as Linear listens, so a row's own handler already sees the mode this event leaves.
  const track = (event: Event) => {
    keyboard = keyboardModeAfter(keyboard, event as Event & PointerMove);
  };
  addEventListener("keydown", track, true);
  addEventListener("mousemove", track, true);
  addEventListener("pointermove", track, true);
}
/** Whether the last input was a key, not a pointer that moved since (Linear's `isKeyboardModeRef`). */
export const keyboardMode = () => keyboard;
