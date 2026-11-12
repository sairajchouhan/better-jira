/** What the editor makes of a Jira document, without loading the editor (BJ-198): the loader's stand-in draws this so the
 *  editor that replaces it has the same blocks at the same sizes. rich-document.test.ts pins these to `richSchema`. */

/** Every node the editor's schema keeps as itself; anything else Jira sends becomes a preserved atom. */
export const EDITOR_NODES = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "blockquote",
  "panel",
  "expand",
  "rule",
  "mention",
  "emoji",
  "status",
  "date",
  "inlineCard",
  "blockCard",
  "embedCard",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "mediaSingle",
  "mediaGroup",
  "media",
  "mediaInline",
]);
/** The editor's nodes that hold text directly (ProseMirror's textblocks). */
export const EDITOR_TEXTBLOCKS = new Set(["paragraph", "heading", "taskItem", "codeBlock"]);
const BLOCK_MEDIA = new Set(["mediaSingle", "mediaGroup", "media"]);

/** The label of a Jira node the editor keeps but can't edit. */
export const preservedLabel = (raw: { type?: string; attrs?: { title?: string } } | null | undefined) =>
  /expand/i.test(raw?.type ?? "") ? `▸ ${raw?.attrs?.title || "Expand"}` : `[${raw?.type ?? "Jira content"}]`;

/** Where the editor adds its empty caret paragraphs (media-caret.ts): beside block media with no text next to it, and at
 *  the end of a document whose last block is not text, like Linear's trailing node. One rule for the editor's nodes and the
 *  stand-in's ADF. */
export function withCaretParagraphs<T>(
  children: readonly T[],
  { doc, type, textblock, caret }: { doc: boolean; type: (node: T) => string; textblock: (node: T) => boolean; caret: () => T },
): T[] {
  const media = (node: T | undefined) => node !== undefined && BLOCK_MEDIA.has(type(node));
  const out: T[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (media(child) && !(out.length && textblock(out.at(-1)!))) out.push(caret());
    out.push(child);
    const next = children[i + 1];
    if (media(child) && !(next !== undefined && textblock(next)) && !media(next)) out.push(caret());
  }
  if (doc && out.length && !textblock(out.at(-1)!)) out.push(caret());
  return out;
}

export type AdfNode = { type: string; attrs?: Record<string, any>; content?: AdfNode[]; [key: string]: unknown };
const caret = (): AdfNode => ({ type: "paragraph", attrs: { mediaBoundary: true } });

/** A Jira document as the editor will hold it: unfamiliar nodes as preserved atoms and its caret paragraphs in place. */
export function editorShaped(node: AdfNode, inline = false): AdfNode {
  if (!EDITOR_NODES.has(node.type)) return { type: inline ? "opaqueInline" : "opaqueBlock", attrs: { raw: node } };
  if (!node.content || BLOCK_MEDIA.has(node.type) || node.type === "mediaInline") return node;
  const content = node.content.map((child) => editorShaped(child, EDITOR_TEXTBLOCKS.has(node.type)));
  // The editor's document always has a line to type on.
  if (node.type === "doc" && !content.length) content.push({ type: "paragraph" });
  const shaped = withCaretParagraphs(content, {
    doc: node.type === "doc",
    type: (n) => n.type,
    textblock: (n) => EDITOR_TEXTBLOCKS.has(n.type),
    caret,
  });
  // A branch the editor keeps as it is stays the same object, so a checklist item ticked in the stand-in is found in Jira's document.
  return shaped.length === node.content.length && shaped.every((child, i) => child === node.content![i])
    ? node
    : { ...node, content: shaped };
}
