import type { ReactNode } from "react";

/** One queued toast. `duration` is in ms; `Infinity` keeps it until dismissed. */
export type QueuedToast = { id: string; content: ReactNode; duration: number; revision: number };

/**
 * The single toast queue behind ToastViewport. Linear's Toaster (ToastPresenter.DGg7fNYy.js) shows the newest 4
 * (`visibleToasts`); older ones wait, unshown, until a newer one leaves. Showing with an id already queued replaces it
 * in place with a fresh presentation revision; content-only updates preserve that revision. Shaped for useSyncExternalStore.
 */
export function createToastQueue(limit = 4) {
  let toasts: readonly QueuedToast[] = [],
    visible: readonly QueuedToast[] = [],
    counter = 0,
    revision = 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const clearTimer = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  const listeners = new Set<() => void>(),
    set = (next: readonly QueuedToast[]) => {
      toasts = next;
      visible = next.slice(-limit);
      for (const listener of listeners) listener();
    };
  const dismiss = (id: string) => {
    clearTimer(id);
    if (toasts.some((t) => t.id === id)) set(toasts.filter((t) => t.id !== id));
  };
  return {
    /** Queues a toast and returns its id. `duration` is visible time (default 4s).
     * `expiresIn` is a queue-owned deadline from show, even without a viewport; use duration: Infinity with it.
     * Replacing an id restarts its deadline; update only changes content. */
    show(content: ReactNode, { id = `toast-${++counter}`, duration = 4000, expiresIn }: { id?: string; duration?: number; expiresIn?: number } = {}) {
      clearTimer(id);
      if (expiresIn !== undefined && expiresIn !== Infinity) {
        const timer = setTimeout(() => dismiss(id), expiresIn);
        timer.unref?.();
        timers.set(id, timer);
      }
      const toast = { id, content, duration, revision: ++revision };
      set(toasts.some((t) => t.id === id) ? toasts.map((t) => (t.id === id ? toast : t)) : [...toasts, toast]);
      return id;
    },
    has: (id: string) => toasts.some((toast) => toast.id === id),
    /** Read or update content in place, preserving its lifetime and queue position. */
    find: (id: string) => toasts.find((toast) => toast.id === id),
    update(id: string, content: ReactNode) {
      if (toasts.some((toast) => toast.id === id))
        set(toasts.map((toast) => toast.id === id ? { ...toast, content } : toast));
    },
    dismiss,
    dismissAll() {
      for (const id of timers.keys()) clearTimer(id);
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
