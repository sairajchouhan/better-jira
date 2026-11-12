/* Paste, as Linear's editor does it (startup-root `pasteHandler`, `pastedContent`, `tsvTablePaste`, `externalImagePaste`,
 * `largeClipboardTextUpload`, `contentLengthValidator`; EditorComponent `linkPaste`). One plugin owns every paste rule. */
import { Marked } from "marked";
import {
  DOMParser,
  Fragment,
  Slice,
  type Node as EditorNode,
  type TagParseRule,
  type StyleParseRule,
} from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { embedLabel, isEmbeddable } from "./embed";
import {
  embedCardNode,
  fromEditorDocument,
  inlineCardNode,
  richSchema,
  safeLink,
} from "./rich-document";
import { showNotification } from "./app-notifications";

const nodes = richSchema.nodes,
  marks = richSchema.marks;

// ── Pure rules ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Linear's `sje.parseTable`: tab-separated rows (quoted cells may hold tabs, newlines and ""), at least 2×2, every row
 * as wide as the first and at least two columns with text. Null when the text isn't such a table. */
export function tsvRows(input: string): string[][] | null {
  if (!input.includes("\t") || !/[\n\r]/.test(input)) return null;
  const text = input.replace(/\r\n?/g, "\n"),
    rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
      continue;
    }
    if (closed && c !== "\t" && c !== "\n") return null;
    if (c === '"' && !cell) quoted = true;
    else if (c === "\t") endCell();
    else if (c === "\n") endRow();
    else cell += c;
  }
  if (quoted) return null;
  if (cell || row.length) endRow();
  const width = rows[0]?.length ?? 0,
    used = new Set<number>();
  if (rows.length < 2 || width < 2 || rows.some((r) => r.length !== width)) return null;
  for (const r of rows) r.forEach((value, i) => value && used.add(i));
  return used.size >= 2 ? rows : null;
}

/** Linear's `RXe`: the first row is the header; a cell's lines are its paragraphs. */
export function tsvTable(rows: string[][]): EditorNode {
  return nodes.table!.create(
    null,
    rows.map((cells, r) =>
      nodes.tableRow!.create(
        null,
        cells.map((text) =>
          (r ? nodes.tableCell! : nodes.tableHeader!).create(
            null,
            text.split("\n").map((line) => nodes.paragraph!.create(null, line ? richSchema.text(line) : null)),
          ),
        ),
      ),
    ),
  );
}

/** Linear's `largeClipboardTextUpload` defaults: more than 100 lines or more than 4096 bytes becomes a file. */
export const isLargeText = (text: string) =>
  !!text.trim() && (text.replace(/\r\n?/g, "\n").split("\n").length > 100 || new Blob([text]).size > 4096);

/** Linear's `removeExtraIndentation`: the indentation every line shares (an empty line shares none) is dropped. */
export function dedent(text: string) {
  const lines = text.split("\n"),
    indent = Math.min(...lines.map((line) => /^\s+/.exec(line)?.[0].length ?? 0));
  return indent > 0 && indent !== Infinity ? lines.map((line) => line.slice(indent)).join("\n") : text;
}

/** VS Code's `vscode-editor-data` clipboard entry names the copied file's language. */
export function vscodeMode(data: string | undefined): string | null {
  try {
    const mode = JSON.parse(data || "null")?.mode;
    return typeof mode === "string" && mode ? mode : null;
  } catch {
    return null;
  }
}
const isMarkdownMode = (mode: string | null) => mode === "markdown" || mode === "md";
/** A pasted-text file's extension by VS Code language. ponytail: Linear also predicts the language of plain text; add when that matters. */
const EXTENSIONS: Record<string, string> = {
  javascript: "js",
  javascriptreact: "jsx",
  typescript: "ts",
  typescriptreact: "tsx",
  python: "py",
  json: "json",
  markdown: "md",
  html: "html",
  css: "css",
  shellscript: "sh",
  go: "go",
  rust: "rs",
  java: "java",
  ruby: "rb",
  yaml: "yml",
  sql: "sql",
};

