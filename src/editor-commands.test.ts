import { expect, test } from "bun:test";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { codeDown, codeEnter, insertLink, insertTable, markdownRules, shiftTab, tab } from "./editor-commands";
import { richSchema as s } from "./rich-document";

const n = s.nodes;
const p = (text = "") => n.paragraph!.create(null, text ? s.text(text) : null);
const code = (text: string) => n.codeBlock!.create(null, s.text(text));
const cell = (text = "") => n.tableCell!.create(null, p(text));
const table = (...rows: string[][]) => n.table!.create(null, rows.map(r => n.tableRow!.create(null, r.map(cell))));
/** A state whose caret sits at the end of the first text that equals `at`. */
function state(blocks: any[], at: string) {
  const doc = n.doc!.create(null, blocks);
  let pos = -1;
  doc.descendants((node, offset) => { if (pos < 0 && node.isText && node.text === at) pos = offset + node.nodeSize; return pos < 0; });
  if (pos < 0) throw new Error(`no text ${at}`);
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}
const run = (command: Command, before: EditorState) => { let after = before; const handled = command(before, tr => (after = before.apply(tr))); return { handled, after }; };

test("I2: Tab never leaves the editor; in a code block it indents", () => {
  const { handled, after } = run(tab, state([code("const a = 1;")], "const a = 1;"));
  expect(handled).toBe(true);
  expect(after.doc.firstChild!.textContent).toBe("const a = 1;  ");
  expect(run(tab, state([p("plain")], "plain")).handled).toBe(true);
  expect(run(shiftTab, state([p("plain")], "plain")).handled).toBe(true);
});

test("I3: ArrowDown at the end of a trailing code block, or a third Enter, leaves the block", () => {
  const down = run(codeDown, state([code("x = 1")], "x = 1"));
  expect(down.handled).toBe(true);
  expect(down.after.doc.childCount).toBe(2);
  expect(down.after.selection.$head.parent.type.name).toBe("paragraph");
  expect(run(codeDown, state([code("x = 1"), p("after")], "x = 1")).handled).toBe(false);
  const enter = run(codeEnter, state([code("x = 1\n\n")], "x = 1\n\n"));
  expect(enter.handled).toBe(true);
  expect(enter.after.doc.firstChild!.textContent).toBe("x = 1");
  expect(enter.after.selection.$head.parent.type.name).toBe("paragraph");
  expect(run(codeEnter, state([code("x = 1\n")], "x = 1\n")).handled).toBe(false);
});

test("I4: inserting a link without a selection keeps the link mark", () => {
  const { after } = run(insertLink("https://example.test/"), state([p("see ")], "see "));
  const linked = after.doc.firstChild!.lastChild!;
  expect(linked.text).toBe("https://example.test/");
  expect(linked.marks.map(m => [m.type.name, m.attrs.href])).toEqual([["link", "https://example.test/"]]);
});

test("I5: a new table puts the caret in its first cell, and Tab in the last cell adds a row", () => {
  const inserted = run(insertTable, state([p("intro")], "intro")).after;
  const $head = inserted.selection.$head;
  expect($head.node($head.depth - 1).type.name).toBe("tableCell");
  expect($head.index($head.depth - 2)).toBe(0);
  expect($head.index($head.depth - 3)).toBe(0);
  const grown = run(tab, state([table(["a", "b"], ["c", "d"])], "d"));
  expect(grown.handled).toBe(true);
  expect(grown.after.doc.firstChild!.childCount).toBe(3);
  const $cell = grown.after.selection.$head;
  expect($cell.index($cell.depth - 3)).toBe(2);
  expect($cell.index($cell.depth - 2)).toBe(0);
});

/** Types text through the input-rules plugin the way a keyboard does, one character at a time. */
function typeInto(before: EditorState, text: string) {
  const view: any = { state: before, composing: false, dispatch(tr: any) { view.state = view.state.apply(tr); } };
  const handle = markdownRules.props.handleTextInput!;
  for (const char of text) {
    const { from, to } = view.state.selection;
    if (!handle.call(markdownRules, view, from, to, char, () => view.state.tr)) view.dispatch(view.state.tr.insertText(char, from, to));
  }
  return view.state as EditorState;
}
const empty = () => { const doc = n.doc!.create(null, [p()]); return EditorState.create({ doc, selection: TextSelection.create(doc, 1) }); };

test("I7: Markdown shortcuts and bare URLs format while typing", () => {
  expect(typeInto(empty(), "## Title").doc.firstChild!.type.name).toBe("heading");
  expect(typeInto(empty(), "- item").doc.firstChild!.type.name).toBe("bulletList");
  const bold = typeInto(empty(), "a **bold** b").doc.firstChild!;
  expect(bold.child(1).text).toBe("bold");
  expect(bold.child(1).marks.map(m => m.type.name)).toEqual(["strong"]);
  const link = typeInto(empty(), "see https://example.test/x now").doc.firstChild!;
  expect(link.child(1).text).toBe("https://example.test/x");
  expect(link.child(1).marks[0]?.attrs.href).toBe("https://example.test/x");
  expect(link.child(2).marks).toEqual([]);
});
