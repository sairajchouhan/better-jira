import { expect, test } from "bun:test";
import type { Node as EditorNode } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { withTaskToggled } from "./adf";
import { markdownRules } from "./editor-commands";
import {
  blockRules,
  dividerKey,
  headingBackspace,
  insertDivider,
  lineBreak,
  toggleCallout,
} from "./editor-blocks";
import { setList, taskBackspace, taskEnter, toggleChecklist, toggleTask } from "./editor-checklist";
import { mediaCaretPlugin } from "./media-caret";
import { fromEditorDocument, richSchema as s, toEditorDocument, type AdfDocument } from "./rich-document";

const n = s.nodes;
const p = (text = "") => n.paragraph!.create(null, text ? s.text(text) : null);
const h = (text: string, level = 2) => n.heading!.create({ level }, s.text(text));
const tasks = (...items: [string, "TODO" | "DONE"][]) =>
  n.taskList!.create(null, items.map(([text, state]) => n.taskItem!.create({ state }, text ? s.text(text) : null)));
const bullets = (...texts: string[]) =>
  n.bulletList!.create(null, texts.map((text) => n.listItem!.create(null, p(text))));
/** A state with the caret after the first occurrence of `at` (or at its end with `end`). */
function state(blocks: EditorNode[], at: string, end = true) {
  const doc = n.doc!.create(null, blocks);
  let pos = -1;
  doc.descendants((node, offset) => {
    if (pos < 0 && node.isText && node.text!.includes(at)) pos = offset + node.text!.indexOf(at) + (end ? at.length : 0);
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos < 0 ? 1 : pos) });
}
const run = (command: Command, before: EditorState) => {
  let after = before;
  const ran = command(before, (tr) => (after = before.apply(tr)));
  return { ran, after };
};
const adf = (st: EditorState) => fromEditorDocument(st.doc).content!;
/** Types through both input-rule plugins one character at a time, as a keyboard does. */
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
    const handled = [markdownRules, blockRules].some((plugin) =>
      plugin.props.handleTextInput!.call(plugin, view, from, to, char, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
  return view.state as EditorState;
}
const empty = () => state([p()], "");

test("BJ-173: `[ ]` and `[]` start a checklist; it round-trips as Jira's taskList with localIds and state", () => {
  for (const marker of ["[ ]", "[]"]) {
    const typed = typeInto(empty(), `${marker}Buy milk`);
    const [list] = adf(typed);
    expect(list!.type).toBe("taskList");
    expect(list!.attrs!.localId).toEqual(expect.any(String));
    expect(list!.content![0]).toEqual({
      type: "taskItem",
      attrs: { state: "TODO", localId: expect.any(String) },
      content: [{ type: "text", text: "Buy milk" }],
    });
  }
  // Jira's own checklist comes back exactly as it went in.
  const jira: AdfDocument = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "taskList",
        attrs: { localId: "list" },
        content: [
          { type: "taskItem", attrs: { localId: "a", state: "DONE" }, content: [{ type: "text", text: "Done" }] },
          { type: "taskItem", attrs: { localId: "b", state: "TODO" } },
        ],
      },
    ],
  };
  expect(fromEditorDocument(toEditorDocument(jira))).toEqual(jira);
});

test("BJ-173: ⌘↵ ticks the caret's item (or every selected one); Enter adds an unticked item, or leaves on an empty one", () => {
  const ticked = run(toggleTask, state([tasks(["one", "TODO"], ["two", "TODO"])], "one")).after;
  expect(adf(ticked)[0]!.content!.map((item) => item.attrs!.state)).toEqual(["DONE", "TODO"]);
  expect(run(toggleTask, state([p("text")], "text")).ran).toBe(false);
  const all = state([tasks(["one", "DONE"], ["two", "TODO"])], "one");
  const both = run(toggleTask, all.apply(all.tr.setSelection(TextSelection.create(all.doc, 2, all.doc.content.size - 2)))).after;
  expect(adf(both)[0]!.content!.map((item) => item.attrs!.state)).toEqual(["DONE", "DONE"]);

  const split = run(taskEnter, state([tasks(["onetwo", "DONE"])], "one")).after;
  const items = adf(split)[0]!.content!;
  expect(items.map((item) => [item.content?.[0]?.text, item.attrs!.state])).toEqual([
    ["one", "DONE"],
    ["two", "TODO"],
  ]);
  expect(items[0]!.attrs!.localId).not.toBe(items[1]!.attrs!.localId);
  // Enter on an empty middle item splits the checklist around a paragraph.
  const left = run(taskEnter, state([tasks(["a", "TODO"], ["", "TODO"], ["b", "TODO"])], "a")).after;
  const leftDoc = left.apply(left.tr.setSelection(TextSelection.create(left.doc, 5)));
  const out = run(taskEnter, leftDoc).after;
  expect(adf(out).map((node) => node.type)).toEqual(["taskList", "paragraph", "taskList"]);
  expect(out.selection.$from.parent.type.name).toBe("paragraph");
  // Backspace at an item's start makes it a paragraph.
  const back = run(taskBackspace, state([tasks(["a", "TODO"])], "a", false)).after;
  expect(adf(back)).toEqual([{ type: "paragraph", content: [{ type: "text", text: "a" }] }]);
});