/** The issue a pasted URL opens: a /browse/ page on this Jira site, or this app's own issue link. */
export function issueKeyOf(url: string, site: string, origin: string): string | null {
  try {
    const u = new URL(url),
      key =
        (site && u.origin === new URL(site).origin && /^\/browse\/([^/]+)\/?$/.exec(u.pathname)?.[1]) ||
        (u.origin === origin ? u.searchParams.get("issue") : null);
    return key && /^[A-Z][A-Z\d_]*-\d+$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** Linear's Google Docs clean-up (`normalizePastedContent`): no doubled or trailing line breaks, no trailing empty paragraphs. */
export function normalizeGoogleDocs(content: Fragment): Fragment {
  const walk = (fragment: Fragment): Fragment => {
    const out: EditorNode[] = [];
    fragment.forEach((node) => {
      if (node.type.spec.code || node.isLeaf) return void out.push(node);
      if (!node.isTextblock) return void out.push(node.copy(walk(node.content)));
      const inline: EditorNode[] = [];
      node.forEach((child) => {
        if (child.type === nodes.hardBreak && inline.at(-1)?.type === nodes.hardBreak) return;
        inline.push(child);
      });
      while (inline.at(-1)?.type === nodes.hardBreak) inline.pop();
      out.push(node.copy(Fragment.fromArray(inline)));
    });
    return Fragment.fromArray(out);
  };
  const out: EditorNode[] = [];
  walk(content).forEach((node) => void out.push(node));
  while (out.length && out.at(-1)!.type === nodes.paragraph && !out.at(-1)!.content.size) out.pop();
  return Fragment.fromArray(out);
}

/** Jira rejects a text field over 32,767 characters, counted on the stored ADF. */
export const JIRA_LIMIT = 32_767;
const lengths = new WeakMap<EditorNode, number>();
export function adfLength(doc: EditorNode) {
  let length = lengths.get(doc);
  if (length === undefined) lengths.set(doc, (length = JSON.stringify(fromEditorDocument(doc)).length));
  return length;
}
/** Linear's `contentLengthValidator`: a change is refused past the limit, unless the content was already over it and shrinks. */
export function withinLimit(before: EditorNode, after: EditorNode, limit = JIRA_LIMIT) {
  const next = adfLength(after);
  return next <= limit || (adfLength(before) > limit && next <= adfLength(before));
}

/** Which paste shortcut was pressed (Linear's `pasteAndMatchStyle` / `pasteWithoutFormatting` keys): Chrome and Brave
 * match style on ⌘⇧V and drop formatting on ⌘⌥⇧V; other browsers the other way round. */
export function pasteShortcut(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "code">,
  chrome: boolean,
): "match" | "plain" | null {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== "KeyV") return null;
  return event.altKey === chrome ? "plain" : "match";
}

// ── Parsing ────────────────────────────────────────────────────────────────────────────────────────────────────────

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Linear parses pasted plain text as Markdown (markdown-it, `html: false`, `linkify: true`, a line break is a hard break). */
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escape(text),
    code: ({ text, lang }) =>
      `<pre data-language="${escape(lang?.split(/\s/)[0] ?? "")}"><code>${escape(text)}</code></pre>`,
  },
});
export const markdownHTML = (text: string) => markdown.parse(text, { async: false });

const style = (dom: HTMLElement) => dom.style;
/** Linear's paste rules (startup-entry marks) ahead of the schema's: Google Docs' `<b style="font-weight:normal">`
 * wrapper isn't bold, any weight from 500 is, Notion's inline code and underline, a fenced block's language, GitHub and
 * Markdown task lists, an embed copied from an editor. Unsafe link targets keep their text unlinked. */
const PASTE_RULES: (TagParseRule | StyleParseRule)[] = [
  { tag: "a[href]", mark: "link", getAttrs: (dom) => ((href) => (href ? { href } : false))(safeLink(dom.getAttribute("href"))) },
  { tag: "a[href]", skip: true },
  { tag: "div.notion-inline-code-container", mark: "code" },
  { tag: "b", mark: "strong", getAttrs: (dom) => style(dom).fontWeight !== "normal" && null },
  { style: "font-weight", mark: "strong", getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null },
  { tag: "i", mark: "em" },
  { style: "font-style=italic", mark: "em" },
  { tag: "del", mark: "strike" },
  { tag: "strike", mark: "strike" },
  { style: "text-decoration", mark: "strike", getAttrs: (value) => value === "line-through" && null },
  { style: "text-decoration", mark: "underline", getAttrs: (value) => value === "underline" && null },
  {
    tag: "span.notion-enable-hover",
    mark: "underline",
    consuming: false,
    getAttrs: (dom) => (style(dom).getPropertyValue("text-decoration-line").split(" ").includes("underline") ? null : false),
  },
  {
    tag: "pre",
    node: "codeBlock",
    preserveWhitespace: "full",
    getAttrs: (dom) => ({
      language:
        dom.getAttribute("data-language") ||
        /(?:^|\s)lang(?:uage)?-(\S+)/.exec(dom.querySelector("code")?.className ?? "")?.[1] ||
        null,
    }),
  },
  { tag: "ul", node: "taskList", getAttrs: (dom) => (dom.querySelector(":scope > li > input[type=checkbox]") ? null : false) },
  {
    tag: "li",
    node: "taskItem",
    context: "taskList/",
    getAttrs: (dom) => ({ state: dom.querySelector(":scope > input[type=checkbox]")?.hasAttribute("checked") ? "DONE" : "TODO" }),
  },
  {
    tag: "div.rich-embed[data-url]",
    node: "embedCard",
    getAttrs: (dom) => ({ original: embedCardNode(dom.getAttribute("data-url")!).attrs.original }),
  },
];
let pasteParser: DOMParser | undefined;
/** The parser for pasted and dropped HTML: Linear's rules, then the schema's. */
export const clipboardParser = () =>
  (pasteParser ??= new DOMParser(richSchema, [...PASTE_RULES, ...DOMParser.fromSchema(richSchema).rules]));

