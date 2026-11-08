import { expect, test } from "bun:test";
import { Fragment, type Node as EditorNode } from "prosemirror-model";
import { AllSelection, EditorState, TextSelection, type Command } from "prosemirror-state";
import {
  codeDown,
  codeEnter,
  insertLink,
  insertTable,
  markdownRules,
  setBlock,
  shiftTab,
  tab,
  toggleList,
  toggleQuote,
} from "./editor-commands";
import { fromEditorDocument, richSchema as s, type AdfNode } from "./rich-document";

const n = s.nodes;
const p = (text = "") => n.paragraph!.create(null, text ? s.text(text) : null);
const code = (text: string) => n.codeBlock!.create(null, s.text(text));
const cell = (text = "") => n.tableCell!.create(null, p(text));
const table = (...rows: string[][]) =>
  n.table!.create(
    null,
    rows.map((r) => n.tableRow!.create(null, r.map(cell))),
  );
/** A state whose caret sits at the end of the first text that equals `at`. */
function state(blocks: any[], at: string) {
  const doc = n.doc!.create(null, blocks);
  let pos = -1;
  doc.descendants((node, offset) => {
    if (pos < 0 && node.isText && node.text === at) pos = offset + node.nodeSize;
    return pos < 0;
  });
  if (pos < 0) throw new Error(`no text ${at}`);
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}
const run = (command: Command, before: EditorState) => {
  let after = before;
  const handled = command(before, (tr) => (after = before.apply(tr)));
  return { handled, after };
};

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
  expect(linked.marks.map((m) => [m.type.name, m.attrs.href])).toEqual([
    ["link", "https://example.test/"],
  ]);
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
  const view: any = {
    state: before,
    composing: false,
    dispatch(tr: any) {
      view.state = view.state.apply(tr);
    },
  };
  const handle = markdownRules.props.handleTextInput!;
  for (const char of text) {
    const { from, to } = view.state.selection;
    if (!handle.call(markdownRules, view, from, to, char, () => view.state.tr))
      view.dispatch(view.state.tr.insertText(char, from, to));
  }
  return view.state as EditorState;
}
const empty = () => {
  const doc = n.doc!.create(null, [p()]);
  return EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
};

test("I7: Markdown shortcuts and bare URLs format while typing", () => {
  expect(typeInto(empty(), "## Title").doc.firstChild!.type.name).toBe("heading");
  expect(typeInto(empty(), "- item").doc.firstChild!.type.name).toBe("bulletList");
  const bold = typeInto(empty(), "a **bold** b").doc.firstChild!;
  expect(bold.child(1).text).toBe("bold");
  expect(bold.child(1).marks.map((m) => m.type.name)).toEqual(["strong"]);
  const link = typeInto(empty(), "see https://example.test/x now").doc.firstChild!;
  expect(link.child(1).text).toBe("https://example.test/x");
  expect(link.child(1).marks[0]?.attrs.href).toBe("https://example.test/x");
  expect(link.child(2).marks).toEqual([]);
});

// Jira's ADF nesting rules, from Atlassian's published schema (@atlaskit/adf-schema json-schema/v1/full.json), checked on the ADF the app sends.
const INLINE = [
    "text",
    "hardBreak",
    "mention",
    "emoji",
    "status",
    "date",
    "inlineCard",
    "mediaInline",
  ],
  MEDIA = ["mediaSingle", "mediaGroup"];
