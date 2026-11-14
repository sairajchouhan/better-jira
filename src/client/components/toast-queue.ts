import type { ReactNode } from "react";
import { UNSTABLE_ToastQueue } from "react-aria-components";

/** One queued toast. `duration` is in ms; `Infinity` keeps it until dismissed. */
export type QueuedToast = { id: string; content: ReactNode; duration: number; revision: number };

type Countdown = { pause(): void; resume(): void };

/**
 * The single toast queue behind ToastViewport: React Aria's ToastQueue, which its ToastRegion reads, with Linear's rules on
 * top. Linear's Toaster (ToastPresenter.DGg7fNYy.js) shows the newest 4 (`visibleToasts`); older ones wait, unshown, until a
 * newer one leaves. Showing with an id already queued replaces it in place with a fresh presentation revision (sonner's
 * toast with an existing id, dist.DuPC_NI1.js); content-only updates preserve that revision. React Aria's own queue has
 * neither, so this keeps its own list and hands the region `visibleToasts`, newest first as sonner draws them.
 *
 * Every deadline stops counting while something holds the queue and resumes with the time it had left: sonner's toast
 * effect pauses while `expanded || interacting || isDocumentHidden` and keeps `remainingTime`. React Aria's region holds
 * it (`pauseAll`) while the pointer is on the toasts or focus is in them; ToastViewport holds it while the tab is hidden.
 */
export class AppToastQueue extends UNSTABLE_ToastQueue<QueuedToast> {
  #limit: number;
  #toasts: readonly QueuedToast[] = [];
  #visible: readonly QueuedToast[] = [];
  #counter = 0;
  #revision = 0;
  #holds = new Set<string>();
  #running = new Set<Countdown>();
  #timers = new Map<string, () => void>();
  #listeners = new Set<() => void>();

  constructor(limit = 4) {
    super({ maxVisibleToasts: limit });
    this.#limit = limit;
    // Callers hand these to useSyncExternalStore unbound.
    this.subscribe = this.subscribe.bind(this);
    this.visible = this.visible.bind(this);
    this.all = this.all.bind(this);
  }

  #set(next: readonly QueuedToast[]) {
    this.#toasts = next;
    this.#visible = next.slice(-this.#limit);
    this.visibleToasts = this.#visible.toReversed().map((toast) => ({ key: toast.id, content: toast }));
    for (const listener of this.#listeners) listener();
  }

  #clearTimer(id: string) {
    this.#timers.get(id)?.();
    this.#timers.delete(id);
  }

  /** Runs `fn` after `ms` of unheld time (a visible toast's duration); returns the cancel. */
  countdown(ms: number, fn: () => void) {
    let left = ms,
      started = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const running = this.#running;
    const entry: Countdown = {
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
    if (!this.#holds.size) entry.resume();
    return () => {
      entry.pause();
      running.delete(entry);
    };
  }

  /** Queues a toast and returns its id. `duration` is visible time (default 4s).
   * `expiresIn` is a queue-owned deadline from show, even without a viewport; use duration: Infinity with it.
   * Replacing an id restarts its deadline; update only changes content. */
  show(content: ReactNode, { id = `toast-${++this.#counter}`, duration = 4000, expiresIn }: { id?: string; duration?: number; expiresIn?: number } = {}) {
    this.#clearTimer(id);
    if (expiresIn !== undefined && expiresIn !== Infinity)
      this.#timers.set(id, this.countdown(expiresIn, () => this.dismiss(id)));
    const toast = { id, content, duration, revision: ++this.#revision };
    this.#set(this.has(id) ? this.#toasts.map((t) => (t.id === id ? toast : t)) : [...this.#toasts, toast]);
    return id;
  }

  /** React Aria's add: the same as show with the toast's id and duration. */
  override add(toast: QueuedToast) {
    return this.show(toast.content, { id: toast.id, duration: toast.duration });
  }

  has(id: string) {
    return this.#toasts.some((toast) => toast.id === id);
  }

  /** Read or update content in place, preserving its lifetime and queue position. */
  find(id: string) {
    return this.#toasts.find((toast) => toast.id === id);
  }

  update(id: string, content: ReactNode) {
    if (this.has(id)) this.#set(this.#toasts.map((toast) => (toast.id === id ? { ...toast, content } : toast)));
  }

  dismiss(id: string) {
    this.#clearTimer(id);
    if (this.has(id)) this.#set(this.#toasts.filter((t) => t.id !== id));
  }

  /** React Aria's close (the toast's close button): dismisses by key, which is the toast's id. */
  override close(key: string) {
    this.dismiss(key);
  }

  /** Holds (`on`) or releases one reason to pause every deadline: "region", "hidden". */
  hold(reason: string, on: boolean) {
    const was = this.#holds.size > 0;
    if (on) this.#holds.add(reason);
    else this.#holds.delete(reason);
    const held = this.#holds.size > 0;
    if (was !== held) for (const entry of this.#running) if (held) entry.pause(); else entry.resume();
  }

  /** React Aria's region: the pointer is on the toasts or focus is in them. */
  override pauseAll() {
    this.hold("region", true);
  }

  override resumeAll() {
    this.hold("region", false);
  }

  dismissAll() {
    for (const id of this.#timers.keys()) this.#clearTimer(id);
    if (this.#toasts.length) this.#set([]);
  }

  override clear() {
    this.dismissAll();
  }

  /** Every queued toast, shown or waiting, oldest first. */
  all() {
    return this.#toasts;
  }

  /** The toasts on screen, oldest first (the newest sits nearest the corner). */
  visible() {
    return this.#visible;
  }

  override subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}

export const createToastQueue = (limit = 4) => new AppToastQueue(limit);

export type ToastQueue = AppToastQueue;

/** The app's one queue. */
export const toasts = createToastQueue();
