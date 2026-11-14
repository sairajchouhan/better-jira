import { chainCommands, exitCode, lift } from "prosemirror-commands";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { Node as EditorNode, NodeRange } from "prosemirror-model";
import { liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, Plugin, PluginKey, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { findWrapping, liftTarget } from "prosemirror-transform";
import { addRowAfter, goToNextCell, isInTable } from "prosemirror-tables";
import { inlineCardNode, richSchema, safeLink } from "./rich-document";

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
    const tr = state.tr,
      ranges = linkRanges(state);
    // The caret in a link edits that whole link (R2-D6); elsewhere an empty selection inserts the URL as text.
    if (state.selection.empty && ranges.length)
      for (const [from, to] of ranges) tr.removeMark(from, to, mark.type).addMark(from, to, mark);
    else if (state.selection.empty) tr.replaceSelectionWith(richSchema.text(href, [mark]), false);
    else tr.addMark(state.selection.from, state.selection.to, mark);
    dispatch?.(tr);
    return true;
  };

/** A URL pasted over selected text links that text instead of replacing it, like Linear. Only a lone http, https or mailto address counts. */
export const pasteLink =
  (text: string): Command =>
  (state, dispatch, view) => {
    const url = text.trim(),
      href = /^(?:https?:\/\/|mailto:)\S+$/i.test(url) ? safeLink(url) : null;
    if (!href || !(state.selection instanceof TextSelection) || state.selection.empty || inCode(state))
      return false;
    return insertLink(href)(state, dispatch, view);
  };

/** Edits the selected blocks with `edit`, which returns false when it cannot apply at that level. When the result is
 * content Jira would reject (a list item without its first paragraph, an empty document), the parent block is
 * edited instead (the whole list item, then the list, then the quote). A list item's first paragraph always means the item. Table cells are never edited apart (the row is). */
const blockEdit =
  (edit: (tr: Transaction, range: NodeRange) => boolean): Command =>
  (state, dispatch) => {
    const { $from, $to } = state.selection;
    let range = $from.blockRange($to);
    while (range) {
      const tr = state.tr;
      // A list item's own first paragraph stands for the item.
      const itemText = range.parent.type === richSchema.nodes.listItem && range.startIndex === 0;
      if (range.parent.type.spec.tableRole !== "row" && !itemText && edit(tr, range))
        try {
          tr.doc.check();
          dispatch?.(tr.scrollIntoView());
          return true;
        } catch {
          /* The parent's content rules forbid this: edit the parent. */
        }
      if (!range.depth) return false;
      range = state.doc.resolve($from.before(range.depth)).blockRange(state.doc.resolve($to.after(range.depth)));
    }
    return false;
  };
