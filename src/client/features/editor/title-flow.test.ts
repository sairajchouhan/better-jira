import { expect, test } from "bun:test";
import type { KeyboardEvent } from "react";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  COMPOSER_TITLE,
  EMPTY_TITLE_TOAST,
  FOCUS_AT_EVENT,
  focusEditorAt,
  titleKeyAction,
  titleKeyDown,
  titleOnLeave,
  type FocusAt,
  type TitleFlow,
} from "./title-flow";
import { dropOpenedLine, leavesForTitle, placeCaret, withoutOpenedLine } from "./editor-title-flow";
import { richSchema as s } from "./rich-document";

const ISSUE: TitleFlow = { enter: "new-line-at-end", arrows: "all", escape: "title" };
const key = (name: string, mods: Partial<Record<"shiftKey" | "altKey" | "metaKey" | "ctrlKey" | "isComposing", boolean>> = {}) => ({
  key: name,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
});
/** "Fix login" with the caret (or selection) at the given offsets. */
const caret = (start: number, end = start) => ({ start, end, length: 9 });

test("Enter at the end of the issue view's title opens a new line at the top of the description (aJn, Oh)", () => {
  expect(titleKeyAction(key("Enter"), caret(9), ISSUE)).toEqual({ type: "next", at: "new-line" });
});

test("Enter mid-title goes to the start of the description and never splits the title (aJn)", () => {
  expect(titleKeyAction(key("Enter"), caret(3), ISSUE)).toEqual({ type: "next", at: "start" });
  // A selection that reaches the end is not a caret at the end.
  expect(titleKeyAction(key("Enter"), caret(3, 9), ISSUE)).toEqual({ type: "next", at: "start" });
});

test("Enter in a composer's title always goes to the start of the description (fZn's zQ has no new-line flag)", () => {
  expect(titleKeyAction(key("Enter"), caret(9), COMPOSER_TITLE)).toEqual({ type: "next", at: "start" });
});

test("⇧↵ adds no newline to a title; ⌘↵, ⌃↵ and an IME's Enter are left alone", () => {
  expect(titleKeyAction(key("Enter", { shiftKey: true }), caret(9), ISSUE)).toEqual({ type: "ignore" });
  expect(titleKeyAction(key("Enter", { metaKey: true }), caret(9), ISSUE)).toBeNull();
  expect(titleKeyAction(key("Enter", { ctrlKey: true }), caret(9), ISSUE)).toBeNull();
  expect(titleKeyAction(key("Enter", { isComposing: true }), caret(9), ISSUE)).toBeNull();
});

test("⌥↵ collapses a selection to its end, else leaves the title (JL = qL, KL)", () => {
  expect(titleKeyAction(key("Enter", { altKey: true }), caret(2, 5), ISSUE)).toEqual({ type: "collapse" });
  expect(titleKeyAction(key("Enter", { altKey: true }), caret(5), ISSUE)).toEqual({ type: "blur" });
});

test("↓ at the title's end goes to the start of the description; → too unless up-down only (iJn)", () => {
  expect(titleKeyAction(key("ArrowDown"), caret(9), ISSUE)).toEqual({ type: "next", at: "start" });
  expect(titleKeyAction(key("ArrowDown"), caret(4), ISSUE)).toBeNull();
  expect(titleKeyAction(key("ArrowDown"), caret(4, 9), ISSUE)).toBeNull();
  expect(titleKeyAction(key("ArrowRight"), caret(9), ISSUE)).toEqual({ type: "next", at: "start" });
  expect(titleKeyAction(key("ArrowRight"), caret(9), { ...ISSUE, arrows: "up-down" })).toBeNull();
  expect(titleKeyAction(key("ArrowDown"), caret(9), { ...ISSUE, arrows: "up-down" })).toEqual({ type: "next", at: "start" });
});

test("Escape in the issue view's title leaves it, keeping the edit; a selection collapses to its end first (shared-editor zt(qL, KL))", () => {
  expect(titleKeyAction(key("Escape"), caret(5), ISSUE)).toEqual({ type: "blur" });
  expect(titleKeyAction(key("Escape"), caret(2, 5), ISSUE)).toEqual({ type: "collapse" });
});

test("Escape with a modifier is not the keymap's Escape, and a composer's title leaves Escape to its composer (f$)", () => {
  for (const mod of ["shiftKey", "altKey", "metaKey", "ctrlKey"] as const)
    expect(titleKeyAction(key("Escape", { [mod]: true }), caret(5), ISSUE)).toBeNull();
  expect(titleKeyAction(key("Escape", { isComposing: true }), caret(5), ISSUE)).toBeNull();
  expect(titleKeyAction(key("Escape"), caret(5), COMPOSER_TITLE)).toBeNull();
  expect(titleKeyAction(key("Escape"), caret(2, 5), COMPOSER_TITLE)).toBeNull();
});

