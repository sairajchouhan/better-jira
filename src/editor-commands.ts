import { chainCommands, exitCode } from "prosemirror-commands";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { liftListItem, sinkListItem } from "prosemirror-schema-list";
import { TextSelection, type Command } from "prosemirror-state";
import { addRowAfter, goToNextCell, isInTable } from "prosemirror-tables";
import { richSchema } from "./rich-document";

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
  addRowAfter(state, t => (tr = t));
  if (!tr) return false;
  dispatch?.(tr.setSelection(TextSelection.near(tr.doc.resolve(rowEnd + 2))).scrollIntoView());
  return true;
};
const indentCode: Command = (state, dispatch) => inCode(state) && (dispatch?.(state.tr.insertText("  ").scrollIntoView()), true);
/** Tab never leaves the editor: a stray Tab used to move focus to a button, so the next ⌘Z undid board edits. */
const keepFocus: Command = () => true;
export const tab: Command = chainCommands(goToNextCell(1), addRowAtEnd, sinkListItem(richSchema.nodes.listItem!), indentCode, keepFocus);
export const shiftTab: Command = chainCommands(goToNextCell(-1), liftListItem(richSchema.nodes.listItem!), keepFocus);

const atCodeEnd = (state: Parameters<Command>[0]) => {
  const { $head, empty } = state.selection;
  return empty && inCode(state) && $head.parentOffset === $head.parent.content.size;
};
/** ArrowDown at the end of a code block that nothing follows opens a paragraph below it. */
export const codeDown: Command = (state, dispatch, view) => {
  const { $head } = state.selection;
  if (!atCodeEnd(state) || $head.index($head.depth - 1) !== $head.node($head.depth - 1).childCount - 1) return false;
  return exitCode(state, dispatch, view);
};
/** A third Enter on a code block's trailing blank lines leaves the block, dropping those lines. */
export const codeEnter: Command = (state, dispatch) => {
  if (!atCodeEnd(state) || !state.selection.$head.parent.textContent.endsWith("\n\n")) return false;
  if (dispatch) {
    const { $head } = state.selection, end = $head.pos, after = $head.after();
    const tr = state.tr.delete(end - 2, end), pos = tr.mapping.map(after);
    tr.insert(pos, richSchema.nodes.paragraph!.create());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
  }
  return true;
};

/** Without a selection the URL is inserted as linked text; replaceSelectionWith must not inherit (and drop) marks. */
export const insertLink = (href: string): Command => (state, dispatch) => {
  const mark = richSchema.marks.link!.create({ href });
  const tr = state.tr;
  if (state.selection.empty) tr.replaceSelectionWith(richSchema.text(href, [mark]), false);
  else tr.addMark(state.selection.from, state.selection.to, mark);
  dispatch?.(tr);
  return true;
};

/** A 2×2 table with the caret in its first cell. */
export const insertTable: Command = (state, dispatch) => {
  const cell = () => richSchema.nodes.tableCell!.createAndFill()!;
  const row = () => richSchema.nodes.tableRow!.create(null, [cell(), cell()]);
  const table = richSchema.nodes.table!.create(null, [row(), row()]);
  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(table), from = tr.mapping.map(state.selection.from, -1);
    let start = -1;
    tr.doc.nodesBetween(Math.max(0, from - 2), tr.doc.content.size, (node, pos) => { if (start < 0 && node.type === table.type) start = pos; return start < 0; });
    if (start >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

const markRule = (pattern: RegExp, mark: string) => new InputRule(pattern, (state, match, start, end) => {
  const type = richSchema.marks[mark]!, text = match[1]!;
  return state.tr.replaceWith(start, end, richSchema.text(text, [type.create()])).removeStoredMark(type);
});
/** Markdown shortcuts while typing (Linear supports the same), and bare URLs become links when a space follows. */
export const markdownRules = inputRules({ rules: [
  textblockTypeInputRule(/^(#{1,4})\s$/, richSchema.nodes.heading!, match => ({ level: match[1]!.length })),
  wrappingInputRule(/^\s*[-+*]\s$/, richSchema.nodes.bulletList!),
  wrappingInputRule(/^(\d+)\.\s$/, richSchema.nodes.orderedList!, match => ({ order: Number(match[1]) }), (match, node) => node.childCount + node.attrs.order === Number(match[1])),
  wrappingInputRule(/^\s*>\s$/, richSchema.nodes.blockquote!),
  textblockTypeInputRule(/^```$/, richSchema.nodes.codeBlock!),
  markRule(/\*\*([^*\s][^*]*)\*\*$/, "strong"),
  markRule(/(?<![*\w])\*([^*\s][^*]*)\*$/, "em"),
  markRule(/`([^`\s][^`]*)`$/, "code"),
  markRule(/~~([^~\s][^~]*)~~$/, "strike"),
  markRule(/(?<![~\w])~([^~\s][^~]*)~$/, "strike"),
  markRule(/(?<![_\w])_([^_\s][^_]*)_$/, "em"),
  new InputRule(/(?:^|\s)(https?:\/\/[^\s]+[^\s.,;:!?)])\s$/, (state, match, start, end) => {
    const url = match[1]!, from = end - url.length, link = richSchema.marks.link!;
    if (state.doc.rangeHasMark(from, end, link)) return null;
    return state.tr.addMark(from, end, link.create({ href: url })).insertText(match[0].slice(-1), end).removeStoredMark(link);
  }),
] });
