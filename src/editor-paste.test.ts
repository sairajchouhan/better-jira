import { expect, test } from "bun:test";
import { Fragment } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  dedent,
  embedLink,
  isLargeText,
  issueKeyOf,
  JIRA_LIMIT,
  markdownHTML,
  normalizeGoogleDocs,
  pasteShortcut,
  tsvRows,
  tsvTable,
  vscodeMode,
  withinLimit,
} from "./editor-paste";
import { embedLabel, embedSource, isEmbeddable } from "./embed";
import { fromEditorDocument, richSchema as s, toEditorDocument } from "./rich-document";

const n = s.nodes;
const p = (...content: Parameters<typeof Fragment.from>[0][]) => n.paragraph!.create(null, content.flatMap((c) => (c ? [c as any] : [])));

test("BJ-177 row 78: tab-separated rows become a table, its first row the header; anything else is no table", () => {
  expect(tsvRows("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
  expect(tsvRows('"x\ty"\t"say ""hi"""\r\n1\t"two\nlines"')).toEqual([["x\ty", 'say "hi"'], ["1", "two\nlines"]]);
  expect(tsvRows("a\tb")).toBeNull(); // one row
  expect(tsvRows("a\tb\n1")).toBeNull(); // ragged
  expect(tsvRows("a\t\n1\t")).toBeNull(); // one column with text
  expect(tsvRows('"a"x\tb\n1\t2')).toBeNull(); // text after a closing quote
  const doc = fromEditorDocument(n.doc!.create(null, tsvTable([["a", "b"], ["1", "two\nlines"]])));
  const [header, row] = doc.content![0]!.content!;
  expect(header!.content!.map((c) => c.type)).toEqual(["tableHeader", "tableHeader"]);
  expect(row!.content![1]!.content!.map((c) => c.content?.[0]?.text)).toEqual(["two", "lines"]);
});

test("BJ-177 row 80: more than 100 lines or 4096 bytes is a large paste", () => {
  expect(isLargeText(Array(100).fill("x").join("\n"))).toBe(false);
  expect(isLargeText(Array(101).fill("x").join("\n"))).toBe(true);
  expect(isLargeText("x".repeat(4096))).toBe(false);
  expect(isLargeText("é".repeat(2049))).toBe(true);
  expect(isLargeText(" \n".repeat(200))).toBe(false);
});

test("BJ-177 row 76: VS Code's language and shared indentation; Markdown keeps fences' languages", () => {
  expect(vscodeMode('{"version":1,"mode":"python"}')).toBe("python");
  expect(vscodeMode("nope")).toBeNull();
  expect(dedent("    a\n      b")).toBe("a\n  b");
  expect(dedent("  a\n\n  b")).toBe("  a\n\n  b"); // Linear: an empty line shares no indentation
  expect(markdownHTML("```ts\nconst x = 1\n```")).toContain('<pre data-language="ts"><code>const x = 1</code></pre>');
  expect(markdownHTML("a\nb <b>x</b>")).toBe("<p>a<br>b &lt;b&gt;x&lt;/b&gt;</p>\n");
});

test("BJ-174 row 75: a /browse/ URL on this site or this app's issue link names its issue", () => {
  const site = "https://acme.atlassian.net",
    origin = "http://localhost:3000";
  expect(issueKeyOf(`${site}/browse/KAN-12`, site, origin)).toBe("KAN-12");
  expect(issueKeyOf(`${origin}/?board=1&issue=KAN-3`, site, origin)).toBe("KAN-3");
  expect(issueKeyOf("https://other.atlassian.net/browse/KAN-12", site, origin)).toBeNull();
  expect(issueKeyOf(`${site}/browse/not-a-key`, site, origin)).toBeNull();
});

test("BJ-177 row 77: a Google Docs paste loses doubled and trailing line breaks and trailing empty paragraphs", () => {
  const br = n.hardBreak!.create();
  const out = normalizeGoogleDocs(Fragment.from([p(s.text("a"), br, br, s.text("b"), br), p(), p()]));
  expect(out.childCount).toBe(1);
  expect(out.child(0).content.childCount).toBe(3);
});

test("BJ-177 row 84: a change past Jira's 32,767 characters is refused unless an over-long text shrinks", () => {
  const doc = (text: string) => n.doc!.create(null, p(text ? s.text(text) : null));
  expect(withinLimit(doc("a"), doc("b".repeat(1000)))).toBe(true);
  expect(withinLimit(doc("a"), doc("b".repeat(JIRA_LIMIT)))).toBe(false);
  expect(withinLimit(doc("b".repeat(JIRA_LIMIT + 10)), doc("b".repeat(JIRA_LIMIT + 5)))).toBe(true);
});

test("BJ-177 row 81: ⌘⇧V matches style and ⌘⌥⇧V drops formatting in Chrome; other browsers swap them", () => {
  const key = (altKey: boolean) => ({ metaKey: true, ctrlKey: false, shiftKey: true, altKey, code: "KeyV" });
  expect(pasteShortcut(key(false), true)).toBe("match");
  expect(pasteShortcut(key(true), true)).toBe("plain");
  expect(pasteShortcut(key(false), false)).toBe("plain");
  expect(pasteShortcut(key(true), false)).toBe("match");
  expect(pasteShortcut({ ...key(false), shiftKey: false }, true)).toBeNull();
});

test("BJ-174 rows 17, 56: embeddable hosts, the menu's titles and the frame addresses", () => {
  expect(isEmbeddable("https://www.youtube.com/watch?v=abc")).toBe(true);
  expect(isEmbeddable("https://example.com/video")).toBe(false);
  expect(embedLabel("https://youtu.be/abc")).toBe("Embed video");
  expect(embedLabel("https://www.figma.com/design/x")).toBe("Embed preview");
  expect(embedLabel("https://miro.com/app/board/x=/")).toBe("Embed board");
  expect(embedLabel("https://jam.dev/c/x")).toBe("Show embed");
  expect(embedSource("https://www.youtube.com/watch?v=abc_1")).toBe("https://www.youtube-nocookie.com/embed/abc_1");
  expect(embedSource("https://youtu.be/abc")).toBe("https://www.youtube-nocookie.com/embed/abc");
  expect(embedSource("https://www.loom.com/share/123")).toBe("https://www.loom.com/embed/123");
  expect(embedSource("https://example.com/")).toBeNull();
});

test("BJ-174 row 17: Embed turns the pasted link into Jira's embedCard, which round-trips exactly", () => {
  const url = "https://www.youtube.com/watch?v=abc",
    link = s.marks.link!.create({ href: url }),
    doc = n.doc!.create(null, p(s.text(url, [link])));
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1 + url.length) });
  embedLink({ from: 1, to: 1 + url.length, href: url })(state, (tr) => (state = state.apply(tr)));
  const adf = fromEditorDocument(state.doc);
  expect(adf.content).toEqual([
    { type: "embedCard", attrs: { url, layout: "center" } },
    { type: "paragraph" },
  ]);
  expect(state.selection.$from.parent.type.name).toBe("paragraph");
  const stored = {
    type: "doc",
    version: 1,
    content: [{ type: "embedCard", attrs: { url, layout: "wide", width: 80, originalHeight: 400 } }],
  };
  expect(toEditorDocument(stored).firstChild!.type.name).toBe("embedCard");
  expect(fromEditorDocument(toEditorDocument(stored))).toEqual(stored as any);
});
