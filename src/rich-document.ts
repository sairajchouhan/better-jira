import { mediaCaretDocument } from "./media-caret";
import { Schema, type MarkSpec, type Node as EditorNode, type NodeSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

import {
  normalizeDocument,
  safeLink,
  jiraDate,
  cardText,
  type AdfMark,
  type AdfNode,
  type AdfDocument,
} from "./document";
export {
  normalizeDocument,
  safeLink,
  plainDocument,
  type AdfMark,
  type AdfNode,
  type AdfDocument,
} from "./document";
type Original = { data: Record<string, unknown>; hadContent: boolean };
const original = { default: null };
const attrs = { original };
const block = (tag: string, content = "block+"): NodeSpec => ({
  group: "block",
  content,
  marks: "_",
  attrs,
  toDOM: () => [tag, 0],
  parseDOM: [{ tag }],
});
const inlineAtom = (name: string, tag = "span"): NodeSpec => ({
  inline: true,
  group: "inline",
  atom: true,
  attrs,
  toDOM: (node) => [
    tag,
    { contenteditable: "false", class: "rich-token" },
    String(
      node.attrs.original?.data.attrs?.text ?? node.attrs.original?.data.attrs?.shortName ?? name,
    ),
  ],
});
// Jira's ADF content model, so no command, keystroke or paste can build nesting Jira rejects (a heading in a quote, a quote in a list item, a table in a table).
// opaqueBlock keeps unfamiliar Jira blocks editable around; only Jira can put one there.
const QUOTE = "(paragraph|bulletList|orderedList|codeBlock|mediaSingle|mediaGroup|opaqueBlock)+";
const LIST_ITEM =
  "paragraph (paragraph|bulletList|orderedList|taskList|codeBlock|mediaSingle|opaqueBlock)*";
const PANEL =
  "(paragraph|heading|bulletList|orderedList|taskList|codeBlock|rule|blockCard|mediaSingle|mediaGroup|opaqueBlock)+";
const CELL =
  "(paragraph|heading|bulletList|orderedList|taskList|codeBlock|blockquote|panel|rule|blockCard|mediaSingle|mediaGroup|opaqueBlock)+";
/** Jira's expand: top level only (in a table cell Jira wants a nestedExpand, kept opaque). */
const EXPAND =
  "(paragraph|panel|blockquote|orderedList|bulletList|rule|heading|codeBlock|mediaGroup|mediaSingle|taskList|table|blockCard|opaqueBlock)+";
const table = tableNodes({ tableGroup: "block", cellContent: CELL, cellAttributes: {} });
function tableNode(name: keyof typeof table, role: string): NodeSpec {
  const spec = table[name]!;
  return {
    ...spec,
    attrs: { ...spec.attrs, original },
    marks: "_",
    content: spec.content
      ?.replaceAll("table_row", "tableRow")
      .replaceAll("table_cell", "tableCell")
      .replaceAll("table_header", "tableHeader"),
    tableRole: role,
  };
}

const mark = (tag: string): MarkSpec => ({ attrs, toDOM: () => [tag, 0], parseDOM: [{ tag }] });
const MEDIA_TYPES = new Set(["mediaSingle", "mediaGroup", "media", "mediaInline"]);
const opaque = (inline: boolean): NodeSpec => ({
  group: inline ? "inline" : "block",
  inline,
  atom: true,
  isolating: true,
  attrs: { raw: { default: null } },
  toDOM: (node) => [
    inline ? "span" : "div",
    { contenteditable: "false", class: "rich-preserved" },
    /expand/i.test(node.attrs.raw?.type)
      ? `▸ ${node.attrs.raw.attrs?.title || "Expand"}`
      : `[${node.attrs.raw?.type ?? "Jira content"}]`,
  ],
});
/** Smart links stay read-only, but open their URL like Jira's. */
const card = (block: boolean): NodeSpec => ({
  ...(block ? { group: "block" } : { inline: true, group: "inline" }),
  atom: true,
  attrs,
  toDOM: (node) => {
    const url = node.attrs.original?.data.attrs?.url;
    return [
      "a",
      {
        contenteditable: "false",
        class: block ? "rich-preserved" : "rich-token",
        href: safeLink(url) ?? "",
        target: "_blank",
        rel: "noreferrer",
      },
      cardText(url),
    ];
  },
});

export const richSchema = new Schema({
  nodes: {
    doc: { content: "(block|expand)+", marks: "_", attrs },
    paragraph: {
      ...block("p", "inline*"),
      group: "block",
      attrs: { ...attrs, mediaBoundary: { default: false } },
      toDOM: (node) => ["p", node.attrs.mediaBoundary ? { "data-media-caret": "true" } : {}, 0],
    },
    text: { group: "inline" },
    hardBreak: {
      inline: true,
      group: "inline",
      selectable: false,
      attrs,
      toDOM: () => ["br"],
      parseDOM: [{ tag: "br" }],
    },
    heading: {
      ...block("h2", "inline*"),
      attrs: { ...attrs, level: { default: 2 } },
      defining: true,
      toDOM: (node) => [`h${Math.max(1, Math.min(6, node.attrs.level))}`, 0],
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    },
    bulletList: { ...block("ul", "listItem+"), parseDOM: [{ tag: "ul" }] },
    orderedList: {
      ...block("ol", "listItem+"),
      attrs: { ...attrs, order: { default: 1 } },
      toDOM: (node) => ["ol", { start: node.attrs.order }, 0],
      parseDOM: [
        { tag: "ol", getAttrs: (dom) => ({ order: Number(dom.getAttribute("start")) || 1 }) },
      ],
    },
    listItem: {
      content: LIST_ITEM,
      marks: "_",
      attrs,
      defining: true,
      toDOM: () => ["li", 0],
      parseDOM: [{ tag: "li" }],
    },
    taskList: {
      ...block("ul", "taskItem+"),
      parseDOM: [],
      toDOM: () => ["ul", { "data-task-list": "true" }, 0],
    },
    taskItem: {
      ...block("li", "inline*"),
      group: undefined,
      attrs: { ...attrs, state: { default: "TODO" } },
      defining: true,
      parseDOM: [],
      toDOM: (node) => ["li", { "data-task-state": node.attrs.state }, 0],
    },
    codeBlock: {
      ...block("pre", "text*"),
      attrs: { ...attrs, language: { default: null } },
      code: true,
      marks: "",
      defining: true,
      whitespace: "pre",
      toDOM: () => ["pre", ["code", 0]],
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    },
    blockquote: { ...block("blockquote", QUOTE), defining: true },
    panel: {
      ...block("div", PANEL),
      isolating: true,
      parseDOM: [],
      toDOM: () => ["div", { class: "rich-panel" }, 0],
    },
    expand: {
      content: EXPAND,
      marks: "_",
      attrs: { ...attrs, title: { default: "" } },
      defining: true,
      isolating: true,
      toDOM: (node) => ["div", { class: "rich-expand", "data-title": node.attrs.title }, 0],
    },
    rule: { group: "block", attrs, toDOM: () => ["hr"], parseDOM: [{ tag: "hr" }] },
    mention: {
      ...inlineAtom("mention"),
      toDOM: (node) => [
        "span",
        {
          contenteditable: "false",
          class: "mention-chip",
          "data-mention-id": String(node.attrs.original?.data.attrs?.id ?? ""),
        },
        String(node.attrs.original?.data.attrs?.text || "@Unknown"),
      ],
    },
    emoji: inlineAtom("emoji"),
    status: inlineAtom("status"),
    date: {
      ...inlineAtom("date"),
      toDOM: (node) => [
        "span",
        { contenteditable: "false", class: "rich-token" },
        jiraDate(node.attrs.original?.data.attrs?.timestamp),
      ],
    },
    inlineCard: card(false),
    blockCard: card(true),
    table: tableNode("table", "table"),
    tableRow: tableNode("table_row", "row"),
    tableCell: tableNode("table_cell", "cell"),
    tableHeader: tableNode("table_header", "header_cell"),
    mediaSingle: opaque(false),
    mediaGroup: opaque(false),
    media: { ...opaque(false), group: undefined },
    mediaInline: opaque(true),
    opaqueBlock: opaque(false),
    opaqueInline: opaque(true),
  },
  marks: {
    strong: mark("strong"),
    em: mark("em"),
    underline: mark("u"),
    strike: mark("s"),
    // Jira accepts inline code only with a link: applying code drops the other marks, and they can't be added to code.
    code: {
      ...mark("code"),
      code: true,
      excludes: "code strong em underline strike subsup textColor backgroundColor",
    },
    link: {
      attrs: { ...attrs, href: { default: null } },
      inclusive: false,
      toDOM: (m) => ["a", { href: safeLink(m.attrs.href), rel: "noreferrer" }, 0],
      parseDOM: [
        { tag: "a[href]", getAttrs: (dom) => ({ href: safeLink(dom.getAttribute("href")) }) },
      ],
    },
    subsup: {
      attrs: { ...attrs, type: { default: "sub" } },
      toDOM: (m) => [m.attrs.type === "sup" ? "sup" : "sub", 0],
      parseDOM: [
        { tag: "sub", attrs: { type: "sub" } },
        { tag: "sup", attrs: { type: "sup" } },
      ],
    },
    textColor: {
      attrs: { ...attrs, color: { default: null } },
      toDOM: (m) => [
        "span",
        { style: /^#[\da-f]{3,8}$/i.test(m.attrs.color ?? "") ? `color:${m.attrs.color}` : "" },
        0,
      ],
    },
    backgroundColor: {
      attrs: { ...attrs, color: { default: null } },
      toDOM: (m) => [
        "span",
        {
          // Jira's highlight colours are light, so the text on them stays dark in either theme.
          style: /^#[\da-f]{3,8}$/i.test(m.attrs.color ?? "")
            ? `background-color:${m.attrs.color};color:#172b4d`
            : "",
        },
        0,
      ],
    },
    opaqueMark: { attrs: { raw: { default: [] } }, excludes: "", toDOM: () => ["span", 0] },
    textMetadata: { attrs: { raw: { default: null } }, excludes: "", toDOM: () => ["span", 0] },
  },
});

const fields: Record<string, Record<string, unknown>> = {
  heading: { level: 2 },
  orderedList: { order: 1 },
  codeBlock: { language: null },
  taskItem: { state: "TODO" },
  expand: { title: "" },
  tableCell: { colspan: 1, rowspan: 1, colwidth: null },
  tableHeader: { colspan: 1, rowspan: 1, colwidth: null },
};
/** Attributes Jira rejects a node or mark without, so they are sent even when they equal the default. */
const REQUIRED = new Set(["heading.level", "taskItem.state", "subsup.type", "expand.title"]);
/** Jira's marks allowed together with inline code. */
const WITH_CODE = new Set(["code", "link", "opaqueMark", "textMetadata"]);
const markFields: Record<string, Record<string, unknown>> = {
  link: { href: null },
  subsup: { type: "sub" },
  textColor: { color: null },
  backgroundColor: { color: null },
};
function originalOf(node: AdfNode): Original {
  const { content, ...data } = node;
  return { data, hadContent: Object.hasOwn(node, "content") };
}
function editorMarks(marks: AdfMark[] = []) {
  const opaqueMarks = marks.filter(
    (m) => !richSchema.marks[m.type] || ["opaqueMark", "textMetadata"].includes(m.type),
  );
  return [
    ...marks
      .filter((m) => richSchema.marks[m.type] && !["opaqueMark", "textMetadata"].includes(m.type))
      .map((m) => richSchema.marks[m.type]!.create({ original: structuredClone(m), ...m.attrs })),
    ...(opaqueMarks.length
      ? [richSchema.marks.opaqueMark!.create({ raw: structuredClone(opaqueMarks) })]
      : []),
  ];
}
function nodeToEditor(node: AdfNode, inline = false): EditorNode {
  if (MEDIA_TYPES.has(node.type))
    return richSchema.nodes[node.type]!.create({ raw: structuredClone(node) });
  if (node.type === "text" && node.text) {
    const { type, text, marks, ...metadata } = node;
    return richSchema.text(text, [
      ...editorMarks(marks),
      ...(Object.keys(metadata).length || marks?.length
        ? [
            richSchema.marks.textMetadata!.create({
              raw: { data: metadata, order: marks?.map((m) => m.type) ?? [] },
            }),
          ]
        : []),
    ]);
  }
  const type = richSchema.nodes[node.type];
  if (type && !["opaqueBlock", "opaqueInline", "text"].includes(node.type)) {
    try {
      const children = (node.content ?? []).map((c) => nodeToEditor(c, type.inlineContent));
      const editorAttrs = { original: originalOf(node), ...node.attrs };
      const converted = type.create(editorAttrs, children, editorMarks(node.marks));
      if (type.validContent(converted.content)) return converted;
    } catch {
      /* Preserve an unfamiliar or invalid branch as a single editable-document atom. */
    }
  }
  return richSchema.nodes[inline ? "opaqueInline" : "opaqueBlock"]!.create({
    raw: structuredClone(node),
  });
}
export function toEditorDocument(value: unknown): EditorNode {
  const doc = normalizeDocument(value);
  return mediaCaretDocument(
    richSchema.nodes.doc!.create(
      { original: originalOf(doc) },
      doc.content?.length
        ? doc.content.map((n) => nodeToEditor(n))
        : richSchema.nodes.paragraph!.create(),
    ),
  );
}
function exportedAttrs(
  type: string,
  base: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
) {
  const result = { ...base };
  for (const [name, fallback] of Object.entries(defaults))
    if (
      Object.hasOwn(result, name) ||
      REQUIRED.has(`${type}.${name}`) ||
      JSON.stringify(values[name]) !== JSON.stringify(fallback)
    )
      result[name] = values[name];
  return Object.keys(result).length ? result : undefined;
}
function fromEditorNode(node: EditorNode): AdfNode {
  if (
    MEDIA_TYPES.has(node.type.name) ||
    node.type.name === "opaqueBlock" ||
    node.type.name === "opaqueInline"
  )
    return structuredClone(node.attrs.raw);
  const original = node.attrs.original as Original | null;
  const data: AdfNode = { ...original?.data, type: node.type.name };
  const extra = node.marks.find((m) => m.type.name === "textMetadata")?.attrs.raw;
  if (node.isText) {
    Object.assign(data, extra?.data ?? {});
    data.text = node.text;
  } else {
    const baseAttrs = { ...data.attrs };
    if (original?.data.type !== node.type.name)
      for (const key of Object.keys(fields[String(original?.data.type)] ?? {}))
        delete baseAttrs[key];
    const attrs = exportedAttrs(node.type.name, baseAttrs, node.attrs, fields[node.type.name]);
    // Jira requires a task's localId; a task made here (Enter at the end of one) has none yet.
    if (["taskList", "taskItem"].includes(node.type.name) && attrs && !attrs.localId)
      attrs.localId = crypto.randomUUID();
    // Auto detect stores no language: Jira's codeBlock language is a string or absent.
    if (attrs?.language === null) delete attrs.language;
    if (attrs && Object.keys(attrs).length) data.attrs = attrs;
    else delete data.attrs;
    if (node.childCount || original?.hadContent) {
      data.content = [];
      node.forEach((child) => {
        if (!(child.type.name === "paragraph" && child.attrs.mediaBoundary && !child.content.size))
          data.content!.push(fromEditorNode(child));
      });
    }
  }
  // Jira rejects formatting marks on anything but text (a table that inherited a link) and any mark but a link beside code.
  const code = node.isText && node.marks.some((m) => m.type.name === "code");
  const marks = node.marks.flatMap((mark) => {
    const name = mark.type.name;
    if (name === "textMetadata" || (code && !WITH_CODE.has(name))) return [];
    if (name === "opaqueMark") return structuredClone(mark.attrs.raw) as AdfMark[];
    if (
      !node.isText &&
      !(original?.data.marks as AdfMark[] | undefined)?.some((m) => m.type === name)
    )
      return [];
    const out: AdfMark = { ...mark.attrs.original, type: name };
    const attrs = exportedAttrs(name, out.attrs, mark.attrs, markFields[name]);
    if (attrs) out.attrs = attrs;
    else delete out.attrs;
    return [out];
  });
  // Mark order is not semantic; retain the original order for untouched Jira content.
  const order: string[] =
    extra?.order ?? ((original?.data.marks as AdfMark[] | undefined) ?? []).map((m) => m.type);
  marks.sort((a, b) => {
    const ai = order.indexOf(a.type),
      bi = order.indexOf(b.type);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  if (marks.length) data.marks = marks;
  else delete data.marks;
  return data;
}
/** Jira's mention node: the account ID notifies the person; Jira stores the display text with its "@". */
export const mentionNode = (person: { id: string; name: string }) =>
  richSchema.nodes.mention!.create({
    original: {
      data: { type: "mention", attrs: { id: person.id, text: `@${person.name}`, accessLevel: "" } },
      hadContent: false,
    },
  });
/** Jira's smart link (an issue reference is one to the issue's /browse/ URL). */
export const inlineCardNode = (url: string) =>
  richSchema.nodes.inlineCard!.create({
    original: { data: { type: "inlineCard", attrs: { url } }, hadContent: false },
  });
/** Jira's emoji node: its short name, the code points as its id, and the character Jira shows. */
export const emojiNode = (emoji: { name: string; char: string }) =>
  richSchema.nodes.emoji!.create({
    original: {
      data: {
        type: "emoji",
        attrs: {
          shortName: `:${emoji.name}:`,
          id: [...emoji.char].map((c) => c.codePointAt(0)!.toString(16)).filter((c) => c !== "fe0f").join("-"),
          text: emoji.char,
        },
      },
      hadContent: false,
    },
  });
export function fromEditorDocument(node: EditorNode): AdfDocument {
  const out = fromEditorNode(node) as AdfDocument;
  out.version = 1;
  if (
    node.childCount === 1 &&
    node.firstChild?.type.name === "paragraph" &&
    !node.firstChild.content.size &&
    !node.firstChild.attrs.original
  )
    out.content = [];
  return out;
}