// ── The plugin ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The paste-link menu after a pasted embeddable URL: the linked text it would turn into an embed. */
export type LinkPaste = { from: number; to: number; href: string };
const linkPasteKey = new PluginKey<LinkPaste | null>("link-paste");
export const activeLinkPaste = (state: EditorState) => linkPasteKey.getState(state) ?? null;
/** "Keep as link" (Esc): the menu closes and the link stays. */
export const dismissLinkPaste = (state: EditorState) => state.tr.setMeta(linkPasteKey, null);
/** The "Embed …" item (Tab): the pasted link becomes Jira's embedCard, the caret on the line after it. */
export const embedLink =
  (menu: LinkPaste): Command =>
  (state, dispatch) => {
    const tr = state.tr.replaceRangeWith(menu.from, menu.to, embedCardNode(menu.href)).setMeta(linkPasteKey, null);
    const after = tr.mapping.map(menu.to);
    if (after >= tr.doc.content.size) tr.insert(tr.doc.content.size, nodes.paragraph!.create());
    dispatch?.(tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1))).scrollIntoView());
    return true;
  };
/** Linear's paste-link menu: its embed title first, or after "Keep as link" when it is the default "Show embed". */
export function linkPasteActions(menu: LinkPaste, view: EditorView) {
  const keep = {
      id: "keep",
      label: "Keep as link",
      shortcut: "Escape",
      pick: () => view.dispatch(dismissLinkPaste(view.state)),
    },
    label = embedLabel(menu.href),
    embed = {
      id: "embed",
      label,
      shortcut: "Tab",
      pick: () => {
        embedLink(menu)(view.state, view.dispatch);
        view.focus();
      },
    };
  return label === "Show embed" ? [keep, embed] : [embed, keep];
}

const inCode = (state: EditorState) =>
  !!state.selection.$from.parent.type.spec.code || marks.code!.isInSet(state.storedMarks ?? state.selection.$from.marks());
const pasted = (view: EditorView, tr = view.state.tr) =>
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
const GOOGLE_DOCS = [
  "application/x-vnd.google-docs-document-slice-clip+wrapped",
  "application/x-vnd.google-docs-internal-clip-id",
];

/** An image the pasted HTML showed, as a file: data URLs directly, web images through the server (most hosts send no CORS headers). */
async function imageFile(src: string): Promise<File | null> {
  try {
    const response = await fetch(src.startsWith("data:") ? src : `/api/remote-image?${new URLSearchParams({ url: src })}`);
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const name = src.startsWith("data:") ? "" : decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "");
    return new File([await response.blob()], name || `image.${type.slice(6).split(/[+;]/)[0]}`, { type });
  } catch {
    return null;
  }
}

/**
 * Every paste rule but files (the editor's own handlePaste uploads those) and a URL over selected text (pasteLink):
 * - a lone URL: an issue on this site becomes its reference; any other is linked, and an embeddable one opens the paste-link menu;
 * - large text becomes a file; VS Code code becomes a code block (a line: inline code) in its language;
 * - tab-separated rows become a table; other plain text is parsed as Markdown;
 * - pasted HTML's web images are uploaded again.
 * ⌘⌥⇧V (Chrome) pastes the text as it is; ⌘⇧V matches style, so the text still goes through these rules.
 */