/** ⌥↑ / ⌥↓: the selected blocks swap with the block before or after them. */
export const moveBlock = (dir: -1 | 1): Command =>
  blockEdit((tr, range) => {
    const index = dir < 0 ? range.startIndex - 1 : range.endIndex;
    if (index < 0 || index >= range.parent.childCount) return false;
    const sibling = range.parent.child(index);
    if (dir < 0) tr.delete(range.start - sibling.nodeSize, range.start).insert(range.end - sibling.nodeSize, sibling);
    else tr.delete(range.end, range.end + sibling.nodeSize).insert(range.start, sibling);
    return true;
  });

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
/** The address of the first link touching the selection (the caret counts), to prefill the link field. */
export function linkHref(state: EditorState): string {
  const [range] = linkRanges(state);
  if (!range) return "";
  return richSchema.marks.link!.isInSet(state.doc.nodeAt(range[0])?.marks ?? [])?.attrs.href ?? "";
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
/** A table of empty cells, or with a header row holding `header`'s texts. */
function tableOf(columns: number, rows: number, header?: string[]) {
  const cell = (type: string, text = "") =>
    richSchema.nodes[type]!.create(
      null,
      richSchema.nodes.paragraph!.create(null, text ? richSchema.text(text) : null),
    );
  const row = (type: string, texts: string[] = []) =>
    richSchema.nodes.tableRow!.create(
      null,
      Array.from({ length: columns }, (_, i) => cell(type, texts[i])),
    );
  return richSchema.nodes.table!.create(null, [
    ...(header ? [row("tableHeader", header)] : []),
    ...Array.from({ length: rows }, () => row("tableCell")),
  ]);
}
export const insertTable: Command = (state, dispatch) => {
  const table = tableOf(2, 2);
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

const words = (node: EditorNode) => node.textContent.split(/\s+/).filter(Boolean).length;
/**
 * Linear's `tRe` (startup-root): the section's heading is the first block when it is a heading, else the only block when
 * it is a paragraph of under 7 words, or that paragraph's line before its first hard break; the rest is the body (an
 * empty paragraph when nothing is left). Jira's expand keeps its heading as a plain-text title.
 */
export function expandOf(blocks: EditorNode[]): EditorNode {
  const [first] = blocks,
    paragraph = richSchema.nodes.paragraph!;
  let title = "",
    body = blocks;
  if (first?.type === richSchema.nodes.heading) {
    title = first.textContent;
    body = blocks.slice(1);
  } else if (blocks.length === 1 && first?.type === paragraph) {
    const inline: EditorNode[] = [];
    first.forEach((child) => void inline.push(child));
    const br = inline.findIndex((child) => child.type === richSchema.nodes.hardBreak),
      head = br < 0 ? first : paragraph.create(null, inline.slice(0, br));
    if (words(head) < 7) {
      title = head.textContent;
      body = br < 0 || br === inline.length - 1 ? [] : [paragraph.create(null, inline.slice(br + 1))];
    }
  }
  return richSchema.nodes.expand!.create({ title }, body.length ? body : paragraph.create());
}
/** The section a transaction just made, whose title field takes the focus (Linear puts the caret in its heading). */
export const expandTitleKey = new PluginKey<number | null>("expandTitle");
export const expandTitlePlugin = new Plugin<number | null>({
  key: expandTitleKey,
  state: {
    init: () => null,
    apply: (tr, at) =>
      tr.getMeta(expandTitleKey) ?? (at !== null && tr.getMeta("appendedTransaction") ? tr.mapping.map(at) : null),
  },
});
/** Wraps the selection's top-level blocks in a collapsible section (expandOf). False where Jira allows no expand. */
function wrapInExpand(tr: Transaction) {
  const { $from, $to } = tr.selection,
    range = $from.blockRange($to, (node) => node.type.name === "doc");
  if (!range || !findWrapping(range, richSchema.nodes.expand!)) return false;
  const blocks: EditorNode[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) blocks.push(range.parent.child(i));
  tr.replaceWith(range.start, range.end, expandOf(blocks));
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.start + 1))).setMeta(expandTitleKey, range.start);
  return true;
}
/** ⇧⌘6 / toolbar Collapse: wraps the selected top-level blocks in a collapsible section (Jira's expand), or, inside one,
 * lifts its blocks back out, its title first as a paragraph (Linear's `$Le`). Nothing happens where Jira allows no
 * expand (inside a list, quote or table). */