test("BJ-173: ⌘⇧7 / the list menu turn text and lists into a checklist and back", () => {
  const fromText = run(toggleChecklist, state([p("a")], "a")).after;
  expect(adf(fromText)[0]!.type).toBe("taskList");
  expect(fromText.selection.$from.parent.type.name).toBe("taskItem");
  const back = run(toggleChecklist, fromText).after;
  expect(adf(back)[0]!.type).toBe("paragraph");
  const fromList = run(toggleChecklist, state([bullets("one", "two")], "two")).after;
  expect(adf(fromList)[0]!.content!.map((item) => item.content![0]!.text)).toEqual(["one", "two"]);
  expect(fromList.selection.$from.parent.textContent).toBe("two");
  const toNumbers = run(setList("orderedList"), fromList).after;
  expect(adf(toNumbers)[0]!.type).toBe("orderedList");
  expect(toNumbers.selection.$from.parent.textContent).toBe("two");
});

/** The schema's paste rule for `tag` read against an element with these attributes (no DOM in unit tests). */
const parsed = (node: string, tag: string, attrs: Record<string, string>) => {
  const rule = (n[node]!.spec.parseDOM ?? []).find((r) => r.tag === tag)!;
  const dom = { getAttribute: (name: string) => attrs[name] ?? null } as unknown as HTMLElement;
  return rule.getAttrs ? rule.getAttrs(dom) : rule.attrs ?? {};
};
test("BJ-173 / BJ-182: pasted checklists and callouts (ours and Linear's) keep their ticks and types", () => {
  expect(parsed("taskList", 'ul[data-type="todo_list"]', {})).toEqual({});
  expect(parsed("taskItem", 'li[data-type="todo_item"]', { "data-done": "true" })).toEqual({ state: "DONE" });
  expect(parsed("taskItem", "li[data-task-state]", { "data-task-state": "TODO" })).toEqual({ state: "TODO" });
  expect(parsed("panel", "div[data-panel-type]", { "data-panel-type": "error" })).toEqual({ panelType: "error" });
  // A custom panel needs Jira's colour and icon, which HTML does not carry: it pastes as info.
  expect(parsed("panel", "div[data-panel-type]", { "data-panel-type": "custom" })).toEqual({ panelType: "info" });
  expect(parsed("panel", "div[data-callout]", {})).toEqual({});
});

test("BJ-173: the read-only view ticks an item by identity, leaving the rest of the document shared", () => {
  const item = { type: "taskItem", attrs: { localId: "a", state: "TODO" } };
  const other = { type: "paragraph" };
  const doc = { type: "doc", version: 1, content: [{ type: "taskList", content: [item] }, other] };
  const next = withTaskToggled(doc, item);
  expect(next.content[0].content[0].attrs).toEqual({ localId: "a", state: "DONE" });
  expect(next.content[1]).toBe(other);
  expect(item.attrs.state).toBe("TODO");
});

