import { chainCommands, exitCode, lift } from "prosemirror-commands";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { Node as EditorNode } from "prosemirror-model";
import { liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { findWrapping, liftTarget } from "prosemirror-transform";
import { addRowAfter, goToNextCell, isInTable } from "prosemirror-tables";
import { richSchema, safeLink } from "./rich-document";

const inCode = (state: Parameters<Command>[0]) => !!state.selection.$from.parent.type.spec.code;

/** Tab in the last table cell adds a row and moves into it, like Linear. */
const addRowAtEnd: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const $from = state.selection.$from;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.spec.tableRole !== "row") depth--;
  if (!depth) return false;
  const rowEnd = $from.after(depth);
  let tr: Parameters<NonNullable<Parameters<Command>[1]>>[0] | undefined;
  addRowAfter(state, (t) => (tr = t));
  if (!tr) return false;
  dispatch?.(tr.setSelection(TextSelection.near(tr.doc.resolve(rowEnd + 2))).scrollIntoView());
  return true;
};
const indentCode: Command = (state, dispatch) =>
  inCode(state) && (dispatch?.(state.tr.insertText("  ").scrollIntoView()), true);
/** Tab never leaves the editor: a stray Tab used to move focus to a button, so the next ⌘Z undid board edits. */
const keepFocus: Command = () => true;
/** Tab inside a table, list or code block; anywhere else it does nothing, so the browser moves focus on (the create composer, like Linear). */
export const tabInside: Command = chainCommands(
  goToNextCell(1),
  addRowAtEnd,
  sinkListItem(richSchema.nodes.listItem!),
  indentCode,
);
export const shiftTabInside: Command = chainCommands(
  goToNextCell(-1),
  liftListItem(richSchema.nodes.listItem!),
);
export const tab: Command = chainCommands(tabInside, keepFocus);
export const shiftTab: Command = chainCommands(shiftTabInside, keepFocus);

const atCodeEnd = (state: Parameters<Command>[0]) => {
  const { $head, empty } = state.selection;
  return empty && inCode(state) && $head.parentOffset === $head.parent.content.size;
};
/** ArrowDown at the end of a code block that nothing follows opens a paragraph below it. */
export const codeDown: Command = (state, dispatch, view) => {
  const { $head } = state.selection;
  if (
    !atCodeEnd(state) ||
    $head.index($head.depth - 1) !== $head.node($head.depth - 1).childCount - 1
  )
    return false;
  return exitCode(state, dispatch, view);
};
/** A third Enter on a code block's trailing blank lines leaves the block, dropping those lines. */
export const codeEnter: Command = (state, dispatch) => {
  if (!atCodeEnd(state) || !state.selection.$head.parent.textContent.endsWith("\n\n")) return false;
  if (dispatch) {
    const { $head } = state.selection,
      end = $head.pos,
      after = $head.after();
    const tr = state.tr.delete(end - 2, end),
      pos = tr.mapping.map(after);
    tr.insert(pos, richSchema.nodes.paragraph!.create());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
  }
  return true;
};

/** Without a selection the URL is inserted as linked text; replaceSelectionWith must not inherit (and drop) marks. */
export const insertLink =
  (href: string): Command =>
  (state, dispatch) => {
    const mark = richSchema.marks.link!.create({ href });
    const tr = state.tr;
    if (state.selection.empty) tr.replaceSelectionWith(richSchema.text(href, [mark]), false);
    else tr.addMark(state.selection.from, state.selection.to, mark);
    dispatch?.(tr);
    return true;
  };

/** A typed link target: a bare domain gets https://, like Linear; anything else must be an http, https or mailto link. */
export const linkTarget = (input: string) => {
  const text = input.trim();
  return safeLink(/^[a-z][\w+.-]*:/i.test(text) ? text : `https://${text}`);
};