const CELL = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
  "blockquote",
  "panel",
  "rule",
  "blockCard",
  ...MEDIA,
];
const JIRA: Record<string, string[]> = {
  doc: [
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "taskList",
    "codeBlock",
    "blockquote",
    "panel",
    "rule",
    "table",
    "blockCard",
    ...MEDIA,
  ],
  blockquote: ["paragraph", "bulletList", "orderedList", "codeBlock", ...MEDIA],
  listItem: ["paragraph", "bulletList", "orderedList", "taskList", "codeBlock", "mediaSingle"],
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  taskList: ["taskItem", "taskList"],
  panel: [
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "taskList",
    "codeBlock",
    "rule",
    "blockCard",
    ...MEDIA,
  ],
  table: ["tableRow"],
  tableRow: ["tableCell", "tableHeader"],
  tableCell: CELL,
  tableHeader: CELL,
  paragraph: INLINE,
  heading: INLINE,
  taskItem: INLINE,
  codeBlock: ["text"],
};
function jiraErrors(node: AdfNode): string[] {
  return (node.content ?? []).flatMap((child) => [
    ...(JIRA[node.type]?.includes(child.type) ? [] : [`${node.type} > ${child.type}`]),
    ...(node.type === "codeBlock" && child.marks?.length ? ["codeBlock > marked text"] : []),
    ...jiraErrors(child),
  ]);
}

const h = (text: string, level = 2) => n.heading!.create({ level }, s.text(text));
const bold = (text: string) => n.paragraph!.create(null, s.text(text, [s.marks.strong!.create()]));
const item = (...blocks: EditorNode[]) => n.listItem!.create(null, blocks);
const bullets = (...texts: string[]) =>
  n.bulletList!.create(
    null,
    texts.map((t) => item(p(t))),
  );
const quote = (...blocks: EditorNode[]) => n.blockquote!.create(null, blocks);
/** Every block kind the toolbar makes, alone and nested the ways Jira allows. Each takes a tag so two copies stay distinct. */
const BLOCKS: Record<string, (tag: string) => EditorNode> = {
  paragraph: (t) => p(`p${t}`),
  bold: (t) => bold(`b${t}`),
  heading1: (t) => h(`h${t}`, 1),
  heading3: (t) => h(`h${t}`, 3),
  bullet: (t) => bullets(`u${t}`, `v${t}`),
  numbered: (t) => n.orderedList!.create(null, [item(p(`o${t}`), bullets(`n${t}`))]),
  code: (t) => code(`c${t}`),
  quote: (t) => quote(p(`q${t}`)),
  quotedList: (t) => quote(bullets(`l${t}`), code(`k${t}`)),
  table: (t) =>
    n.table!.create(null, [
      n.tableRow!.create(null, [n.tableCell!.create(null, [p(`t${t}`), quote(p(`r${t}`))])]),
    ]),
  panel: (t) => n.panel!.create(null, [p(`a${t}`), bullets(`d${t}`)]),
  task: (t) => n.taskList!.create(null, [n.taskItem!.create(null, s.text(`x${t}`))]),
};
const COMMANDS: Record<string, Command> = {
  text: setBlock("paragraph"),
  h1: setBlock("heading", { level: 1 }),
  h2: setBlock("heading", { level: 2 }),
  h3: setBlock("heading", { level: 3 }),
  code: setBlock("codeBlock"),
  bullet: toggleList("bulletList"),
  numbered: toggleList("orderedList"),
  quote: toggleQuote,
};
function textRange(doc: EditorNode) {
  let from = -1,
    to = -1;
  doc.descendants((node, pos) => {
    if (node.isText) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
  });
  return TextSelection.create(doc, from, to);
}

test("every block conversion, on any mix of blocks, yields ADF Jira accepts", () => {
  const failures: string[] = [];
  const names = Object.keys(BLOCKS);
  for (const a of names)
    for (const b of names)
      for (const [name, command] of Object.entries(COMMANDS)) {
        const doc = n.doc!.create(
          null,
          a === b ? [BLOCKS[a]!("1")] : [BLOCKS[a]!("1"), BLOCKS[b]!("2")],
        );
        for (const selection of [
          textRange(doc),
          new AllSelection(doc),
          TextSelection.create(doc, textRange(doc).from),
        ]) {
          let state = EditorState.create({ doc, selection });
          // Twice: the second press toggles lists and quotes back off.
          for (let press = 0; press < 2; press++) {
            state = run(command, state).after;
            state.doc.check();
            const errors = jiraErrors(fromEditorDocument(state.doc));
            if (errors.length)
              failures.push(
                `${name} on ${a}+${b} (${selection.constructor.name}, press ${press + 1}): ${errors.join(", ")}`,
              );
          }
        }
      }
  expect(failures).toEqual([]);
});

