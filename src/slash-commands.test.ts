import { expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { activeSlash, matchingSlashCommands } from "./slash-commands";
import { fromEditorDocument, richSchema } from "./rich-document";

const n = richSchema.nodes;
const at = (text: string) => {
  const doc = n.doc!.create(null, n.paragraph!.create(null, richSchema.text(text)));
  return EditorState.create({ doc, selection: TextSelection.atEnd(doc) });
};
const ids = (query: string, state = at(`/${query}`)) => matchingSlashCommands(query, state).map((c) => c.id);

test("BJ-42: / opens the slash menu at a word start, filtered by name or keyword", () => {
  expect(activeSlash(at("/"))?.query).toBe("");
  expect(activeSlash(at("then /head"))?.query).toBe("head");
  expect(activeSlash(at("a/b"))).toBeNull();
  expect(activeSlash(at("see https://x.test/"))).toBeNull();
  expect(ids("h2")).toEqual(["heading-2"]);
  expect(ids("heading 3")).toEqual(["heading-3"]);
  expect(ids("hr")).toEqual(["divider"]);
  expect(ids("coll")).toEqual(["expand"]);
  expect(ids("zzz")).toEqual([]);
});

test("row 51: Linear's slash items in its order; Heading 4, Date and Shrug only for a query; table items only in a table", () => {
  expect(ids("")).toEqual([
    "heading-1",
    "heading-2",
    "heading-3",
    "bullet",
    "ordered",
    "checklist",
    "media",
    "attach",
    "code-block",
    "expand",
    "quote",
    "callout",
    "table",
    "divider",
  ]);
  expect(ids("heading")).toContain("heading-4");
  expect(ids("d")).not.toContain("date");
  expect(ids("today")).toEqual(["date"]);
  expect(ids("shrug")).toEqual(["shrug"]);
  // Keywords count, after names: "warning" finds Callout; "check" finds Checklist first.
  expect(ids("warning")).toEqual(["callout"]);
  expect(ids("check")[0]).toBe("checklist");
  const cell = (text: string) => n.tableCell!.create(null, n.paragraph!.create(null, text ? richSchema.text(text) : null));
  const row = () => n.tableRow!.create(null, [cell("/"), cell("")]);
  const doc = n.doc!.create(null, n.table!.create(null, [row(), row()]));
  const inTable = EditorState.create({ doc, selection: TextSelection.create(doc, 5) });
  const tableIds = ids("", inTable);
  expect(tableIds.slice(0, 5)).toEqual(["insert-row", "delete-row", "insert-column", "delete-column", "delete-table"]);
  expect(tableIds).not.toContain("table");
  expect(tableIds).not.toContain("expand");
  expect(tableIds).not.toContain("divider");
});

test("BJ-42: a picked block command applies to the line the / was typed on", () => {
  const state = at("/div");
  const trigger = activeSlash(state)!;
  const cleared = state.apply(state.tr.delete(trigger.from, trigger.to));
  let after = cleared;
  matchingSlashCommands("div", state)[0]!.command!(cleared, (tr) => (after = cleared.apply(tr)));
  expect(fromEditorDocument(after.doc).content!.map((node) => node.type)).toEqual(["rule", "paragraph"]);
});

test("row 21: the slash Date inserts today as Jira's date (midnight UTC, in milliseconds)", () => {
  const state = at("/today"),
    trigger = activeSlash(state)!,
    cleared = state.apply(state.tr.delete(trigger.from, trigger.to));
  let after = cleared;
  matchingSlashCommands("today", state)[0]!.command!(cleared, (tr) => (after = cleared.apply(tr)));
  const now = new Date();
  expect(fromEditorDocument(after.doc).content![0]!.content).toEqual([
    { type: "date", attrs: { timestamp: String(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) } },
  ]);
});

test("row 51: the slash Table takes the empty line it was typed on, and goes after a line with text", () => {
  const run = (doc: ReturnType<typeof n.doc.create>, pos: number) => {
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
    matchingSlashCommands("table", state).find((c) => c.id === "table")!.command!(state, (tr) => (state = state.apply(tr)));
    return state.doc.content.content.map((node) => node.type.name);
  };
  const p = (text?: string) => n.paragraph!.create(null, text ? richSchema.text(text) : null);
  expect(run(n.doc!.create(null, [p("a"), p()]), 4)).toEqual(["paragraph", "table"]);
  expect(run(n.doc!.create(null, [p("a")]), 2)).toEqual(["paragraph", "table"]);
});