export function pastePlugin(options: {
  /** Forwards keys to the open caret menu, as the other menus do. */
  keys: (view: EditorView, event: KeyboardEvent) => boolean;
  /** Places files at a position, or null where this editor takes no files. */
  upload: () => ((files: File[], at?: number) => void) | null;
  /** This Jira site, for issue links. */
  site: () => string;
}) {
  let shortcut: ReturnType<typeof pasteShortcut> = null,
    googleDocs = false,
    converting = false;
  const chrome = typeof navigator !== "undefined" && /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
  const pasteMarkdown = (view: EditorView, text: string) => {
    converting = true;
    try {
      view.pasteHTML(markdownHTML(text));
    } finally {
      converting = false;
    }
  };
  const pasteURL = (view: EditorView, text: string, href: string) => {
    const key = issueKeyOf(href, options.site(), location.origin);
    if (key) return pasted(view, view.state.tr.replaceSelectionWith(inlineCardNode(`${options.site()}/browse/${key}`), false));
    const tr = view.state.tr.replaceSelectionWith(richSchema.text(text, [marks.link!.create({ href })]), false),
      to = tr.selection.from,
      $to = tr.doc.resolve(to);
    // Linear's menu shows for any URL but Slack's; only the preferred hosts are ones this app can frame. Jira holds an embed at the top level only.
    if (isEmbeddable(href) && $to.depth === 1 && $to.parent.type === nodes.paragraph)
      tr.setMeta(linkPasteKey, { from: to - text.length, to, href });
    pasted(view, tr);
  };
  return new Plugin<LinkPaste | null>({
    key: linkPasteKey,
    state: {
      init: () => null,
      apply(tr, menu) {
        const meta = tr.getMeta(linkPasteKey);
        if (meta !== undefined) return meta;
        if (!menu || tr.getMeta("appendedTransaction")) return menu && { ...menu, from: tr.mapping.map(menu.from), to: tr.mapping.map(menu.to) };
        return tr.docChanged || tr.selectionSet ? null : menu;
      },
    },
    filterTransaction(tr, state) {
      if (!tr.docChanged || withinLimit(state.doc, tr.doc)) return true;
      showNotification({ text: `Jira can't store more than ${JIRA_LIMIT.toLocaleString("en-US")} characters here` });
      return false;
    },
    props: {
      clipboardParser: clipboardParser(),
      handleKeyDown(view, event) {
        shortcut = pasteShortcut(event, chrome);
        return !!activeLinkPaste(view.state) && options.keys(view, event);
      },
      handleDOMEvents: {
        paste(_view, event) {
          const types = [...(event.clipboardData?.types ?? [])];
          googleDocs = types.some((type) => GOOGLE_DOCS.includes(type));
          return false;
        },
      },
      transformPasted(slice) {
        if (!googleDocs) return slice;
        googleDocs = false;
        return new Slice(normalizeGoogleDocs(slice.content), slice.openStart, slice.openEnd);
      },
      handlePaste(view, event, slice) {
        const data = event.clipboardData,
          mode = shortcut;
        shortcut = null;
        if (converting || !data || mode === "plain" || data.files.length || inCode(view.state)) return false;
        const text = data.getData("text/plain"),
          html = mode === "match" ? "" : data.getData("text/html"),
          upload = options.upload(),
          code = vscodeMode(data.getData("vscode-editor-data"));
        if (upload && isLargeText(text)) {
          if (!view.state.selection.empty) view.dispatch(view.state.tr.deleteSelection());
          upload([new File([text], `pasted.${EXTENSIONS[code ?? ""] ?? "txt"}`, { type: "text/plain" })], view.state.selection.anchor);
          return true;
        }
        if (code && text) {
          if (isMarkdownMode(code)) pasteMarkdown(view, text);
          else if (!text.includes("\n"))
            pasted(view, view.state.tr.replaceSelectionWith(richSchema.text(text, [marks.code!.create()]), false).removeStoredMark(marks.code!));
          else {
            const block = nodes.codeBlock!.create({ language: code }, richSchema.text(dedent(text.replace(/\n+$/, ""))));
            pasted(view, view.state.tr.replaceSelection(new Slice(Fragment.from(block), 0, 0)));
          }
          return true;
        }
        const trimmed = text.trim(),
          href = /^https?:\/\/\S+$/i.test(trimmed) ? safeLink(trimmed) : null;
        if (href) {
          pasteURL(view, trimmed, href);
          return true;
        }
        const rows = !/<(td|th|pre|code)\b/i.test(html) ? tsvRows(text) : null;
        if (rows) {
          pasted(view, view.state.tr.replaceSelection(new Slice(Fragment.from(tsvTable(rows)), 0, 0)));
          return true;
        }
        if (!html && text) {
          pasteMarkdown(view, text);
          return true;
        }
        const images = upload && html ? [...new window.DOMParser().parseFromString(html, "text/html").images] : [];
        const sources = images.map((img) => img.getAttribute("src") ?? "").filter((src) => /^(https?:|data:image\/)/i.test(src));
        if (!sources.length) return false;
        // ponytail: the images land after the pasted content, not where each one stood; place them inline if that matters.
        pasted(view, view.state.tr.replaceSelection(slice));
        const doc = view.state.doc,
          at = view.state.selection.to;
        void Promise.all(sources.map(imageFile)).then((files) => {
          const found = files.filter((file): file is File => !!file);
          if (found.length && !view.isDestroyed) upload!(found, view.state.doc === doc ? at : view.state.selection.from);
        });
        return true;
      },
    },
  });
}
