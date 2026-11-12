import { expect, test } from "bun:test";
import { Fragment, type Node as EditorNode } from "prosemirror-model";
import { AllSelection, EditorState, TextSelection, type Command } from "prosemirror-state";
import {
  codeDown,
  codeEnter,
  floatingPlacement,
  insertLink,
  linkHref,
  insertTable,
  linkTarget,
  markdownRules,
  duplicateBlock,
  deleteBlock,
  issueFromText,
  referenceSelection,
  toggleExpand,
  moveBlock,
  pasteLink,
  removeLink,
  setBlock,
  shiftTab,
  tab,
  toggleList,
  toggleQuote,
} from "./editor-commands";
import { fromEditorDocument, richSchema as s, toEditorDocument, type AdfNode } from "./rich-document";
import { inlineRules } from "./editor-inline-rules";

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
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = [markdownRules, inlineRules].some((rules) =>
      rules.props.handleTextInput!.call(rules, view, from, to, char, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
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
  expand: [
    "paragraph",
    "panel",
    "blockquote",
    "orderedList",
    "bulletList",
    "rule",
    "heading",
    "codeBlock",
    "taskList",
    "table",
    "blockCard",
    ...MEDIA,
  ],
  doc: [
    "expand",
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
    "embedCard",
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

test("R1-D12: Insert table keeps the selected text and goes after its paragraph", () => {
  const doc = n.doc!.create(null, [p("keep this text")]);
  const selected = EditorState.create({ doc, selection: TextSelection.create(doc, 6, 10) });
  const { after } = run(insertTable, selected);
  expect(after.doc.childCount).toBe(2);
  expect(after.doc.firstChild!.textContent).toBe("keep this text");
  expect(after.doc.lastChild!.type.name).toBe("table");
  expect(after.selection.empty).toBe(true);
});

test("R1-D51/D79: Unlink removes the whole link from the caret or a selection at its start; a bare domain gets https", () => {
  const link = s.marks.link!.create({ href: "https://example.com" });
  const doc = n.doc!.create(null, [
    n.paragraph!.create(null, [s.text("see "), s.text("link me", [link]), s.text(" now")]),
  ]);
  for (const [from, to] of [
    [5, 5],
    [5, 8],
    [7, 9],
  ] as const) {
    const { handled, after } = run(
      removeLink,
      EditorState.create({ doc, selection: TextSelection.create(doc, from, to) }),
    );
    expect(handled).toBe(true);
    expect(after.doc.rangeHasMark(0, after.doc.content.size, s.marks.link!)).toBe(false);
  }
  expect(linkTarget(" example.com ")).toBe("https://example.com/");
  expect(linkTarget("javascript:alert(1)")).toBeNull();
});

test("R2-D6: with the caret in a link, the link field shows its address and applying edits that whole link", () => {
  const link = s.marks.link!.create({ href: "https://old.test/" });
  const doc = n.doc!.create(null, [
    n.paragraph!.create(null, [s.text("see "), s.text("docs", [link])]),
  ]);
  const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 7) });
  expect(linkHref(caret)).toBe("https://old.test/");
  const { after } = run(insertLink("https://new.test/"), caret);
  expect(after.doc.textContent).toBe("see docs");
  const marks: string[] = [];
  after.doc.descendants((node) => {
    if (node.isText) marks.push(`${node.text}:${node.marks.map((m) => m.attrs.href).join()}`);
  });
  expect(marks).toEqual(["see :", "docs:https://new.test/"]);
  expect(run(removeLink, caret).after.doc.rangeHasMark(0, doc.content.size, s.marks.link!)).toBe(
    false,
  );
});

test("R2-D8: near the viewport's bottom the selection toolbar goes above the selection, within the side panel", () => {
  const cell = { top: 833, bottom: 870, left: 900 },
    place = floatingPlacement(
      cell,
      cell,
      { top: 800, left: 880, right: 1400, width: 520 },
      { width: 908, height: 37 },
      { width: 1440, height: 900 },
    );
  // Not over the cell (833–870)…
  expect(place.top + 37 <= cell.top || place.top >= cell.bottom).toBe(true);
  // …and no wider than the panel, starting inside it.
  expect(place.maxWidth).toBe(520);
  expect(place.left).toBe(880);
});

