import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { Adf } from "./adf";
import {
  appendLine,
  hasHeader,
  moveColumn,
  moveRow,
  selectLine,
  sortRows,
  toggleHeader,
} from "./editor-table";
import { fromEditorDocument, richSchema as s, toEditorDocument } from "./rich-document";

// BJ-181: Linear's table commands (startup-root `fb` / `r8e`), checked on the document Jira gets.
const n = s.nodes;
const p = (text = "") => n.paragraph!.create(null, text ? s.text(text) : null);
const row = (texts: string[], type = n.tableCell!) => n.tableRow!.create(null, texts.map((t) => type.create(null, p(t))));
const grid = (header: string[] | null, ...rows: string[][]) =>
  n.table!.create(null, [...(header ? [row(header, n.tableHeader!)] : []), ...rows.map((r) => row(r))]);
/** The caret at the end of the cell whose text is `at`. */
function state(table: ReturnType<typeof grid>, at: string) {
  const doc = n.doc!.create(null, [table]);
  let pos = -1;
  doc.descendants((node, offset) => {
    if (pos < 0 && node.isText && node.text === at) pos = offset + node.nodeSize;
    return pos < 0;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}
const run = (command: Command, before: EditorState) => {
  let after = before;
  const handled = command(before, (tr) => (after = before.apply(tr)));
  return { handled, after };
};
const texts = (state: EditorState) => {
  const out: string[][] = [];
  state.doc.firstChild!.forEach((r) => {
    const cells: string[] = [];
    r.forEach((c) => cells.push(c.textContent));
    out.push(cells);
  });
  return out;
};
const caretText = (state: EditorState) => state.selection.$head.parent.textContent;

test("move row: ⌘⇧⌥↑/↓ swap body rows, never past the header or the end, and the caret stays in its cell", () => {
  const start = state(grid(["H1", "H2"], ["a", "1"], ["b", "2"], ["c", "3"]), "b");
  const up = run(moveRow("up"), start).after;
  expect(texts(up)).toEqual([["H1", "H2"], ["b", "2"], ["a", "1"], ["c", "3"]]);
  expect(caretText(up)).toBe("b");
  expect(run(moveRow("up"), up).handled).toBe(false); // the header stays first
  const down = run(moveRow("down"), state(grid(null, ["a"], ["b"], ["c"]), "a")).after;
  expect(texts(down)).toEqual([["b"], ["a"], ["c"]]);
  expect(run(moveRow("down"), state(grid(null, ["a"], ["b"]), "b")).handled).toBe(false);
  expect(run(moveRow("down"), state(grid(["H"], ["a"]), "H")).handled).toBe(false); // the header never moves
});

test("move column: a selected column block moves as one and stays selected", () => {
  const start = state(grid(null, ["a", "b", "c"], ["1", "2", "3"]), "a");
  const selected = run(selectLine(0, "column", 0), start).after;
  const right = run(moveColumn("right"), selected).after;
  expect(texts(right)).toEqual([["b", "a", "c"], ["2", "1", "3"]]);
  expect(right.selection).toBeInstanceOf(CellSelection);
  expect((right.selection as CellSelection).isColSelection()).toBe(true);
  let picked = "";
  (right.selection as CellSelection).forEachCell((c) => (picked += c.textContent));
  expect(picked).toBe("a1");
  expect(run(moveColumn("left"), state(grid(null, ["a", "b"]), "a")).handled).toBe(false);
});

test("sort: body rows by the caret's column, numbers as numbers, ties in place, header kept", () => {
  const numbers = state(grid(["Name", "Points"], ["x", "10"], ["y", "9"], ["z", ""], ["w", "9"]), "Points");
  expect(texts(run(sortRows("ascending"), numbers).after).map((r) => r[0])).toEqual(["Name", "z", "y", "w", "x"]);
  expect(texts(run(sortRows("descending"), numbers).after).map((r) => r[0])).toEqual(["Name", "x", "y", "w", "z"]);
  const words = state(grid(null, ["banana"], ["Apple"], ["cherry"]), "banana");
  expect(texts(run(sortRows("ascending"), words).after).flat()).toEqual(["Apple", "banana", "cherry"]);
});

test("header: Add header turns the first row into tableHeader cells Jira keeps; a lone row gains a body row", () => {
  const lone = run(toggleHeader, state(grid(null, ["a", "b"]), "a")).after;
  expect(hasHeader(lone.doc.firstChild!)).toBe(true);
  const adf = fromEditorDocument(lone.doc);
  expect(adf.content![0]!.content!.map((r) => r.content!.map((c) => c.type))).toEqual([
    ["tableHeader", "tableHeader"],
    ["tableCell", "tableCell"],
  ]);
  expect(fromEditorDocument(toEditorDocument(adf))).toEqual(adf);
  const removed = run(toggleHeader, lone).after;
  expect(hasHeader(removed.doc.firstChild!)).toBe(false);
  expect(fromEditorDocument(removed.doc).content![0]!.content![0]!.content![0]!.type).toBe("tableCell");
});

test("edge buttons: Add row / Add column append at the end and keep the caret", () => {
  const start = state(grid(null, ["a", "b"], ["c", "d"]), "a");
  const rows = run(appendLine(0, "row"), start).after;
  expect(texts(rows)).toEqual([["a", "b"], ["c", "d"], ["", ""]]);
  expect(caretText(rows)).toBe("a");
  const cols = run(appendLine(0, "column"), start).after;
  expect(texts(cols)).toEqual([["a", "b", ""], ["c", "d", ""]]);
  expect(caretText(cols)).toBe("a");
});

test("column widths: Jira's colwidth round-trips, a resize exports it, and the read-only view lays it out", () => {
  const adf = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colwidth: [120] }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
              { type: "tableCell", attrs: { colwidth: [80] }, content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
            ],
          },
        ],
      },
    ],
  };
  const doc = toEditorDocument(adf);
  expect(fromEditorDocument(doc)).toEqual(adf as never);
  // prosemirror-tables' column resizing sets the cell's colwidth attr.
  const cellPos = 2,
    resized = EditorState.create({ doc }).tr.setNodeMarkup(cellPos, undefined, { ...doc.nodeAt(cellPos)!.attrs, colwidth: [200] });
  expect(fromEditorDocument(resized.doc).content![0]!.content![0]!.content![0]!.attrs).toEqual({ colwidth: [200] });
  const html = renderToStaticMarkup(createElement(Adf, { node: adf }));
  expect(html).toContain('style="width:200px"');
  expect(html).toContain('<col style="width:120px"/><col style="width:80px"/>');
});