test("BJ-182: the slash Callout wraps in an info panel; `> [!WARNING]` turns the quote into a warning panel; both round-trip", () => {
  const wrapped = run(toggleCallout(), state([p("note")], "note")).after;
  expect(adf(wrapped)).toEqual([
    { type: "panel", attrs: { panelType: "info" }, content: [{ type: "paragraph", content: [{ type: "text", text: "note" }] }] },
  ]);
  const quoted = typeInto(empty(), "> [!WARNING]");
  expect(adf(quoted)[0]).toEqual({ type: "panel", attrs: { panelType: "warning" }, content: [{ type: "paragraph" }] });
  for (const [marker, type] of [
    ["NOTE", "info"],
    ["TIP", "success"],
    ["IMPORTANT", "note"],
    ["CAUTION", "error"],
  ])
    expect(adf(typeInto(empty(), `[!${marker}]`))[0]!.attrs).toEqual({ panelType: type });
  const jira: AdfDocument = {
    type: "doc",
    version: 1,
    content: [{ type: "panel", attrs: { panelType: "custom", panelColor: "#abcdef", panelIcon: ":x:" }, content: [{ type: "paragraph" }] }],
  };
  expect(fromEditorDocument(toEditorDocument(jira))).toEqual(jira);
});

test("row 36: `---`, `***`, `___` and `===` become a divider in place; Enter on such a line does too; ⌘⇧- inserts one", () => {
  for (const marker of ["---", "***", "___", "==="]) {
    const doc = n.doc!.create(null, [p(), p("next")]);
    const typed = typeInto(EditorState.create({ doc, selection: TextSelection.create(doc, 1) }), marker);
    expect(adf(typed).map((node) => node.type)).toEqual(["rule", "paragraph"]);
    expect(typed.selection.$from.parent.textContent).toBe("next");
  }
  // At the end, a paragraph follows for the caret.
  expect(adf(typeInto(empty(), "---")).map((node) => node.type)).toEqual(["rule", "paragraph"]);
  // In a list item, where Jira allows no rule, the text stays.
  expect(typeInto(empty(), "- ---").doc.textContent).toBe("---");
  const entered = run(dividerKey(true), state([p("---"), p("next")], "---")).after;
  expect(adf(entered).map((node) => node.type)).toEqual(["rule", "paragraph", "paragraph"]);
  const middle = run(insertDivider, state([p("onetwo")], "one")).after;
  expect(adf(middle).map((node) => [node.type, node.content?.[0]?.text])).toEqual([
    ["paragraph", "one"],
    ["rule", undefined],
    ["paragraph", "two"],
  ]);
  expect(middle.selection.$from.parent.textContent).toBe("two");
  expect(run(insertDivider, state([bullets("a")], "a")).ran).toBe(false);
});

test("row 70: a document ending in a table, divider or code block gets an empty paragraph to type in, never saved", () => {
  const jira: AdfDocument = { type: "doc", version: 1, content: [{ type: "rule" }] };
  const doc = toEditorDocument(jira);
  expect(doc.lastChild!.type.name).toBe("paragraph");
  expect(fromEditorDocument(doc)).toEqual(jira);
  let st = EditorState.create({ doc: n.doc!.create(null, [p("a")]), plugins: [mediaCaretPlugin()] });
  st = st.apply(st.tr.insert(st.doc.content.size, n.rule!.create()));
  expect(st.doc.lastChild!.type.name).toBe("paragraph");
  expect(fromEditorDocument(st.doc).content!.map((node) => node.type)).toEqual(["paragraph", "rule"]);
});

test("§4: ⌫ at a heading's start makes it text; ⇧↵ breaks the line; two spaces indent a list item", () => {
  expect(adf(run(headingBackspace, state([h("Title")], "Title", false)).after)[0]!.type).toBe("paragraph");
  expect(run(headingBackspace, state([h("Title")], "Ti")).ran).toBe(false);
  expect(adf(run(lineBreak, state([p("ab")], "a")).after)[0]!.content!.map((node) => node.type)).toEqual([
    "text",
    "hardBreak",
    "text",
  ]);
  const code = n.codeBlock!.create(null, s.text("ab"));
  expect(run(lineBreak, state([code], "a")).after.doc.textContent).toBe("a\nb");
  const indented = typeInto(state([bullets("one", "")], "one"), "");
  const second = indented.apply(indented.tr.setSelection(TextSelection.atEnd(indented.doc)));
  const sunk = typeInto(second, "  ");
  expect(sunk.doc.firstChild!.childCount).toBe(1);
  expect(sunk.doc.firstChild!.firstChild!.childCount).toBe(2);
  expect(sunk.doc.textContent).toBe("one");
});