test("BJ-67: `***` or `---` then Space puts a divider above the caret's paragraph", () => {
  for (const marker of ["***", "---"]) {
    const after = typeInto(empty(), `${marker} next`);
    expect(after.doc.childCount).toBe(2);
    expect(after.doc.firstChild!.type.name).toBe("rule");
    expect(after.doc.lastChild!.textContent).toBe("next");
    expect(fromEditorDocument(after.doc).content![0]).toEqual({ type: "rule" });
  }
  // Inside a list item, where Jira allows no rule, the text stays.
  const list = typeInto(empty(), "- --- ");
  expect(list.doc.textContent).toBe("--- ");
});

test("BJ-66: `|--` starts a table, taking a Markdown header row typed just above", () => {
  const plain = typeInto(empty(), "|--x");
  expect(plain.doc.firstChild!.type.name).toBe("table");
  expect(plain.doc.firstChild!.childCount).toBe(2);
  expect(plain.doc.firstChild!.firstChild!.childCount).toBe(2);
  expect(plain.doc.firstChild!.firstChild!.firstChild!.textContent).toBe("x");

  const doc = n.doc!.create(null, [p("| Name | Owner | Due |"), p()]);
  const after = typeInto(EditorState.create({ doc, selection: TextSelection.atEnd(doc) }), "|--a");
  expect(after.doc.childCount).toBe(1);
  const t = after.doc.firstChild!;
  expect(t.childCount).toBe(2);
  expect(t.firstChild!.firstChild!.type.name).toBe("tableHeader");
  expect(t.firstChild!.textContent).toBe("NameOwnerDue");
  expect(t.child(1).childCount).toBe(3);
  expect(t.child(1).firstChild!.textContent).toBe("a");
  expect(jiraErrors(fromEditorDocument(after.doc))).toEqual([]);
});

test("BJ-44: a URL pasted over selected text links the text; anything else pastes as usual", () => {
  const doc = n.doc!.create(null, [p("see the docs here"), code("x")]);
  const select = (from: number, to: number) =>
    EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
  const run = (state: EditorState, text: string) => {
    let next: EditorState | null = null;
    const handled = pasteLink(text)(state, (tr) => (next = state.apply(tr)));
    return { handled, next: next as EditorState | null };
  };
  const linked = run(select(9, 13), " https://example.test/docs ");
  expect(linked.handled).toBe(true);
  const docs = linked.next!.doc.firstChild!.child(1);
  expect(docs.text).toBe("docs");
  expect(docs.marks[0]?.attrs.href).toBe("https://example.test/docs");
  expect(run(select(9, 9), "https://example.test").handled).toBe(false);
  expect(run(select(9, 13), "not a url").handled).toBe(false);
  expect(run(select(9, 13), "https://a.test and more").handled).toBe(false);
  expect(run(select(9, 13), "javascript:alert(1)").handled).toBe(false);
  expect(run(select(20, 21), "https://example.test").handled).toBe(false);
});

test("BJ-55: ⌥↑ / ⌥↓ move the selected block, or its list item when it is the item's only block", () => {
  const apply = (state: EditorState, command: Command) => {
    let next = state;
    command(state, (tr) => (next = state.apply(tr)));
    return next;
  };
  const texts = (doc: EditorNode) => doc.content.content.map((b) => b.textContent);
  const down = apply(state([p("a"), p("b"), p("c")], "a"), moveBlock(1));
  expect(texts(down.doc)).toEqual(["b", "a", "c"]);
  expect(down.selection.$from.parent.textContent).toBe("a");
  expect(texts(apply(down, moveBlock(-1)).doc)).toEqual(["a", "b", "c"]);
  expect(moveBlock(-1)(state([p("a"), p("b")], "a"))).toBe(false);
  // A list item moves among its siblings, keeping the caret.
  const list = apply(state([bullets("one", "two")], "two"), moveBlock(-1));
  expect(list.doc.firstChild!.firstChild!.textContent).toBe("two");
  expect(list.selection.$from.parent.textContent).toBe("two");
  // The first item cannot move up inside its list, so the whole list swaps with the block above.
  const out = apply(state([p("x"), bullets("one", "two")], "one"), moveBlock(-1));
  expect(texts(out.doc)).toEqual(["onetwo", "x"]);
  // A table row moves, never a cell.
  const t = apply(state([table(["1", "2"], ["3", "4"])], "3"), moveBlock(-1));
  expect(t.doc.firstChild!.firstChild!.textContent).toBe("34");
});

