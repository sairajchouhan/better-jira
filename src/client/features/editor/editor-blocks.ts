import { InputRule, inputRules } from "prosemirror-inputrules";
import type { ResolvedPos } from "prosemirror-model";
import { sinkListItem } from "prosemirror-schema-list";
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { findWrapping } from "prosemirror-transform";
import { Decoration, DecorationSet } from "prosemirror-view";
import { checklistRule } from "./editor-checklist";
import { dateNode, richSchema } from "./rich-document";

const nodes = richSchema.nodes,
  paragraph = nodes.paragraph!,
  heading = nodes.heading!,
  rule = nodes.rule!,
  panel = nodes.panel!,
  blockquote = nodes.blockquote!,
  listItem = nodes.listItem!,
  hardBreak = nodes.hardBreak!;

// --- Callouts: Linear's presets as Jira's panel types (teal note → info, green tip → success, primary important → note) ---
export const CALLOUT_PANELS = {
  note: "info",
  tip: "success",
  important: "note",
  warning: "warning",
  caution: "error",
} as const;

/** The slash Callout: wraps the selected blocks in a panel where one may stand (a whole list, never part of an item), or unwraps one. */
export const toggleCallout =
  (panelType: string = "info"): Command =>
  (state, dispatch) => {
    const { $from, $to } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type === panel) {
        dispatch?.(state.tr.replaceWith($from.before(depth), $from.after(depth), $from.node(depth).content).scrollIntoView());
        return true;
      }
    const range = $from.blockRange($to, (node) => !!node.type.contentMatch.matchType(panel)),
      wrapping = range && findWrapping(range, panel, { panelType });
    if (!range || !wrapping) return false;
    dispatch?.(state.tr.wrap(range, wrapping).scrollIntoView());
    return true;
  };

/** GitHub's `> [!NOTE]` (and TIP, IMPORTANT, WARNING, CAUTION): the quote becomes that callout; on a bare line, the line does. */
export const calloutRule = new InputRule(/^\[!(note|tip|important|warning|caution)\]$/i, (state, match, start, end) => {
  const panelType = CALLOUT_PANELS[match[1]!.toLowerCase() as keyof typeof CALLOUT_PANELS];
  if (state.doc.resolve(start).parent.type !== paragraph) return null;
  const tr = state.tr.delete(start, end),
    $p = tr.doc.resolve(start),
    quote = $p.node(-1);
  if (quote.type === blockquote && $p.index(-1) === 0) {
    const $quote = tr.doc.resolve($p.before(-1));
    if (!panel.validContent(quote.content) || !$quote.parent.canReplaceWith($quote.index(), $quote.index() + 1, panel))
      return null;
    return tr.setNodeMarkup($quote.pos, panel, { panelType });
  }
  const range = $p.blockRange(),
    wrapping = range && findWrapping(range, panel, { panelType });
  return range && wrapping ? tr.wrap(range, wrapping) : null;
});

// --- Dividers ---
const RULE_TEXT = /^(===|---|\*\*\*|___)$/;
/** The paragraph at `$pos` becomes a divider. The caret goes to the block after it; a paragraph is added there when none is
 * (or always, for Enter). */
function paragraphToRule(state: EditorState, $pos: ResolvedPos, paragraphAfter: boolean): Transaction | null {
  const index = $pos.index(-1);
  if ($pos.parent.type !== paragraph || !$pos.node(-1).canReplaceWith(index, index + 1, rule)) return null;
  const at = $pos.before(),
    tr = state.tr.replaceWith(at, $pos.after(), rule.create());
  if (paragraphAfter || !tr.doc.resolve(at + 1).nodeAfter?.isTextblock) tr.insert(at + 1, paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, at + 2));
}
/** `---`, `***`, `___` or `===` alone on a line turns into a divider as its third character is typed (Linear's rule, in place). */
export const dividerRule = new InputRule(RULE_TEXT, (state, _match, start, end) => {
  const $start = state.doc.resolve(start);
  return end === $start.end() ? paragraphToRule(state, $start, false) : null;
});
/** Enter or ArrowDown at the end of a line that is only `---` (pasted, or typed before the rule existed) makes it a divider. */
export const dividerKey =
  (paragraphAfter: boolean): Command =>
  (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type !== paragraph || $from.parentOffset !== $from.parent.content.size) return false;
    if (!RULE_TEXT.test($from.parent.textContent)) return false;
    const tr = paragraphToRule(state, $from, paragraphAfter);
    if (!tr) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
