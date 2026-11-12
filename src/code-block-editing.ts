/**
 * Editing inside a code block, ported from Linear's `hx` source-block commands and `code_block` keys (startup-root.CnUSfl4j.js),
 * and the plugin that highlights every code block (Linear's `YLe`).
 */
import { setBlockType } from "prosemirror-commands";
import type { Node as EditorNode, ResolvedPos } from "prosemirror-model";
import { liftListItem, sinkListItem } from "prosemirror-schema-list";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { codeBlockBindings } from "./editor-bindings";
import { codeLanguage, highlightCode, lineStarts, onHighlighter } from "./code-languages";
import { richSchema } from "./rich-document";

const TAB = "  ";
const inCode = ($pos: ResolvedPos) => $pos.parent.type === richSchema.nodes.codeBlock;

/** ⌘A in a code block selects its text; a second ⌘A selects the document (Linear's `selectSourceCodeBlockText`). */
export const selectCode: Command = (state, dispatch) => {
  const { $from, $to, from, to } = state.selection;
  if (!inCode($from) || $to.parent !== $from.parent) return false;
  const start = $from.start(),
    end = $from.end();
  if (from === start && to === end) return false;
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
  return true;
};

/** The starts of the lines the selection touches, as document positions (Linear's `findLineStart` loop). */
function selectedLines(state: EditorState) {
  const { $from, from } = state.selection,
    start = $from.start(),
    to = Math.min(state.selection.to, $from.end()),
    starts = lineStarts($from.parent.textContent).map((offset) => start + offset);
  return starts.filter((pos, i) => (pos <= from && (starts[i + 1] ?? Infinity) > from) || (pos > from && pos < to));
}

/** Tab: two spaces at the caret, or before each selected line (Linear's `indentSourceCodeBlock`). */
export const indentCode: Command = (state, dispatch) => {
  const { $from, from, to, empty } = state.selection;
  if (!inCode($from)) return false;
  if (!dispatch) return true;
  if (empty) {
    dispatch(state.tr.insertText(TAB, from).scrollIntoView());
    return true;
  }
  const tr = state.tr;
  for (const pos of selectedLines(state).reverse()) tr.insertText(TAB, pos);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, -1), tr.mapping.map(to))).scrollIntoView());
  return true;
};

/** ⇧Tab: up to two leading spaces off each selected line (Linear's `outdentSourceCodeBlock`). */
export const outdentCode: Command = (state, dispatch) => {
  if (!inCode(state.selection.$from)) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  for (const pos of selectedLines(state).reverse()) {
    const spaces = /^ {0,2}/.exec(state.doc.textBetween(pos, Math.min(pos + 2, state.selection.$from.end())))![0].length;
    if (spaces) tr.delete(pos, pos + spaces);
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** ⌫ at a code block's start turns it into text: an empty one into an empty paragraph, a full one into a paragraph whose
 *  lines are hard breaks (Linear's `removeSourceCodeBlockWhenEmpty`). */
export const codeToText: Command = (state, dispatch, view) => {
  const { $from, empty } = state.selection,
    { paragraph, hardBreak } = richSchema.nodes;
  if (!empty || !inCode($from) || $from.parentOffset !== 0) return false;
  const text = $from.parent.textContent;
  if (!text) return setBlockType(paragraph!)(state, dispatch, view);
  if (dispatch) {
    const lines = text.replace(/\n$/, "").split("\n"),
      content = lines.flatMap((line, i) => [...(i ? [hardBreak!.create()] : []), ...(line ? [richSchema.text(line)] : [])]),
      tr = state.tr.replaceWith($from.before(), $from.after(), paragraph!.create(null, content));
    dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1)).scrollIntoView());
  }
  return true;
};

/** ⌫ after nothing but spaces on a line deletes back to the previous two-space stop (`outdentSourceCodeBlockOnBackspace`). */
export const backspaceIndent: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !inCode($from)) return false;
  const before = $from.parent.textBetween(0, $from.parentOffset),
    indent = before.slice(before.lastIndexOf("\n") + 1);
  if (!/^ +$/.test(indent)) return false;
  const width = indent.length % TAB.length || TAB.length;
  dispatch?.(state.tr.delete($from.pos - width, $from.pos));
  return true;
};

/** ⌥Tab / ⇧⌥Tab in a code block inside a list item move the item in or out (Linear's `v2e` / `_2e`). */
const listItemOfCode =
  (move: typeof sinkListItem): Command =>
  (state, dispatch) => {
    const { $from } = state.selection,
      listItem = richSchema.nodes.listItem!;
    return inCode($from) && $from.depth > 1 && $from.node(-1).type === listItem && move(listItem)(state, dispatch);
  };

type LineRange = { start: number; indent: number; contentEnd: number; text: string; isEmpty: boolean };
/** Each touched line: where it starts, its indent, where its content ends and its trimmed text (Linear's `getLineRanges`). */
function lineRanges(state: EditorState): LineRange[] {
  const { $from } = state.selection,
    start = $from.start(),
    text = $from.parent.textContent;
  return selectedLines(state).map((pos) => {
    const from = pos - start,
      newline = text.indexOf("\n", from),
      end = newline < 0 ? text.length : newline,
      body = text.slice(from, end),
      indent = body.length - body.trimStart().length,
      trimmed = body.trim();
    return {
      start: pos,
      indent,
      contentEnd: pos + indent + trimmed.length,
      text: trimmed,
      isEmpty: !trimmed,
    };
  });
}