test("BJ-68: a collapsible section wraps top-level blocks, round-trips as Jira's expand, and unwraps", () => {
  const typed = typeInto(empty(), ">>> body");
  expect(typed.doc.firstChild!.type.name).toBe("expand");
  expect(fromEditorDocument(typed.doc).content![0]).toEqual({
    type: "expand",
    attrs: { title: "" },
    content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }],
  });
  expect(typeInto(empty(), "- >>> ").doc.textContent).toBe(">>> ");

  const jira = {
    type: "doc",
    version: 1,
    content: [
      { type: "expand", attrs: { title: "Details" }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
    ],
  };
  const loaded = toEditorDocument(jira);
  expect(loaded.firstChild!.type.name).toBe("expand");
  expect(loaded.firstChild!.attrs.title).toBe("Details");
  expect(fromEditorDocument(loaded)).toEqual(jira as any);

  const wrapped = (() => {
    const s0 = state([p("one"), p("two")], "one");
    let next = s0;
    toggleExpand(s0, (tr) => (next = s0.apply(tr)));
    return next;
  })();
  expect(wrapped.doc.firstChild!.type.name).toBe("expand");
  expect(wrapped.doc.childCount).toBe(2);
  let unwrapped = wrapped;
  toggleExpand(wrapped, (tr) => (unwrapped = wrapped.apply(tr)));
  expect(unwrapped.doc.firstChild!.type.name).toBe("paragraph");
  // In a list the whole list goes in the section (Jira allows no expand inside a list).
  const list = state([bullets("x")], "x");
  let listed = list;
  toggleExpand(list, (tr) => (listed = list.apply(tr)));
  expect(listed.doc.firstChild!.firstChild!.type.name).toBe("bulletList");
  expect(jiraErrors(fromEditorDocument(wrapped.doc))).toEqual([]);
});

test("BJ-69: selected text starts an issue: first line the title, the rest its description", () => {
  expect(issueFromText("  Fix the login  ")).toEqual({ title: "Fix the login" });
  expect(issueFromText("Fix login\nSteps:\n\n1. open")).toEqual({
    title: "Fix login",
    description: "Steps:\n\n1. open",
  });
  expect(issueFromText("x".repeat(300)).title.length).toBe(255);
});

test("BJ-69: the created issue replaces the text it was made from with a reference, unless that text changed", () => {
  const doc = n.doc!.create(null, [p("fix the login now")]);
  const before = EditorState.create({ doc });
  const tr = referenceSelection(before, { from: 5, to: 14, text: "the login" }, "https://x.test/browse/KAN-12")!;
  const after = before.apply(tr).doc.firstChild!;
  expect(after.childCount).toBe(3);
  expect(after.child(1).type.name).toBe("inlineCard");
  expect(fromEditorDocument(before.apply(tr).doc).content?.[0]?.content?.[1]).toEqual({
    type: "inlineCard",
    attrs: { url: "https://x.test/browse/KAN-12" },
  });
  expect(referenceSelection(before, { from: 5, to: 14, text: "the logon" }, "https://x.test/browse/KAN-12")).toBeNull();
});

test("BJ-56: the block menu's Duplicate and Delete act on the selected block, or its list item", () => {
  const apply = (s0: EditorState, command: Command) => {
    let next = s0;
    expect(command(s0, (tr) => (next = s0.apply(tr)))).toBe(true);
    return next;
  };
  const texts = (doc: EditorNode) => doc.content.content.map((b) => b.textContent);
  expect(texts(apply(state([p("a"), p("b")], "a"), duplicateBlock).doc)).toEqual(["a", "a", "b"]);
  expect(texts(apply(state([p("a"), p("b")], "a"), deleteBlock).doc)).toEqual(["b"]);
  expect(texts(apply(state([p("a")], "a"), deleteBlock).doc)).toEqual([""]);
  const list = apply(state([bullets("one", "two")], "two"), duplicateBlock);
  expect(list.doc.firstChild!.childCount).toBe(3);
  const removed = apply(state([bullets("one", "two")], "two"), deleteBlock);
  expect(removed.doc.firstChild!.textContent).toBe("one");
  expect(jiraErrors(fromEditorDocument(removed.doc))).toEqual([]);
});
