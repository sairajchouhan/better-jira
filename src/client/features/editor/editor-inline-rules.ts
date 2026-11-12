import { InputRule, inputRules } from "prosemirror-inputrules";
import { TextSelection, type EditorState } from "prosemirror-state";
import { linkTarget } from "./editor-commands";
import { safeExternalImage } from "@/client/features/media/media-layout";
import { richSchema } from "./rich-document";

// Linear's inline input rules (its `OC` mark rules, link rules and typography), none of them inside code.
const { link, strong, strike, code } = richSchema.marks;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `**bold**`, `__bold__`, `~strike~`: the delimiters go and the mark goes on the text between, keeping its other marks. */
function markRule(delimiter: string, mark: typeof strong) {
  const d = escape(delimiter),
    one = escape(delimiter[0]!);
  const pattern = new RegExp(`(?:^|[ \\t("'[\\ufffc])(${d}(?! )([^${one}\\r\\n\\f]*[^${one}\\s])${d})$`);
  return new InputRule(
    pattern,
    (state, match, start, end) => {
      const outer = match[1]!,
        inner = match[2]!,
        from = start + match[0].length - outer.length,
        innerFrom = from + delimiter.length,
        innerTo = innerFrom + inner.length;
      // The last delimiter character is being typed, so only the rest of the closing delimiter is in the document.
      return state.tr
        .delete(innerTo, end)
        .addMark(innerFrom, innerTo, mark!.create())
        .delete(from, innerFrom)
        .removeStoredMark(mark!);
    },
    { inCodeMark: false },
  );
}

// Linear's link pattern: an http(s) or www. address of dotted host words and an optional path.
const URL = String.raw`(?:https?:\/\/|www\.)[\w-]+(?:\.[\w-]+)+(?:\/[\w?&=#%-\.]*)*`;

/** A typed address followed by a space becomes a link (www. gets https://, as a typed link does). */
const autolink = new InputRule(
  new RegExp(String.raw`(?:^|\s)(${URL})\s$`),
  (state, match, _start, end) => {
    const url = match[1]!,
      from = end - url.length,
      href = linkTarget(url);
    if (!href || state.doc.rangeHasMark(from, end, link!)) return null;
    return state.tr
      .addMark(from, end, link!.create({ href }))
      .removeStoredMark(code!)
      .insertText(match[0].slice(-1), end);
  },
  { inCodeMark: false },
);

/** `[label](url)`: the label, with its marks, becomes a link to the address. */
const markdownLink = new InputRule(
  new RegExp(String.raw`(?:^|\s)\[([^\]]+)\]\((${URL})\)$`),
  (state, match, _start, end) => {
    const label = match[1]!,
      href = linkTarget(match[2]!);
    if (!href) return null;
    const from = end - (label.length + match[2]!.length + 3),
      to = from + label.length;
    return state.tr
      .delete(to + 1, end)
      .delete(from, from + 1)
      .removeMark(from, to, link!)
      .addMark(from, to, link!.create({ href }))
      .removeStoredMark(link!);
  },
  { inCodeMark: false },
);

/** `![alt](https://…)` alone in a top-level paragraph becomes that image, as Jira's external media, with the caret after it. */
const markdownImage = new InputRule(
  new RegExp(String.raw`!\[([^\]]*)\]\((${URL})\)$`),
  (state, match, start, end) => {
    const $start = state.doc.resolve(start),
      paragraph = $start.parent,
      url = safeExternalImage(match[2]);
    if (
      !url ||
      $start.depth !== 1 ||
      paragraph.type !== richSchema.nodes.paragraph ||
      $start.parentOffset !== 0 ||
      end !== $start.end()
    )
      return null;
    const alt = match[1]!.trim();
    const image = richSchema.nodes.mediaSingle!.create({
      raw: {
        type: "mediaSingle",
        attrs: { layout: "center" },
        content: [{ type: "media", attrs: { type: "external", url, ...(alt ? { alt } : {}) } }],
      },
    });
    const tr = state.tr.replaceWith($start.before(), $start.after(), [image, richSchema.nodes.paragraph!.create()]);
    return tr.setSelection(TextSelection.create(tr.doc, $start.before() + image.nodeSize + 1));
  },
  { inCodeMark: false },
);

/** Linear's `skipWhenTypingCode`: an opening backtick earlier on the line means inline code is being typed. */
const typingCode = (state: EditorState, start: number) => {
  const $start = state.doc.resolve(start),
    line = state.doc.textBetween($start.start(), start, "\n", "\n").split("\n").pop()!;
  return line.includes("`");
};
const ligature = (pattern: RegExp, replacement: string, skipWhenTypingCode = false) =>
  new InputRule(
    pattern,
    (state, _match, start, end) =>
      skipWhenTypingCode && typingCode(state, start) ? null : state.tr.insertText(replacement, start, end),
    { inCodeMark: false },
  );

export const inlineRules = inputRules({
  rules: [
    markRule("**", strong!),
    markRule("__", strong!),
    markRule("~", strike!),
    markdownImage,
    markdownLink,
    autolink,
    ligature(/\.\.\.$/, "…"),
    ligature(/-+>$/, "→", true),
    // Not after a third dash: `--- ` is the divider shortcut, and stays text where Jira allows no divider.
    ligature(/(?<!-)-- $/, "— "),
    ligature(/!=$/, "≠", true),
  ],
});
