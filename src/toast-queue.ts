import type { ReactNode } from "react";

/** One queued toast. `duration` is in ms; `Infinity` keeps it until dismissed. */
export type QueuedToast = { id: string; content: ReactNode; duration: number };

/**
 * The single toast queue behind ToastViewport. Linear's Toaster (ToastPresenter.DGg7fNYy.js) shows the newest 4
 * (`visibleToasts`); older ones wait, unshown, until a newer one leaves. Showing with an id already queued replaces it
 * in place. Shaped for useSyncExternalStore.
 */
export function createToastQueue(limit = 4) {
  let toasts: readonly QueuedToast[] = [],
    visible: readonly QueuedToast[] = [],
    counter = 0;
  const listeners = new Set<() => void>(),
    set = (next: readonly QueuedToast[]) => {
      toasts = next;
      visible = next.slice(-limit);
      for (const listener of listeners) listener();
    };
  return {
    /** Queues a toast and returns its id. Default duration is sonner's 4s. */
    show(content: ReactNode, { id = `toast-${++counter}`, duration = 4000 }: { id?: string; duration?: number } = {}) {
      const toast = { id, content, duration };
      set(toasts.some((t) => t.id === id) ? toasts.map((t) => (t.id === id ? toast : t)) : [...toasts, toast]);
      return id;
    },
    dismiss(id: string) {
      if (toasts.some((t) => t.id === id)) set(toasts.filter((t) => t.id !== id));
    },
    dismissAll() {
      if (toasts.length) set([]);
    },
    /** The toasts on screen, oldest first (the newest sits nearest the corner). */
    visible: () => visible,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type ToastQueue = ReturnType<typeof createToastQueue>;

/** The app's one queue. */
export const toasts = createToastQueue();
