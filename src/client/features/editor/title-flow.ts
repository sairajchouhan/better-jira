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
/** Who answers Escape in the title. `title`: the title itself, as Linear's shared editor keymap does
 *  (`t1e` `Ry("shared-editor", { Escape: zt(qL, KL…) })`): a selection collapses to its end, else the title is left and
 *  its blur saves the edit. Handling it marks the key used, so the global Escape (`vwe.handleEvent` stops at
 *  `defaultPrevented`) neither closes the side panel nor leaves the page. `surface`: the composer around the title keeps
 *  its own Escape (the create modal's draft prompt, the sub-issue composer's cancel; Linear's `f$` on the form). */
export type TitleEscape = "title" | "surface";
export type TitleFlow = { enter: TitleEnter; arrows: TitleArrows; escape: TitleEscape };
/** Every title but the issue view's: the composers' (`fZn`'s `zQ`), which set neither flag. */
export const COMPOSER_TITLE: TitleFlow = { enter: "start", arrows: "all", escape: "surface" };
/** Where the caret lands in an editor: Linear's `focusAtStart()` and `focusNewLineAtStart()` (the title handing over to the
 *  description), and `focusAtEnd()` (a command opening the comment composer, focus-comment). */
export type FocusAt = "start" | "new-line" | "end";

type Key = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "metaKey" | "ctrlKey"> & { isComposing?: boolean };
type Caret = { start: number; end: number; length: number };
export type TitleAction =
  | { type: "next"; at: FocusAt }
  /** ⌥↵ or Escape with text selected: the caret goes to the selection's end (`qL`). */
  | { type: "collapse" }
  /** ⌥↵ or Escape at a caret: leave the title (`KL`); its blur saves. */
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
  // A ProseMirror keymap's plain "Escape" matches no modifier.
  if (key.key === "Escape") {
    if (flow.escape !== "title" || key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return null;
    return collapsed ? { type: "blur" } : { type: "collapse" };
  }
  // `iJn`: ↓ (or →, unless up-down only) at the end, with nothing selected, moves to the start of the description.
  if ((key.key === "ArrowDown" || (key.key === "ArrowRight" && flow.arrows === "all")) && atEnd)
    return { type: "next", at: "start" };
  return null;
}

/** What leaving a title does with what was typed (Linear's issue title `Oh` `d`, on blur). `empty`: the title was cleared,
 *  so it goes back to the one before with an error toast ("Title cannot be empty"). `save`: a typed change. `keep`:
 *  nothing typed, so a title Jira has since replaced is never written back. Linear tests the raw value (`!o`); Jira
 *  rejects a blank summary too, so blank counts as empty here, as Linear's pull request title (`Bo`) trims. */
export type TitleLeave = { type: "empty" } | { type: "save"; title: string } | { type: "keep" };
export function titleOnLeave(typed: string, before: string): TitleLeave {
  if (!typed.trim()) return { type: "empty" };
  return typed === before ? { type: "keep" } : { type: "save", title: typed };
}
/** Linear's toast for a cleared title: `new Le(E.error, "Title cannot be empty", "Reverted the title to its previous value")`. */
export const EMPTY_TITLE_TOAST = { text: "Title cannot be empty", detail: "Reverted the title to its previous value" } as const;

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
