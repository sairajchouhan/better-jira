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
  /**
   * Every toast deadline stops counting while something holds the queue (the pointer on the toasts, a hidden tab) and
   * resumes with the time it had left: sonner's toast effect pauses while `expanded || interacting || isDocumentHidden`
   * and keeps `remainingTime` (dist.DuPC_NI1.js, Linear's Toaster).
   */
  const holds = new Set<string>(),
    running = new Set<{ pause(): void; resume(): void }>();
  function countdown(ms: number, fn: () => void) {
    let left = ms,
      started = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const entry = {
      pause() {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        left -= Date.now() - started;
      },
      resume() {
        if (timer !== undefined) return;
        started = Date.now();
        timer = setTimeout(() => {
          running.delete(entry);
          fn();
        }, Math.max(0, left));
        timer.unref?.();
      },
    };
    running.add(entry);
    if (!holds.size) entry.resume();
    return () => {
      entry.pause();
      running.delete(entry);
    };
  }
  const timers = new Map<string, () => void>();
  const clearTimer = (id: string) => {
    timers.get(id)?.();
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
      if (expiresIn !== undefined && expiresIn !== Infinity) timers.set(id, countdown(expiresIn, () => dismiss(id)));
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
    /** Runs `fn` after `ms` of unheld time (a visible toast's duration); returns the cancel. */
    countdown,
    /** Holds (`on`) or releases one reason to pause every deadline: "hover", "hidden". */
    hold(reason: string, on: boolean) {
      const was = holds.size > 0;
      if (on) holds.add(reason);
      else holds.delete(reason);
      if (was !== holds.size > 0) for (const entry of running) if (holds.size) entry.pause(); else entry.resume();
    },
    dismissAll() {
      for (const id of timers.keys()) clearTimer(id);
      if (toasts.length) set([]);
    },
    /** Every queued toast, shown or waiting, oldest first. */
    all: () => toasts,
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