/** Each link touching the selection, whole: Unlink removes the link, not only the selected part. The caret counts at a link's start. */
export function linkRanges(state: EditorState): [number, number][] {
  const type = richSchema.marks.link!,
    { from, to } = state.selection,
    ranges: [number, number][] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    let start = -1,
      current: EditorNode["marks"][number] | undefined;
    const close = (end: number) => {
      if (current && start < Math.max(to, from + 1) && end > from) ranges.push([start, end]);
      current = undefined;
    };
    node.forEach((child, offset) => {
      const at = pos + 1 + offset,
        mark = type.isInSet(child.marks);
      if (current && !mark?.eq(current)) close(at);
      if (mark && !current) [start, current] = [at, mark];
    });
    close(pos + node.nodeSize - 1);
    return false;
  });
  return ranges;
}
export const removeLink: Command = (state, dispatch) => {
  const ranges = linkRanges(state);
  if (!ranges.length) return false;
  const tr = state.tr;
  for (const [from, to] of ranges) tr.removeMark(from, to, richSchema.marks.link!);
  dispatch?.(tr);
  return true;
};

/** A 2×2 table after the selected block, caret in its first cell: the selected text stays, and no mark spreads to the table. */
export const insertTable: Command = (state, dispatch) => {
  const cell = () => richSchema.nodes.tableCell!.createAndFill()!;
  const row = () => richSchema.nodes.tableRow!.create(null, [cell(), cell()]);
  const table = richSchema.nodes.table!.create(null, [row(), row()]);
  const { $to } = state.selection;
  // The nearest block that may have a table after it (a list item or quote cannot hold one).
  let depth = $to.depth;
  while (
    depth > 0 &&
    !$to
      .node(depth - 1)
      .canReplaceWith($to.index(depth - 1) + 1, $to.index(depth - 1) + 1, table.type)
  )
    depth--;
  if (!depth && !$to.parent.canReplaceWith($to.index(), $to.index(), table.type)) return false;
  if (dispatch) {
    const at = depth ? $to.after(depth) : $to.pos,
      tr = state.tr.insert(at, table);
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView());
  }
  return true;
};

const markRule = (pattern: RegExp, mark: string) =>
  new InputRule(pattern, (state, match, start, end) => {
    const type = richSchema.marks[mark]!,
      text = match[1]!;
    return state.tr
      .replaceWith(start, end, richSchema.text(text, [type.create()]))
      .removeStoredMark(type);
  });