test("leaving a cleared title reverts it with Linear's error toast (Oh d); blank counts as cleared, as Jira rejects it", () => {
  expect(titleOnLeave("", "Fix login")).toEqual({ type: "empty" });
  expect(titleOnLeave("   ", "Fix login")).toEqual({ type: "empty" });
  expect(EMPTY_TITLE_TOAST).toEqual({
    text: "Title cannot be empty",
    detail: "Reverted the title to its previous value",
  });
});

test("leaving a title saves only a typed change, so a title Jira has since replaced is never written back", () => {
  expect(titleOnLeave("Fix login page", "Fix login")).toEqual({ type: "save", title: "Fix login page" });
  expect(titleOnLeave("Fix login", "Fix login")).toEqual({ type: "keep" });
});

/** A title input's key event, enough for titleKeyDown. */
function keyEvent(name: string, start: number, end = start, mods = {}) {
  const input = {
    value: "Fix login",
    selectionStart: start,
    selectionEnd: end,
    blurred: false,
    setSelectionRange(a: number, b: number) {
      input.selectionStart = a;
      input.selectionEnd = b;
    },
    blur() {
      input.blurred = true;
    },
  };
  const event = {
    ...key(name, mods),
    currentTarget: input,
    nativeEvent: { isComposing: false },
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return { event, input, react: event as unknown as KeyboardEvent<HTMLInputElement> };
}

test("the title's handler hands the caret on and swallows the key", () => {
  const moves: FocusAt[] = [];
  const handler = titleKeyDown(ISSUE, (at) => moves.push(at));
  const enter = keyEvent("Enter", 9);
  handler(enter.react);
  expect(enter.event.prevented).toBe(true);
  expect(moves).toEqual(["new-line"]);

  const alt = keyEvent("Enter", 2, 5, { altKey: true });
  handler(alt.react);
  expect([alt.input.selectionStart, alt.input.selectionEnd]).toEqual([5, 5]);
  const altCaret = keyEvent("Enter", 5, 5, { altKey: true });
  handler(altCaret.react);
  expect(altCaret.input.blurred).toBe(true);

  // Escape is swallowed too, so the global Escape neither closes the side panel nor leaves the page (vwe.handleEvent).
  const escape = keyEvent("Escape", 5);
  handler(escape.react);
  expect(escape.event.prevented).toBe(true);
  expect(escape.input.blurred).toBe(true);
  const escapeSelection = keyEvent("Escape", 2, 5);
  handler(escapeSelection.react);
  expect([escapeSelection.input.selectionStart, escapeSelection.input.selectionEnd]).toEqual([5, 5]);
  expect(escapeSelection.input.blurred).toBe(false);

  const typing = keyEvent("a", 9);
  handler(typing.react);
  expect(typing.event.prevented).toBe(false);
  expect(moves).toEqual(["new-line"]);
});

test("focusEditorAt asks the editor to place the caret, and plainly focuses one that isn't listening (its stand-in)", () => {
  const editor = Object.assign(new EventTarget(), { focused: 0, focus: () => editor.focused++ });
  const seen: FocusAt[] = [];
  editor.addEventListener(FOCUS_AT_EVENT, (event) => {
    seen.push((event as CustomEvent<FocusAt>).detail);
    event.preventDefault();
  });
  expect(focusEditorAt(editor as unknown as HTMLElement, "new-line")).toBe(true);
  expect(seen).toEqual(["new-line"]);
  expect(editor.focused).toBe(0);

  const standIn = Object.assign(new EventTarget(), { focused: 0, focus: () => standIn.focused++ });
  expect(focusEditorAt(standIn as unknown as HTMLElement, "start")).toBe(true);
  expect(standIn.focused).toBe(1);
  expect(focusEditorAt(null, "start")).toBe(false);
});

const n = s.nodes;
const p = (text = "") => n.paragraph!.create(null, text ? s.text(text) : null);
const doc = (...blocks: ReturnType<typeof p>[]) => n.doc!.create(null, blocks);
const at = (d: ReturnType<typeof doc>, pos: number) => EditorState.create({ doc: d, selection: TextSelection.create(d, pos) });

test("placeCaret: start puts the caret before the first character; new-line opens an empty line above (focusNewLineAtStart)", () => {
  // The caret was last at the end of "World"; the description is otherwise untouched.
  const before = at(doc(p("Hello"), p("World")), 13);
  const start = before.apply(placeCaret(before, "start"));
  expect(start.doc.eq(before.doc)).toBe(true);
  expect(start.selection.from).toBe(1);

  const line = before.apply(placeCaret(before, "new-line"));
  expect(line.doc.childCount).toBe(3);
  expect(line.doc.firstChild!.content.size).toBe(0);
  expect(line.doc.child(1).textContent).toBe("Hello");
  expect(line.selection.empty && line.selection.$from.index(0)).toBe(0);
  expect(line.selection.$from.parent).toBe(line.doc.firstChild!);
});

test("placeCaret: end puts the caret after a kept draft's last character (focusAtEnd), leaving the scroll to the caller", () => {
  const before = at(doc(p("Hello"), p("World")), 1);
  const tr = placeCaret(before, "end");
  const after = before.apply(tr);
  expect(after.doc.eq(before.doc)).toBe(true);
  expect(after.selection.from).toBe(13);
  expect(tr.scrolledIntoView).toBe(false);
});

test("placeCaret: an empty description has its line already, so new-line adds none", () => {
  const empty = at(doc(p()), 1);
  const after = empty.apply(placeCaret(empty, "new-line"));
  expect(after.doc.childCount).toBe(1);
  expect(after.selection.from).toBe(1);
});

test("placeCaret: a description that already starts with an empty line gets no second one (Linear's yOe)", () => {
  const before = at(doc(p(), p("Hello")), 3);
  const after = before.apply(placeCaret(before, "new-line"));
  expect(after.doc.eq(before.doc)).toBe(true);
  expect(after.selection.from).toBe(1);
});

test("withoutOpenedLine: the line Enter opened is no edit until something is typed in it", () => {
  const before = at(doc(p("Hello")), 1);
  const opened = before.apply(placeCaret(before, "new-line"));
  // Enter at the title's end, then a pause: the description reports as it was, so autosave has nothing to send.
  expect(withoutOpenedLine(opened.doc, true).eq(before.doc)).toBe(true);
  // Typing below the opened line reports that typing alone, never a blank first paragraph.
  const below = opened.apply(opened.tr.insertText("!", opened.doc.content.size - 1));
  expect(withoutOpenedLine(below.doc, true).eq(doc(p("Hello!")))).toBe(true);
  // Typed into: the line is content now.
  const typed = opened.apply(opened.tr.insertText("Steps"));
  expect(withoutOpenedLine(typed.doc, true).eq(typed.doc)).toBe(true);
  // A blank first line the editor did not open is the description's own.
  const own = doc(p(), p("Hello"));
  expect(withoutOpenedLine(own, false).eq(own)).toBe(true);
});

test("dropOpenedLine removes the opened line left empty, and keeps one that was typed in", () => {
  const before = at(doc(p("Hello")), 1);
  const opened = before.apply(placeCaret(before, "new-line"));
  const left = opened.apply(dropOpenedLine(opened)!);
  expect(left.doc.eq(before.doc)).toBe(true);

  const typed = opened.apply(opened.tr.insertText("Steps"));
  expect(dropOpenedLine(typed)).toBeNull();
  expect(dropOpenedLine(at(doc(p()), 1))).toBeNull();
});

test("↑ at the very start of the description goes back to the title; ← too unless up-down only (iJn)", () => {
  const start = at(doc(p("Hello"), p("World")), 1);
  expect(leavesForTitle(start, "ArrowUp", "all")).toBe(true);
  expect(leavesForTitle(start, "ArrowLeft", "all")).toBe(true);
  expect(leavesForTitle(start, "ArrowLeft", "up-down")).toBe(false);
  expect(leavesForTitle(start, "ArrowDown", "all")).toBe(false);
  // Mid-text, or a later block: ↑ stays the editor's.
  expect(leavesForTitle(at(doc(p("Hello"), p("World")), 3), "ArrowUp", "all")).toBe(false);
  expect(leavesForTitle(at(doc(p("Hello"), p("World")), 8), "ArrowUp", "all")).toBe(false);
  // A selection, a code block or a list at the start keeps ↑ too.
  const d = doc(p("Hello"));
  expect(leavesForTitle(EditorState.create({ doc: d, selection: TextSelection.create(d, 1, 3) }), "ArrowUp", "all")).toBe(false);
  const codeDoc = n.doc!.create(null, [n.codeBlock!.create(null, s.text("x = 1"))]);
  expect(leavesForTitle(at(codeDoc, 1), "ArrowUp", "all")).toBe(false);
  const listDoc = n.doc!.create(null, [n.bulletList!.create(null, [n.listItem!.create(null, [p("item")])])]);
  expect(leavesForTitle(at(listDoc, 3), "ArrowUp", "all")).toBe(false);
});
