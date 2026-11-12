import { expect, test } from "bun:test";
import type { Node as EditorNode } from "prosemirror-model";
import { renderToStaticMarkup } from "react-dom/server";
import { Adf } from "./adf";
import { EDITOR_NODES, EDITOR_TEXTBLOCKS, editorShaped, preservedLabel, type AdfNode } from "./editor-shape";
import { richSchema, toEditorDocument } from "./rich-document";
import { smartLinksFixture } from "./smart-links.fixture";

const doc = (...content: AdfNode[]): AdfNode => ({ type: "doc", version: 1, content });
const p = (text?: string): AdfNode => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const media: AdfNode = { type: "mediaSingle", attrs: { layout: "center" }, content: [{ type: "media", attrs: { id: "m1", type: "file", collection: "c" } }] };
const table: AdfNode = {
  type: "table",
  content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("Header")] }, { type: "tableCell", content: [p("Cell")] }] }],
};

/** A document's shape as node types, the editor's caret paragraphs marked. */
type Shape = string | [string, Shape[]];
const editorShape = (node: EditorNode): Shape => {
  const name = node.type.name === "paragraph" && node.attrs.mediaBoundary ? "caret" : node.type.name;
  if (node.isLeaf || node.isTextblock) return name;
  const children: Shape[] = [];
  node.forEach((child) => children.push(editorShape(child)));
  return [name, children];
};
const standInShape = (node: AdfNode): Shape => {
  const name = node.type === "paragraph" && node.attrs?.mediaBoundary ? "caret" : node.type;
  if (!node.content || EDITOR_TEXTBLOCKS.has(node.type) || ["mediaSingle", "mediaGroup"].includes(node.type)) return name;
  return [name, node.content.map(standInShape)];
};

test("BJ-198: the stand-in knows the editor's nodes without loading the editor", () => {
  const names = Object.keys(richSchema.nodes).filter((name) => !name.startsWith("opaque"));
  expect([...EDITOR_NODES].sort()).toEqual(names.sort());
  expect([...EDITOR_TEXTBLOCKS].sort()).toEqual(names.filter((name) => richSchema.nodes[name]!.isTextblock).sort());
});

test("BJ-198: the stand-in's document has the editor's blocks: preserved atoms, caret paragraphs, a line in an empty one", () => {
  const extension: AdfNode = { type: "extension", attrs: { extensionKey: "x" } };
  const status: AdfNode = { type: "placeholder", attrs: { text: "x" } };
  const documents = [
    doc(p("Text"), table, extension),
    doc(media, p("After")),
    doc(p("Before"), media),
    doc(media, media),
    doc({ type: "bulletList", content: [{ type: "listItem", content: [p("Item"), media] }] }),
    doc({ type: "paragraph", content: [{ type: "text", text: "a " }, status] }),
    doc({ type: "codeBlock", content: [{ type: "text", text: "x" }] }),
    doc({ type: "nestedExpand", attrs: { title: "More" }, content: [p("Hidden")] }),
    doc(),
    smartLinksFixture as AdfNode,
  ];
  for (const value of documents) expect(standInShape(editorShaped(value))).toEqual(editorShape(toEditorDocument(value)));
  expect(editorShaped(doc(p("Text"), extension)).content!.at(1)).toEqual({ type: "opaqueBlock", attrs: { raw: extension } });
});

test("BJ-198: what the editor keeps as it is stays the same object, so the stand-in ticks Jira's own checklist item", () => {
  const list: AdfNode = {
    type: "taskList",
    content: [{ type: "taskItem", attrs: { localId: "t", state: "TODO" }, content: [{ type: "text", text: "Do" }] }],
  };
  const shaped = editorShaped(doc(list, p("End")));
  expect(shaped.content![0]).toBe(list);
  const unchanged = doc(p("Only text"));
  expect(editorShaped(unchanged)).toBe(unchanged);
});

test("BJ-198: the read-only document draws lines, preserved atoms and caret paragraphs as the editor does", () => {
  const html = (node: AdfNode) => renderToStaticMarkup(<Adf node={node} />);
  // ProseMirror's trailing break keeps an empty line, or the line after a final hard break, one line tall.
  expect(html(p())).toBe('<p><br class="ProseMirror-trailingBreak"/></p>');
  expect(html({ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }] })).toBe(
    '<p>a<br/><br class="ProseMirror-trailingBreak"/></p>',
  );
  expect(html(p("a"))).toBe("<p>a</p>");
  expect(html({ type: "paragraph", attrs: { mediaBoundary: true } })).toBe('<p data-media-caret="true"><br class="ProseMirror-trailingBreak"/></p>');
  // The schema's opaque toDOM and the stand-in share one label.
  const raw = { type: "expand", attrs: { title: "Details" } };
  expect(html({ type: "opaqueBlock", attrs: { raw } })).toBe(`<div contentEditable="false" class="rich-preserved">${preservedLabel(raw)}</div>`);
  expect(preservedLabel(raw)).toBe("▸ Details");
  expect(html({ type: "opaqueInline", attrs: { raw: { type: "placeholder" } } })).toBe('<span contentEditable="false" class="rich-preserved">[placeholder]</span>');
  const spec = richSchema.nodes.opaqueBlock!.spec.toDOM!(richSchema.nodes.opaqueBlock!.create({ raw })) as readonly unknown[];
  expect(spec.at(-1)).toBe(preservedLabel(raw));
});
