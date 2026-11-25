import { setInteractionModality } from "react-aria-components";
import { isMac } from "./keycap";

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

/** What last moved a list's single active item (Linear's focused row): the pointer moving over a row, or a key stepping. */
export type ActiveSource = "pointer" | "keys";

/**
 * Linear's list keeps one active item: j/k (and the arrows) step it, and a row takes it only when the pointer moves over it
 * (`$4e`'s onMouseEnter/onMouseMove, skipped in keyboard mode). So after a step, a still pointer's row is no longer what an issue
 * shortcut acts on, until the pointer really moves (`movedPointer`) and hands the item back to the row under it. Live Linear,
 * 16 Nov 2026: pointer resting on RAJ-67, j j, S opens the status menu for RAJ-69; a pointer move over RAJ-67, S is RAJ-67's.
 */
export function activeSourceAfter(source: ActiveSource, event: { type: string } & Partial<PointerMove>): ActiveSource {
  if (event.type === "step") return "keys";
  if ((event.type === "pointermove" || event.type === "mousemove") && movedPointer(event as PointerMove)) return "pointer";
  return source;
}

/**
 * Whether React Aria takes the input as a key's (useFocusVisible's modality "keyboard"), mirrored here as it keeps no getter we can
 * import: a keydown it counts (its `isValidKey`: no ⌘, Ctrl or Alt off a Mac, not a bare modifier) turns it on; a press, or a pointer
 * that moved, turns it off.
 */
export function ariaKeyboardAfter(
  on: boolean,
  event: { type: string; key?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } & Partial<PointerMove>,
  mac: boolean,
): boolean {
  if (event.type === "keydown")
    return (
      on ||
      !(event.metaKey || (!mac && event.altKey) || event.ctrlKey || ["Control", "Shift", "Meta"].includes(event.key ?? ""))
    );
  if (/^(pointer|mouse)(down|up)$/.test(event.type)) return false;
  return keyboardModeAfter(on, event);
}

/**
 * React Aria turns its modality to "pointer" on any move, still or not (useFocusVisible), and a row then coming under the still
 * pointer takes the highlight on hover start (useMenuItem's `onHoverStart` focuses a row unless `isFocusVisible()`). Linear's
 * keyboard mode outlasts a still move, so a still move while React Aria had the input as a key's puts its modality back
 * ("keep"); anything else leaves it ("leave").
 */
export const modalityAfterMove = (ariaKeyboard: boolean, event: PointerMove): "keep" | "leave" =>
  ariaKeyboard && !movedPointer(event) ? "keep" : "leave";

let keyboard = false,
  ariaKeyboard = false,
  active: ActiveSource = "pointer";
if (typeof window !== "undefined") {
  // Capture, as Linear listens, so a row's own handler already sees the mode this event leaves.
  const track = (event: Event) => {
    keyboard = keyboardModeAfter(keyboard, event as Event & PointerMove);
    active = activeSourceAfter(active, event as Event & PointerMove);
  };
  addEventListener("keydown", track, true);
  addEventListener("mousemove", track, true);
  addEventListener("pointermove", track, true);
  // Keys and presses in capture, as React Aria reads them (a row's handler may stop them); moves bubbling on the document, so the
  // modality is put back after React Aria's capture listener there has set "pointer".
  const mirror = (event: Event) => {
    ariaKeyboard = ariaKeyboardAfter(ariaKeyboard, event as Event & PointerMove, isMac());
  };
  for (const type of ["keydown", "pointerdown", "pointerup", "mousedown", "mouseup"]) document.addEventListener(type, mirror, true);
  const keep = (event: Event) => {
    const was = ariaKeyboard;
    mirror(event);
    if (modalityAfterMove(was, event as Event & PointerMove) === "keep") setInteractionModality("keyboard");
  };
  document.addEventListener("pointermove", keep);
  document.addEventListener("mousemove", keep);
}
/** Whether the last input was a key, not a pointer that moved since (Linear's `isKeyboardModeRef`). */
export const keyboardMode = () => keyboard;
/** A key stepped the list's active item (j/k, the arrows): the row under a still pointer stops being it (`activeSourceAfter`). */
export const keyStepped = () => void (active = activeSourceAfter(active, { type: "step" }));
/** Whether the row under the pointer is the list's active item: the pointer moved over it since the last key step. */
export const pointerLeads = () => active === "pointer";
