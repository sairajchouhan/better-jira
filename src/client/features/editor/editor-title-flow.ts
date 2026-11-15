// The description's half of title-flow.ts: where the caret lands when the title hands over, and when ↑ hands back.
import type { Node } from "prosemirror-model";
import { Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { FocusAt, TitleArrows } from "./title-flow";

const isEmptyParagraph = (node: EditorState["doc"]["firstChild"]) =>
  !!node && node.type.name === "paragraph" && node.content.size === 0;

/** Linear's `focusAtStart()` and `focusNewLineAtStart()`. A new line is an empty paragraph opened above the first
 *  block, the caret in it. A description that already starts with an empty line (an empty one included) gets none:
 *  Linear's `yOe` returns early when the first block is an empty paragraph. */
export function placeCaret(state: EditorState, at: FocusAt): Transaction {
  const { doc } = state;
  if (at === "start" || isEmptyParagraph(doc.firstChild))
    return state.tr.setSelection(Selection.atStart(doc)).scrollIntoView();
  const tr = state.tr.insert(0, state.schema.nodes.paragraph!.create());
  return tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView();
}

/** The line Enter opened, removed on leaving if nothing was typed in it, so a description never saves a blank first line.
 *  Null when the first block is not that empty line any more. */
export function dropOpenedLine(state: EditorState): Transaction | null {
  const { doc } = state;
  if (doc.childCount < 2 || !isEmptyParagraph(doc.firstChild)) return null;
  return state.tr.delete(0, doc.firstChild!.nodeSize).setMeta("addToHistory", false);
}

/** The document an editor reports while the line Enter opened is still empty: without that line. Opening it is where
 *  the caret goes, not an edit, so it never starts an autosave; Linear drops it on blur (`AOe`). `opened` is whether
 *  the editor opened that line and has not been left since. */
export function withoutOpenedLine(doc: Node, opened: boolean): Node {
  if (!opened || doc.childCount < 2 || !isEmptyParagraph(doc.firstChild)) return doc;
  return doc.copy(doc.content.cut(doc.firstChild!.nodeSize));
}

/** Linear's `iJn` going back: ↑ (or ←, unless the title is up-down only) with the caret at the very start of the
 *  description, top level and not in a code block, moves to the end of the title. */
export function leavesForTitle(state: EditorState, key: string, arrows: TitleArrows): boolean {
  if (key !== "ArrowUp" && !(key === "ArrowLeft" && arrows === "all")) return false;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const $cursor = selection.$cursor;
  if (!$cursor || $cursor.depth > 1 || $cursor.parent.type.spec.code) return false;
  return selection.anchor === Selection.atStart(state.doc).anchor;
}
