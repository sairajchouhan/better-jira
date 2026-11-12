import { expect, test } from "bun:test";
import { EditorState, TextSelection, type Plugin } from "prosemirror-state";
import { markdownRules } from "./editor-commands";
import { inlineRules } from "./editor-inline-rules";
import type { AdfDocument } from "./document";
import { fromEditorDocument, toEditorDocument } from "./rich-document";

/** Types `text` a key at a time through the editor's input rules, into `doc` (an empty paragraph by default). */
function type(text: string, doc: AdfDocument = { type: "doc", version: 1, content: [{ type: "paragraph" }] }) {
  const start = toEditorDocument(doc);
  const view: any = {
    state: EditorState.create({ doc: start, selection: TextSelection.atEnd(start), plugins: [markdownRules, inlineRules] }),
    composing: false,
    dispatch(tr: any) {
      view.state = view.state.apply(tr);
    },
  };
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = (view.state.plugins as Plugin[]).some((p) =>
      p.props.handleTextInput?.call(p, view, from, to, char, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
  return fromEditorDocument(view.state.doc).content!;
}
const line = (text: string) => type(text)[0]!.content;

test("BJ-179: **bold**, __bold__ and ~strike~ format as in Linear; ~~text~~ stays text", () => {
  expect(line("a __bold__ b")).toEqual([
    { type: "text", text: "a " },
    { type: "text", text: "bold", marks: [{ type: "strong" }] },
    { type: "text", text: " b" },
  ]);
  expect(line("(**x y**")).toEqual([
    { type: "text", text: "(" },
    { type: "text", text: "x y", marks: [{ type: "strong" }] },
  ]);
  expect(line("a ~gone~")![1]).toEqual({ type: "text", text: "gone", marks: [{ type: "strike" }] });
  expect(line("a ~~kept~~")).toEqual([{ type: "text", text: "a ~~kept~~" }]);
  expect(line("a** b**")).toEqual([{ type: "text", text: "a** b**" }]);
  const code: AdfDocument = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "x ", marks: [{ type: "code" }] }] }] };
  expect(type("**b** ~c~", code)[0]!.content).toEqual([{ type: "text", text: "x **b** ~c~", marks: [{ type: "code" }] }]);
});

test("BJ-179: [label](url) and www. addresses become links", () => {
  expect(line("see [the docs](https://example.test/a) ok")).toEqual([
    { type: "text", text: "see " },
    { type: "text", text: "the docs", marks: [{ type: "link", attrs: { href: "https://example.test/a" } }] },
    { type: "text", text: " ok" },
  ]);
  expect(line("go www.example.test/x now")).toEqual([
    { type: "text", text: "go " },
    { type: "text", text: "www.example.test/x", marks: [{ type: "link", attrs: { href: "https://www.example.test/x" } }] },
    { type: "text", text: " now" },
  ]);
  expect(line("see https://example.test/x now")![1]).toMatchObject({ marks: [{ attrs: { href: "https://example.test/x" } }] });
});

test("BJ-179: ![alt](url) alone in a paragraph becomes Jira external media and round-trips", () => {
  const doc = type("![A cat](https://example.test/cat.png)");
  expect(doc).toEqual([
    {
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [{ type: "media", attrs: { type: "external", url: "https://example.test/cat.png", alt: "A cat" } }],
    },
    { type: "paragraph" },
  ]);
  const adf: AdfDocument = { type: "doc", version: 1, content: doc };
  expect(fromEditorDocument(toEditorDocument(adf))).toEqual(adf);
  // Mid-paragraph, or an http address, it stays text.
  expect(line("x ![a](https://example.test/a.png)")).toEqual([{ type: "text", text: "x ![a](https://example.test/a.png)" }]);
  expect(type("![a](http://example.test/a.png)")[0]!.type).toBe("paragraph");
});

test("BJ-179: Linear's ligatures, never while typing code", () => {
  expect(line("wait... a -> b -- c != d")).toEqual([{ type: "text", text: "wait… a → b — c ≠ d" }]);
  expect(line("`a -> b != c")).toEqual([{ type: "text", text: "`a -> b != c" }]);
  const block = type("a... ->", { type: "doc", version: 1, content: [{ type: "codeBlock" }] });
  expect(block[0]!.content).toEqual([{ type: "text", text: "a... ->" }]);
});
