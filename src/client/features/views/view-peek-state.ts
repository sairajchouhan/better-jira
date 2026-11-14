import { useSyncExternalStore } from "react";
import { get, subscribe, type State } from "@/client/state/store";
import { onActionMenuOpen } from "@/client/components/open-action-menus";
import { loadFull } from "@/client/state/server-data";

/**
 * Linear's view peek (useIsKeyPressedRef.BJlOaMrk.js `K`/`q`/`Y`, opened by "Peek into item", Space): a floating card at the
 * view's right that shows the list or board item that has focus, and follows it as focus moves.
 *
 * Space is a sticky key (`I(…, {sticky: true})`): a press opens the peek and the next press closes it, but a press held longer
 * than 250ms closes it again on release, so holding Space glances at an item. Escape closes it. It closes too when nothing has
 * focus, a command menu or action menu opens, or the view goes away. Board cards keep focus on mouse-leave while it is mounted
 * (IssueList: `Ea.isPeekMounted()||r&&d()`), so the peek stays on the card the pointer left.
 */

/** A press held longer than this closes the peek on release (`i.current<Date.now()-250`). */
export const PEEK_HOLD_MS = 250;
/** Where the peek sits when the view gives it no container (`q`: `rightOffset:24, topOffset:88, reservedHeight:88+toolbar`). */
export const PEEK_TOP = 88;
export const PEEK_RIGHT = 24;

export type Peek = { key: string; openedAt: number } | null;

/** Space down (not a repeat): opens the peek on `key`, or closes an open one. */
export function peekKeyDown(peek: Peek, key: string | undefined, now: number): Peek {
  if (peek) return null;
  return key ? { key, openedAt: now } : null;
}

/** Space up: a held press closes the peek it opened; a tap leaves it open. */
export function peekKeyUp(peek: Peek, now: number): Peek {
  return peek && now - peek.openedAt > PEEK_HOLD_MS ? null : peek;
}

/** The peek's fixed offsets and the height it may grow to: the window below its top, less any desktop toolbar. */
export function peekPlacement(toolbarHeight = 0) {
  return { top: PEEK_TOP + toolbarHeight, right: PEEK_RIGHT, maxHeight: `calc(100dvh - ${PEEK_TOP + toolbarHeight}px)` };
}

/** Whether the open peek must close for this state: its item is gone, or something covers or replaces the view. */
export function peekClosesFor(peek: NonNullable<Peek>, s: State, board: number): boolean {
  return (
    !s.issues.has(peek.key) ||
    !!s.overlay ||
    !!s.toolbar ||
    s.panel ||
    !!s.document ||
    s.inbox ||
    s.board !== board
  );
}

let peek: Peek = null;
let board = 0;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function update(next: Peek) {
  if (next === peek) return;
  const was = peek;
  peek = next;
  // Linear's peek hydrates the issue it shows (`wv(t.hydrate())`) for its description.
  if (next && next.key !== was?.key && !get().fullErrors.get(next.key)) void loadFull(next.key);
  if (!was && next) start();
  if (was && !next) stop?.();
  listeners.forEach((l) => l());
}

/** Adds a listener where the target can take one (unit tests run without a DOM), and returns its removal. */
function listen(target: EventTarget | undefined, type: string, fn: (e: KeyboardEvent) => void, capture = false) {
  if (typeof target?.addEventListener !== "function" || typeof target.removeEventListener !== "function") return () => {};
  target.addEventListener(type, fn as EventListener, capture);
  return () => target.removeEventListener(type, fn as EventListener, capture);
}

/** While the peek is open: Space's release, Escape, store changes and an opening action menu can close it. */
function start() {
  board = get().board;
  const keyUp = (e: KeyboardEvent) => {
    if (e.key === " ") update(peekKeyUp(peek, Date.now()));
  };
  // Capture on window, so Escape closes the peek before anything else (clearing the selection) sees it: Linear's
  // `C("Escape", e => { d && (e.preventDefault(), e.stopPropagation(), m(!1)) })`.
  const keyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    update(null);
  };
  const blur = () => update(null);
  const unsubscribe = subscribe(() => {
    if (peek && peekClosesFor(peek, get(), board)) update(null);
  });
  const unwatch = onActionMenuOpen(() => update(null));
  const unlisten = [
    listen(globalThis.document, "keyup", keyUp),
    listen(globalThis.window, "keydown", keyDown, true),
    // Linear drops a held key when the tab hides (`visibilitychange`).
    listen(globalThis.document, "visibilitychange", blur),
  ];
  stop = () => {
    for (const off of unlisten) off();
    unsubscribe();
    unwatch();
    stop = null;
  };
}

/** Space on `key` (the focused or hovered item): opens the peek on it, or closes the open one. */
export function togglePeek(key: string | undefined) {
  update(peekKeyDown(peek, key, Date.now()));
}
/** Focus moved to `key` (j/k, or the pointer entering a card): an open peek follows it. */
export function followPeek(key: string) {
  if (peek && peek.key !== key) update({ ...peek, key });
}
export function closePeek() {
  update(null);
}
/** Linear's `isPeekMounted`. */
export const isPeekOpen = () => peek !== null;
/** The peeked issue's key, read once (keys and tests); components use `usePeekKey`. */
export const peekKeyOf = () => peek?.key ?? null;

const subscribePeek = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
/** The peeked issue's key, or null while the peek is closed. */
export const usePeekKey = () => useSyncExternalStore(subscribePeek, peekKeyOf, peekKeyOf);