/** ⌘⇧- and the slash Divider: a divider at the caret (an empty line becomes one; text splits around it), where Jira allows one. */
export const insertDivider: Command = (state, dispatch) => {
  const { $from } = state.selection,
    index = $from.index(-1);
  if (!$from.parent.isTextblock || $from.parent.type.spec.code || !$from.depth) return false;
  if (!$from.node(-1).canReplaceWith(index, index + 1, rule)) return false;
  if (!$from.parent.content.size) {
    const tr = paragraphToRule(state, $from, false);
    if (tr) dispatch?.(tr.scrollIntoView());
    return !!tr;
  }
  if (dispatch) {
    const tr = state.tr.deleteSelection();
    let $at = tr.selection.$from;
    if ($at.parentOffset === $at.parent.content.size) {
      const after = $at.after();
      tr.insert(after, rule.create());
      if (!tr.doc.resolve(after + 1).nodeAfter?.isTextblock) tr.insert(after + 1, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 2));
    } else {
      if ($at.parentOffset) {
        tr.split($at.pos);
        $at = tr.doc.resolve($at.pos + 2);
      }
      tr.insert($at.before(), rule.create());
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// --- Smaller block keys ---
/** Backspace at a heading's start makes it a paragraph. */
export const headingBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset || $from.parent.type !== heading) return false;
  dispatch?.(state.tr.setNodeMarkup($from.before(), paragraph));
  return true;
};
/** ⇧↵: a line break in the paragraph (a newline in code). */
export const lineBreak: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.inlineContent) return false;
  dispatch?.(
    ($from.parent.type.spec.code ? state.tr.insertText("\n") : state.tr.replaceSelectionWith(hardBreak.create())).scrollIntoView(),
  );
  return true;
};
/** Two spaces at the start of a list item indent it (Linear's `/^ {2}$/`). */
export const listIndentRule = new InputRule(/^ {2}$/, (state, _match, start, end) => {
  const $start = state.doc.resolve(start);
  if ($start.node(-1).type !== listItem || $start.index(-1) !== 0) return null;
  const tr = state.tr.delete(start, end);
  let sunk = false;
  sinkListItem(listItem)(state.apply(tr), (t) => {
    for (const step of t.steps) tr.step(step);
    sunk = true;
  });
  return sunk ? tr : null;
});

/** The slash Date: today, as Jira's date. */
export const insertDate: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(dateNode(new Date()), false).scrollIntoView());
  return true;
};
export const insertText =
  (text: string): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.insertText(text).scrollIntoView());
    return true;
  };

/** Linear's tip on the caret's empty line, "Type / for commands…", once the document has something in it. */
export const slashTipPlugin = new Plugin({
  props: {
    decorations(state) {
      const { $from, empty } = state.selection;
      if (!empty || $from.depth !== 1 || $from.parent.type !== paragraph || $from.parent.content.size) return null;
      if (state.doc.childCount === 1) return null;
      return DecorationSet.create(state.doc, [Decoration.node($from.before(), $from.after(), { class: "rich-slash-tip" })]);
    },
  },
});

/** The block-level Markdown rules: `[ ]` checklists, `> [!NOTE]` callouts, `---` dividers, two-space list indent. */
export const blockRules = inputRules({ rules: [checklistRule, calloutRule, dividerRule, listIndentRule] });