/** Markdown shortcuts while typing (Linear supports the same), and bare URLs become links when a space follows. */
export const markdownRules = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,4})\s$/, richSchema.nodes.heading!, (match) => ({
      level: match[1]!.length,
    })),
    wrappingInputRule(/^\s*[-+*]\s$/, richSchema.nodes.bulletList!),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      richSchema.nodes.orderedList!,
      (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + node.attrs.order === Number(match[1]),
    ),
    wrappingInputRule(/^\s*>\s$/, richSchema.nodes.blockquote!),
    textblockTypeInputRule(/^```$/, richSchema.nodes.codeBlock!),
    markRule(/\*\*([^*\s][^*]*)\*\*$/, "strong"),
    markRule(/(?<![*\w])\*([^*\s][^*]*)\*$/, "em"),
    markRule(/`([^`\s][^`]*)`$/, "code"),
    markRule(/~~([^~\s][^~]*)~~$/, "strike"),
    markRule(/(?<![~\w])~([^~\s][^~]*)~$/, "strike"),
    markRule(/(?<![_\w])_([^_\s][^_]*)_$/, "em"),
    new InputRule(/(?:^|\s)(https?:\/\/[^\s]+[^\s.,;:!?)])\s$/, (state, match, start, end) => {
      const url = match[1]!,
        from = end - url.length,
        link = richSchema.marks.link!;
      if (state.doc.rangeHasMark(from, end, link)) return null;
      return state.tr
        .addMark(from, end, link.create({ href: url }))
        .insertText(match[0].slice(-1), end)
        .removeStoredMark(link);
    }),
  ],
});

const listItem = richSchema.nodes.listItem!,
  paragraph = richSchema.nodes.paragraph!,
  blockquote = richSchema.nodes.blockquote!;
/** Headings among the selected children of `parent` become paragraphs (a list item or a quote cannot hold one). */
function headingsToParagraphs(
  tr: Transaction,
  parent: EditorNode,
  start: number,
  from: number,
  to: number,
) {
  parent.forEach((child, offset) => {
    const pos = start + offset;
    if (child.type.name === "heading" && pos < to && pos + child.nodeSize > from)
      tr.setNodeMarkup(pos, paragraph, child.attrs, child.marks);
  });
}

/** Text, heading or code block. A selected block whose quote or list cannot hold the new type is lifted out first,
 * as often as nesting needs; disallowed marks are dropped (code holds plain text). One transaction, one undo step. */
export const setBlock =
  (name: string, attrs: Record<string, unknown> = {}): Command =>
  (state, dispatch) => {
    const type = richSchema.nodes[name]!,
      tr = state.tr;
    let current = state;
    const range = () =>
      [tr.mapping.map(state.selection.from), tr.mapping.map(state.selection.to, -1)] as const;
    for (let guard = 0, lifted = true; lifted && guard < 500; guard++) {
      lifted = false;
      const [from, to] = range();
      current.doc.nodesBetween(from, to, (node, pos, parent, index) => {
        if (lifted || !node.isTextblock) return !lifted;
        if (parent && !parent.canReplaceWith(index, index + 1, type)) {
          const at = current.apply(
            current.tr.setSelection(TextSelection.create(current.doc, pos + 1)),
          );
          (parent.type === listItem ? liftListItem(listItem) : lift)(at, (t) => {
            for (const step of t.steps) tr.step(step);
            current = at.apply(t);
            lifted = true;
          });
        }
        return false;
      });
    }
    const [from, to] = range();
    let changed = false;
    current.doc.nodesBetween(from, to, (node, pos, parent, index) => {
      if (!node.isTextblock) return true;
      if (
        type.contentMatch.matchFragment(node.content)?.validEnd &&
        parent?.canReplaceWith(index, index + 1, type)
      ) {
        node.forEach((child, offset) => {
          for (const mark of child.marks)
            if (!type.allowsMarkType(mark.type))
              tr.removeMark(pos + 1 + offset, pos + 1 + offset + child.nodeSize, mark);
        });
        tr.setNodeMarkup(pos, type, { ...node.attrs, ...attrs }, node.marks);
        changed = true;
      }
      return false;
    });
    if (changed || tr.docChanged) dispatch?.(tr);
    return changed || tr.docChanged;
  };

/** Toggles a list. The other kind of list switches type instead of nesting; headings become the items' paragraphs. */
export const toggleList =
  (name: "bulletList" | "orderedList"): Command =>
  (state, dispatch, view) => {
    const { $from, from, to } = state.selection;
    for (let d = $from.depth; d > 0; d--)
      if ($from.node(d).type.name === name) return liftListItem(listItem)(state, dispatch, view);
    const target = richSchema.nodes[name]!,
      other = name === "bulletList" ? "orderedList" : "bulletList",
      tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === other) tr.setNodeMarkup(pos, target);
    });
    if (tr.docChanged) {
      dispatch?.(tr);
      return true;
    }
    const range = $from.blockRange(state.selection.$to);
    if (range) headingsToParagraphs(tr, range.parent, range.start, from, to);
    let wrapped = false;
    wrapInList(target)(
      EditorState.create({
        doc: tr.doc,
        selection: TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)),
      }),
      (t) => {
        for (const step of t.steps) tr.step(step);
        wrapped = true;
      },
    );
    if (wrapped) dispatch?.(tr);
    return wrapped;
  };

/** Toggles a quote: inside one it lifts the selection out; otherwise it wraps the nearest blocks a quote may sit among
 * (a whole list, never part of a list item), turning headings into text. Never nests quotes. */
export const toggleQuote: Command = (state, dispatch) => {
  const { $from, $to, from, to } = state.selection;
  const inside = $from.blockRange($to, (node) => node.type === blockquote),
    target = inside && liftTarget(inside);
  if (inside) {
    if (target == null) return false;
    dispatch?.(state.tr.lift(inside, target).scrollIntoView());
    return true;
  }
  const holds = (node: EditorNode) => !!node.type.contentMatch.matchType(blockquote);
  const range = $from.blockRange($to, holds);
  if (!range) return false;
  const tr = state.tr;
  headingsToParagraphs(tr, range.parent, range.start, from, to);
  const mapped = tr.doc.resolve(from).blockRange(tr.doc.resolve(to), holds),
    wrapping = mapped && findWrapping(mapped, blockquote);
  if (!mapped || !wrapping) return false;
  dispatch?.(tr.wrap(mapped, wrapping).scrollIntoView());
  return true;
};
