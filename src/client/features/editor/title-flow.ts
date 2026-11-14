// A title and the description under it read as one form, as in Linear's title input (startup-root `uQ`). Enter and ↓ at
// the title's end move the caret into the description; ↑ at the description's start comes back. No ProseMirror here: the
// title side ships in the startup bundle, the editor side (editor-title-flow.ts) in the editor chunk. They meet through
// one DOM event on the editor's element.
import type { KeyboardEvent } from "react";

/** Where Enter puts the caret in the description. `new-line-at-end`: Linear's `startNewLineInNextInputOnEnter`, set by
 *  the issue view's title (`IssueDetailsPaneSidebar` `Oh`): at the title's end, a new empty line opens at the start of
 *  the description; anywhere else, the start of the description. `start`: every other title (the composers' `zQ` in
 *  `fZn`): always the start. */
export type TitleEnter = "new-line-at-end" | "start";
/** Linear's `onlyMoveToInputOnUpDownKeys`. `all`: → at the title's end and ← at the description's start move too.
 *  `up-down`: only ↓ and ↑, for when something sits between the two (the issue view's parent line, `Th` `l`). */
export type TitleArrows = "all" | "up-down";
export type TitleFlow = { enter: TitleEnter; arrows: TitleArrows };
/** Every title but the issue view's: the composers' (`fZn`'s `zQ`), which set neither flag. */
export const COMPOSER_TITLE: TitleFlow = { enter: "start", arrows: "all" };
/** Where the caret lands in the description: Linear's `focusAtStart()` and `focusNewLineAtStart()`. */
export type FocusAt = "start" | "new-line";

type Key = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "metaKey" | "ctrlKey"> & { isComposing?: boolean };
type Caret = { start: number; end: number; length: number };
export type TitleAction =
  | { type: "next"; at: FocusAt }
  /** ⌥↵ with text selected: the caret goes to the selection's end (`JL` = `qL` then `KL`). */
  | { type: "collapse" }
  /** ⌥↵ at a caret: leave the title (`KL`). */
  | { type: "blur" }
  /** ⇧↵: a title is one line, so the newline is dropped. */
  | { type: "ignore" };

/** What a key does in a title, or null to leave it alone (⌘↵ is the composer's create, typing is typing). */
export function titleKeyAction(key: Key, caret: Caret, flow: TitleFlow): TitleAction | null {
  if (key.isComposing) return null;
  const collapsed = caret.start === caret.end,
    atEnd = collapsed && caret.end === caret.length;
  if (key.key === "Enter") {
    if (key.metaKey || key.ctrlKey) return null;
    if (key.altKey) return collapsed ? { type: "blur" } : { type: "collapse" };
    if (key.shiftKey) return { type: "ignore" };
    // `aJn`: a new line only when the caret was at the end of the title; Enter mid-title never splits it.
    return { type: "next", at: flow.enter === "new-line-at-end" && atEnd ? "new-line" : "start" };
  }
  // `iJn`: ↓ (or →, unless up-down only) at the end, with nothing selected, moves to the start of the description.
  if ((key.key === "ArrowDown" || (key.key === "ArrowRight" && flow.arrows === "all")) && atEnd)
    return { type: "next", at: "start" };
  return null;
}

/** The event the description editor listens for; it calls preventDefault once it has placed the caret. */
export const FOCUS_AT_EVENT = "title-flow-focus";
/** Puts the caret in a description editor. An editor still loading (its stand-in) just takes focus, as Linear's
 *  placeholder editor maps every focus method to one plain focus. */
export function focusEditorAt(node: HTMLElement | null | undefined, at: FocusAt): boolean {
  if (!node) return false;
  const event = new CustomEvent<FocusAt>(FOCUS_AT_EVENT, { detail: at, cancelable: true });
  if (node.dispatchEvent(event)) node.focus();
  return true;
}

/** The title's key handler. `next` places the caret in the description that follows (Linear's `nextInputRef`). */
export const titleKeyDown =
  (flow: TitleFlow, next: (at: FocusAt) => void) =>
  (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    const action = titleKeyAction(
      { ...event, isComposing: event.nativeEvent.isComposing },
      { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, length: input.value.length },
      flow,
    );
    if (!action) return;
    event.preventDefault();
    if (action.type === "next") next(action.at);
    else if (action.type === "collapse") input.setSelectionRange(input.selectionEnd, input.selectionEnd);
    else if (action.type === "blur") input.blur();
  };

/** The description's way back (Linear's `previousInputRef`): the title it follows and that title's arrow rule. */
export type PreviousInput = { element: () => HTMLElement | null; arrows: TitleArrows };
/** Focuses a title with the caret at its end (Linear's `focusAtEnd`). */
export function focusTitleAtEnd(node: HTMLElement | null): boolean {
  if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
  node.focus();
  node.setSelectionRange(node.value.length, node.value.length);
  return true;
}