/** ⌘/: comments or uncomments the selected lines in the block's language (Linear's `toggleLineComment`). */
export const toggleLineComment: Command = (state, dispatch) => {
  const { $from, from, to, empty } = state.selection;
  if (!inCode($from)) return false;
  const stored = $from.parent.attrs.language as string | null,
    language = codeLanguage(stored ?? detectedLanguage(state, $from.before())),
    syntax = language?.comment;
  if (!syntax) return false;
  if (!dispatch) return true;
  const tr = state.tr,
    lines = lineRanges(state),
    single = lines.length === 1 && empty && lines[0]!.isEmpty,
    line = "line" in syntax ? syntax.line : undefined,
    block = "block" in syntax ? syntax.block : undefined;
  const commented = lines.every((l) =>
    l.isEmpty
      ? !single
      : line
        ? l.text.startsWith(line)
        : l.text.startsWith(block!.start) && l.text.endsWith(block!.end),
  );
  const indent = line ? Math.min(...lines.filter((l) => !l.isEmpty).map((l) => l.indent), Infinity) : 0;
  for (const l of lines) {
    if (l.isEmpty && !single) continue;
    const at = tr.mapping.map(l.start),
      content = at + l.indent,
      end = tr.mapping.map(l.contentEnd);
    if (commented && !l.isEmpty) {
      if (line) tr.delete(content, content + line.length + (l.text[line.length] === " " ? 1 : 0));
      else {
        const spaceBefore = tr.doc.textBetween(end - block!.end.length - 1, end - block!.end.length) === " ",
          spaceAfter = tr.doc.textBetween(content + block!.start.length, content + block!.start.length + 1) === " ";
        tr.delete(end - block!.end.length - (spaceBefore ? 1 : 0), end);
        tr.delete(content, content + block!.start.length + (spaceAfter ? 1 : 0));
      }
    } else if (line) tr.insertText(`${line} `, at + (l.isEmpty || indent === Infinity ? 0 : indent));
    else if (l.isEmpty) tr.insertText(block!.start + block!.end, at);
    else {
      tr.insertText(` ${block!.end}`, end);
      tr.insertText(`${block!.start} `, content);
    }
  }
  dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to))).scrollIntoView());
  return true;
};

const COMMANDS: Record<string, Command> = {
  "code-indent": indentCode,
  "code-outdent": outdentCode,
  "code-indent-item": listItemOfCode(sinkListItem),
  "code-outdent-item": listItemOfCode(liftListItem),
  "code-select": selectCode,
  "code-comment": toggleLineComment,
  "code-backspace": (state, dispatch, view) => codeToText(state, dispatch, view) || backspaceIndent(state, dispatch, view),
};
/** The code keymap, keyed in ProseMirror's spelling of the bindings Help lists ("Mod+A" → "Mod-a"). */
export const codeBlockKeys: Record<string, Command> = Object.fromEntries(
  codeBlockBindings.map((binding) => [
    String(binding.hotkey)
      .split("+")
      .map((key, i, keys) => (i === keys.length - 1 && key.length === 1 ? key.toLowerCase() : key))
      .join("-"),
    COMMANDS[binding.id]!,
  ]),
);

type BlockState = { decorations: DecorationSet; detected: (string | null | undefined)[] };
const highlightKey = new PluginKey<BlockState>("codeHighlight");
/** The language auto-detect chose for the code block at `pos`, if it has chosen one. */
export function detectedLanguage(state: EditorState, pos: number): string | null | undefined {
  let index = -1,
    found: number | undefined;
  state.doc.descendants((node, at) => {
    if (found !== undefined) return false;
    if (node.type !== richSchema.nodes.codeBlock) return true;
    index++;
    if (at === pos) found = index;
    return false;
  });
  return found === undefined ? undefined : highlightKey.getState(state)?.detected[found];
}
/** The node decoration's spec carries a block's detected language to its node view. */
export const detectedOf = (decorations: readonly Decoration[]) =>
  decorations.find((d) => d.spec.codeBlock)?.spec.detected as string | null | undefined;

/** Tokens for every code block. While a block with no language is being typed in, its last guess keeps colouring it;
 *  `guess` asks for a fresh one (Linear guesses 600ms after typing stops, `ULe`). */
function highlightBlocks(doc: EditorNode, previous: (string | null | undefined)[], guess: boolean): BlockState {
  const decorations: Decoration[] = [],
    detected: (string | null | undefined)[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== richSchema.nodes.codeBlock) return true;
    const text = node.textContent,
      stored = (node.attrs.language as string | null) ?? null,
      last = previous[detected.length];
    let result = highlightCode(text, stored, guess);
    if (!result && stored == null && last) result = highlightCode(text, last);
    const guessed = stored == null ? (result?.language ?? last) : null;
    detected.push(guessed);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { codeBlock: true, detected: guessed }));
    for (const token of result?.tokens ?? [])
      decorations.push(Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }));
    return false;
  });
  return { decorations: DecorationSet.create(doc, decorations), detected };
}

export const codeHighlightPlugin = () =>
  new Plugin<BlockState>({
    key: highlightKey,
    state: {
      init: (_, state) => highlightBlocks(state.doc, [], true),
      apply(tr, value, _old, state) {
        const refresh = tr.getMeta(highlightKey);
        if (!tr.docChanged && !refresh) return value;
        return highlightBlocks(state.doc, value.detected, !!refresh);
      },
    },
    props: { decorations: (state) => highlightKey.getState(state)?.decorations },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const refresh = () => {
        clearTimeout(timer);
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(highlightKey, true));
      };
      const unsubscribe = onHighlighter(refresh);
      return {
        update(_, previous) {
          if (previous.doc === view.state.doc) return;
          clearTimeout(timer);
          timer = setTimeout(refresh, 600);
        },
        destroy() {
          clearTimeout(timer);
          unsubscribe();
        },
      };
    },
  });
