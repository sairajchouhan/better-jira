import { useSyncExternalStore } from "react";

/**
 * Whether a drag is under way anywhere in the app: Linear's `zN()` (the drag context's items, set while anything is dragged), under
 * which a sidebar favorite opens no card. Our drags are React Aria's drag and drop (a board card, a list row, a sub-issue), which
 * rides the browser's own drag (`dragstart` … `dragend`). The sidebar's Sortable (pointer driven, like dnd-kit) says so itself
 * (`useSortableDragging`). One listener set on the document for every reader.
 */
let native = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const setNative = (next: boolean) => {
  if (native === next) return;
  native = next;
  emit();
};
const start = () => setNative(true),
  // A dragged row a virtual list unmounts never gets its `dragend`, so a drop or the next press also ends the drag.
  end = () => setNative(false);
const DRAG_EVENTS = [
  ["dragstart", start],
  ["dragend", end],
  ["drop", end],
  ["pointerdown", end],
] as const;

/** Listen for drags starting and ending (the store's subscription; tests drive it directly). */
export function subscribeToDrags(listener: () => void) {
  if (!listeners.size) for (const [type, handler] of DRAG_EVENTS) document.addEventListener(type, handler, true);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      for (const [type, handler] of DRAG_EVENTS) document.removeEventListener(type, handler, true);
      native = false;
    }
  };
}

export const isDragging = () => native;

/** Whether a browser drag is under way (`zN() != null`). False on the server. */
export const useAnyDrag = () => useSyncExternalStore(subscribeToDrags, isDragging, () => false);