test("QA pass 3 #3: quoted text becomes a heading outside the quote, in one undo step", () => {
  const before = EditorState.create({
    doc: n.doc!.create(null, [p("intro"), quote(p("one"), bullets("two"), p("three"))]),
  });
  const { handled, after } = run(
    setBlock("heading", { level: 1 }),
    before.apply(before.tr.setSelection(textRange(before.doc))),
  );
  expect(handled).toBe(true);
  expect(
    fromEditorDocument(after.doc).content!.map((b) => [
      b.type,
      b.attrs?.level,
      b.content?.[0]?.text,
    ]),
  ).toEqual([
    ["heading", 1, "intro"],
    ["heading", 1, "one"],
    ["heading", 1, "two"],
    ["heading", 1, "three"],
  ]);
  // Part of a quote: only the selected text leaves it.
  const lifted = run(
    setBlock("heading", { level: 2 }),
    state([quote(p("keep"), p("lift"))], "lift"),
  ).after;
  expect(fromEditorDocument(lifted.doc).content!.map((b) => b.type)).toEqual([
    "blockquote",
    "heading",
  ]);
  // A code block may stay in its quote, and drops marks Jira forbids there.
  const coded = run(setBlock("codeBlock"), state([quote(bold("x"))], "x")).after;
  expect(fromEditorDocument(coded.doc)).toMatchObject({
    content: [{ type: "blockquote", content: [{ type: "codeBlock", content: [{ text: "x" }] }] }],
  });
  expect(coded.doc.firstChild!.firstChild!.firstChild!.marks).toEqual([]);
});

test("quote toggles instead of nesting, wraps whole lists, and turns headings into text", () => {
  expect(run(toggleQuote, state([quote(p("in"))], "in")).after.doc.firstChild!.type.name).toBe(
    "paragraph",
  );
  const list = run(toggleQuote, state([bullets("a", "b")], "a")).after.doc.firstChild!;
  expect([list.type.name, list.firstChild!.type.name, list.firstChild!.childCount]).toEqual([
    "blockquote",
    "bulletList",
    2,
  ]);
  const heading = run(toggleQuote, state([h("title")], "title")).after.doc.firstChild!;
  expect([heading.type.name, heading.firstChild!.type.name]).toEqual(["blockquote", "paragraph"]);
  expect(
    run(toggleList("bulletList"), state([h("title")], "title")).after.doc.firstChild!.firstChild!
      .firstChild!.type.name,
  ).toBe("paragraph");
});

test("the editor schema allows no block nesting Jira forbids, so typing and paste cannot build it", () => {
  const blocks = Object.values(n).filter(
    (type) => type.isInGroup("block") && !type.name.startsWith("opaque"),
  );
  const allowed: string[] = [];
  for (const parent of ["doc", "blockquote", "listItem", "panel", "tableCell", "tableHeader"])
    for (const child of blocks) {
      const node = child.createAndFill();
      if (
        node &&
        n[parent]!.validContent(Fragment.from(parent === "listItem" ? [p(), node] : [node]))
      )
        allowed.push(`${parent} > ${child.name}`);
    }
  expect(
    allowed.filter((pair) => {
      const [parent, child] = pair.split(" > ");
      return !JIRA[parent!]!.includes(child!);
    }),
  ).toEqual([]);
  const typed = typeInto(empty(), "> # quoted").doc.firstChild!;
  expect([typed.type.name, typed.firstChild!.type.name, typed.textContent]).toEqual([
    "blockquote",
    "paragraph",
    "# quoted",
  ]);
  expect(typeInto(empty(), "- > item").doc.firstChild!.firstChild!.firstChild!.type.name).toBe(
    "paragraph",
  );
});
