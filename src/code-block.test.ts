import { expect, test } from "bun:test";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import {
  backspaceIndent,
  codeBlockKeys,
  codeToText,
  indentCode,
  outdentCode,
  selectCode,
  toggleLineComment,
} from "./code-block-editing";
import { highlight } from "./code-highlight";
import { codeLanguage, languageLabel, lineStarts } from "./code-languages";
import { fromEditorDocument, richSchema as s, toEditorDocument } from "./rich-document";

const n = s.nodes;
const code = (text: string, language: string | null = null) =>
  n.codeBlock!.create({ language }, text ? s.text(text) : null);
/** A state over `blocks` with the selection at offsets `from`–`to` inside the first code block. */
function state(blocks: any[], from: number, to = from) {
  const doc = n.doc!.create(null, blocks);
  let start = -1;
  doc.descendants((node, pos) => {
    if (start < 0 && node.type === n.codeBlock) start = pos + 1;
    return start < 0;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, start + from, start + to) });
}
const run = (command: Command, before: EditorState) => {
  let after = before;
  const handled = command(before, (tr) => (after = before.apply(tr)));
  return { handled, after, text: after.doc.firstChild!.textContent };
};

test("BJ-178: ⌘A selects the code block's text, then leaves the second ⌘A to the document", () => {
  const { handled, after } = run(selectCode, state([code("a\nb")], 1));
  expect(handled).toBe(true);
  expect(after.doc.textBetween(after.selection.from, after.selection.to, "\n")).toBe("a\nb");
  expect(run(selectCode, after).handled).toBe(false);
});

test("BJ-178: Tab and ⇧Tab indent and outdent every selected line by two spaces", () => {
  const indented = run(indentCode, state([code("a\nb\nc")], 0, 3));
  expect(indented.text).toBe("  a\n  b\nc");
  expect(run(outdentCode, indented.after).text).toBe("a\nb\nc");
  expect(run(indentCode, state([code("ab")], 1)).text).toBe("a  b");
});

test("BJ-178: ⌫ at the start of an empty block makes a paragraph; a full block keeps its lines as hard breaks", () => {
  const empty = run(codeToText, state([code("")], 0));
  expect(empty.after.doc.firstChild!.type).toBe(n.paragraph!);
  const full = run(codeToText, state([code("a\nb")], 0)).after.doc.firstChild!;
  expect(full.type).toBe(n.paragraph!);
  expect(full.childCount).toBe(3);
  expect(full.child(1).type).toBe(n.hardBreak!);
  expect(run(codeToText, state([code("ab")], 1)).handled).toBe(false);
});

test("BJ-178: ⌫ after leading spaces deletes back to the previous two-space stop", () => {
  expect(run(backspaceIndent, state([code("a\n    b")], 6)).text).toBe("a\n  b");
  expect(run(backspaceIndent, state([code("a\n   b")], 5)).text).toBe("a\n  b");
  expect(run(backspaceIndent, state([code("ab")], 1)).handled).toBe(false);
});

test("BJ-178: ⌘/ toggles a line comment in the block's language at the lines' common indent", () => {
  const on = run(toggleLineComment, state([code("  a\n    b", "python")], 0, 9));
  expect(on.text).toBe("  # a\n  #   b");
  expect(run(toggleLineComment, on.after).text).toBe("  a\n    b");
  const html = run(toggleLineComment, state([code("<p>", "html")], 1));
  expect(html.text).toBe("<!-- <p> -->");
  expect(run(toggleLineComment, html.after).text).toBe("<p>");
  expect(run(toggleLineComment, state([code("{}", "json")], 1)).handled).toBe(false);
});

test("BJ-178: ⌥Tab in a code block inside a list item nests the item", () => {
  const item = (...content: any[]) => n.listItem!.create(null, content);
  const list = n.bulletList!.create(null, [
    item(n.paragraph!.create(null, s.text("one"))),
    item(code("two")),
  ]);
  const before = state([list], 1);
  const { handled, after } = run(codeBlockKeys["Alt-Tab"]!, before);
  expect(handled).toBe(true);
  expect(after.doc.firstChild!.childCount).toBe(1);
  expect(codeBlockKeys["Mod-a"]).toBe(selectCode);
  expect(codeBlockKeys["Mod-/"]).toBe(toggleLineComment);
});

test("BJ-178: stored languages resolve by id or alias; the label falls back to Plaintext", () => {
  expect(codeLanguage("go")?.id).toBe("golang");
  expect(codeLanguage("CSS")?.id).toBe("scss");
  expect(languageLabel("ts", null)).toBe("TypeScript");
  expect(languageLabel("brainfuck", null)).toBe("Plaintext");
  expect(languageLabel(null, undefined)).toBe("Detecting…");
  expect(languageLabel(null, "python")).toBe("Python");
  expect(lineStarts("a\nbc\n")).toEqual([0, 2, 5]);
});

test("BJ-178: the codeBlock language round-trips through ADF and Auto detect drops it", () => {
  const adf = {
    type: "doc",
    version: 1,
    content: [{ type: "codeBlock", attrs: { language: "go" }, content: [{ type: "text", text: "x := 1" }] }],
  };
  expect(fromEditorDocument(toEditorDocument(adf))).toEqual(adf as any);
  const editor = EditorState.create({ doc: toEditorDocument(adf) });
  const auto = editor.apply(editor.tr.setNodeMarkup(0, undefined, { ...editor.doc.firstChild!.attrs, language: null }));
  expect(fromEditorDocument(auto.doc).content?.[0]).toEqual({
    type: "codeBlock",
    content: [{ type: "text", text: "x := 1" }],
  });
});

test("BJ-178: highlighting maps hljs scopes to Linear's syntax classes once the grammar loads", async () => {
  const text = 'def f(x):\n  return "s" + 1';
  await new Promise<void>((loaded) => {
    if (highlight(text, "py", true, loaded)) loaded();
  });
  const result = highlight(text, "py", true, () => {})!;
  expect(result.language).toBe("python");
  const classOf = (part: string) => result.tokens.find((t) => text.slice(t.from, t.to) === part)?.className;
  expect(classOf("def")).toBe("syntax-keyword");
  expect(classOf("f")).toBe("syntax-entity-name-function");
  expect(classOf('"s"')).toBe("syntax-string");
  expect(classOf("1")).toBe("syntax-constant-numeric");
  expect(highlight(text, "cypher", true, () => {})).toEqual({ tokens: [], language: "cypher" });
});