export const toggleExpand: Command = (state, dispatch) => {
  const { $from } = state.selection,
    expand = richSchema.nodes.expand!;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type === expand) {
      const section = $from.node(d),
        title: string = section.attrs.title,
        content = title
          ? section.content.addToStart(richSchema.nodes.paragraph!.create(null, richSchema.text(title)))
          : section.content;
      dispatch?.(state.tr.replaceWith($from.before(d), $from.after(d), content).scrollIntoView());
      return true;
    }
  const tr = state.tr;
  if (!wrapInExpand(tr)) return false;
  dispatch?.(tr.scrollIntoView());
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
/** Markdown block shortcuts and `*em*`, `_em_`, `code` while typing (Linear supports the same); editor-inline-rules has the rest. */
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
    // Linear's rule: the line becomes a section (its text the title, as ⇧⌘6 makes it), and the title takes the caret.
    new InputRule(/^>>>\s$/, (state, _match, start, end) => {
      // Only a top-level line: in a list, quote or table the text stays (Linear's `gb`).
      if (state.doc.resolve(start).depth !== 1) return null;
      const tr = state.tr.delete(start, end);
      return wrapInExpand(tr) ? tr : null;
    }),
    textblockTypeInputRule(/^```$/, richSchema.nodes.codeBlock!),
    // `|--` in a paragraph starts a table. A Markdown header row just above (`| a | b |`) becomes its header; otherwise it is 2×2, like the toolbar's.
    new InputRule(/^\|--$/, (state, _match, start) => {
      const $start = state.doc.resolve(start),
        parent = $start.node(-1),
        index = $start.index(-1);
      if ($start.parent.type !== paragraph || !parent.canReplaceWith(index, index + 1, richSchema.nodes.table!))
        return null;
      const above = index ? parent.child(index - 1) : null,
        row = above?.type === paragraph ? /^\|(.+)\|$/.exec(above.textContent.trim()) : null,
        header = row?.[1]!.split("|").map((text) => text.trim()),
        table = header ? tableOf(header.length, 1, header) : tableOf(2, 2),
        from = header ? $start.before() - above!.nodeSize : $start.before(),
        tr = state.tr.replaceWith(from, $start.after(), table);
      // The first cell below the header (or the first cell).
      const first = header ? from + 1 + table.firstChild!.nodeSize : from;
      return tr.setSelection(TextSelection.near(tr.doc.resolve(first + 1)));
    }),
    markRule(/(?<![*\w])\*([^*\s][^*]*)\*$/, "em"),
    markRule(/`([^`\s][^`]*)`$/, "code"),
    markRule(/(?<![_\w])_([^_\s][^_]*)_$/, "em"),
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

/** The new issue "Create issue from selection" starts: the first line is its title (Jira's 255 characters at most);
 * any further lines become its description. */
export function issueFromText(text: string): { title: string; description?: string } {
  const [first = "", ...rest] = text.trim().split(/\n+/),
    description = rest.join("\n\n").trim();
  return { title: first.trim().slice(0, 255), ...(description ? { description } : {}) };
}

/** Once that issue exists, the text it was made from becomes a reference to it (Jira's smart link to its /browse/ URL),
 * unless the text there has changed since. */
export function referenceSelection(
  state: EditorState,
  selection: { from: number; to: number; text: string },
  url: string,
): Transaction | null {
  const { from, to, text } = selection;
  if (to > state.doc.content.size || state.doc.textBetween(from, to, "\n") !== text) return null;
  return state.tr.replaceWith(from, to, inlineCardNode(url));
}

type Box = { top: number; bottom: number; left: number };
/** Where the selection toolbar floats: above the selection, or below it when the editor has too little room above (so it never covers
 * the title or header) and below fits. It stays within the editor's column (the side panel), scrolling when narrower (R2-D8). */
export function floatingPlacement(
  start: Box,
  end: Box,
  area: { top: number; left: number; right: number; width: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const maxWidth = Math.min(viewport.width - 24, Math.max(320, area.width)),
    width = Math.min(size.width, maxWidth),
    room = start.top - Math.max(0, area.top),
    above = start.top - 8 - size.height,
    below = end.bottom + 8;
  // Below only when it fits: clamped up from the viewport's bottom it would cover the selection (a table cell).
  const top =
    room >= 120 || (below + size.height > viewport.height - 8 && above >= 8) ? above : below;
  return {
    top: Math.max(8, Math.min(top, viewport.height - 8 - size.height)),
    left: Math.max(
      12,
      Math.min(start.left, Math.max(area.left, area.right - width), viewport.width - 12 - width),
    ),
    maxWidth,
  };
}
