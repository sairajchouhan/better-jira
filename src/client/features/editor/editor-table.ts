import { Fragment, Slice, type Node as EditorNode } from "prosemirror-model";
import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  addColumn,
  addColumnAfter,
  addColumnBefore,
  addRow,
  addRowAfter,
  addRowBefore,
  CellSelection,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
  TableMap,
  type TableRect,
} from "prosemirror-tables";
import { fromEditorDocument, richSchema } from "./rich-document";
import { adfToMarkdown } from "@/client/features/issue/issue-copy";
import { toasts } from "@/client/components/toast-queue";

/*
 * Linear's table editing (startup-root.CnUSfl4j.js: the `table` extension's keys, `fb` table commands, `r8e.setHeader`,
 * `i8e` menus). Commands act on the selection, as Linear's menus do after selecting the row or column they open on;
 * `tablePos` is the position before a table node. The slash menu's table items call these too.
 */

export { deleteColumn, deleteRow, isInTable };
export const insertRowAbove = addRowBefore;
export const insertRowBelow = addRowAfter;
export const insertColumnLeft = addColumnBefore;
export const insertColumnRight = addColumnAfter;
export const removeTable = deleteTable;

/** Linear's `B8e({cellMinWidth:50})` column resizing; widths land in the cells' ADF `colwidth`. */
export const tableResizing = () => columnResizing({ handleWidth: 5, cellMinWidth: 50, defaultCellMinWidth: 50 });

const tableAt = (state: EditorState, tablePos: number) => {
  const table = state.doc.nodeAt(tablePos);
  return table?.type.spec.tableRole === "table" ? { table, map: TableMap.get(table), start: tablePos + 1 } : null;
};
/** Linear's `Yl.hasHeader`: a header cell in the first row. */
export const hasHeader = (table: EditorNode) => {
  let header = false;
  table.firstChild?.forEach((cell) => (header ||= cell.type.spec.tableRole === "header_cell"));
  return header;
};
const firstBodyRow = (table: EditorNode) => (hasHeader(table) ? 1 : 0);
/** Row and column menus need a plain grid (Linear's `hasSpanningCells` check). */
export const hasSpans = (table: EditorNode) => {
  let spans = false;
  table.descendants((node) => {
    if (node.type.spec.tableRole?.endsWith("cell")) spans ||= node.attrs.colspan > 1 || node.attrs.rowspan > 1;
    return !spans && node.type.spec.tableRole !== "cell" && node.type.spec.tableRole !== "header_cell";
  });
  return spans;
};
const rect = (state: EditorState): TableRect | null => (isInTable(state) ? selectedRect(state) : null);

/** Selects a whole row (`axis` "row") or column of the table at `tablePos`. */
export const selectLine =
  (tablePos: number, axis: "row" | "column", index: number): Command =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos);
    if (!found || index >= (axis === "row" ? found.map.height : found.map.width)) return false;
    const { table, map, start } = found,
      at = (i: number) =>
        state.doc.resolve(start + map.positionAt(axis === "row" ? index : i, axis === "row" ? i : index, table)),
      last = axis === "row" ? map.width - 1 : map.height - 1;
    dispatch?.(
      state.tr.setSelection(
        axis === "row" ? CellSelection.rowSelection(at(0), at(last)) : CellSelection.colSelection(at(0), at(last)),
      ),
    );
    return true;
  };
export const selectTable =
  (tablePos: number): Command =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos);
    if (!found) return false;
    const { map, start } = found;
    dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, start + map.map[0]!, start + map.map.at(-1)!)));
    return true;
  };

/** The edge "Add row" / "Add column" buttons: one more at the end, the selection kept (Linear's `…PreservingSelection`). */
export const appendLine =
  (tablePos: number, axis: "row" | "column"): Command =>
  (state, dispatch) => {
    const found = tableAt(state, tablePos);
    if (!found) return false;
    const { table, map, start } = found,
      at: TableRect = { table, map, tableStart: start, left: 0, top: 0, right: 0, bottom: 0 };
    dispatch?.(axis === "row" ? addRow(state.tr, at, map.height) : addColumn(state.tr, at, map.width));
    return true;
  };

/** Moves the selected rows one place up or down, past neither the header nor the table's end (Linear's `fb.moveRow`). */
export const moveRow =
  (dir: "up" | "down"): Command =>
  (state, dispatch) => {
    const r = rect(state);
    if (!r || hasSpans(r.table)) return false;
    const body = firstBodyRow(r.table);
    if (r.top < body || (dir === "up" ? r.top <= body : r.bottom >= r.map.height)) return false;
    // The neighbour row jumps over the selection, so the selection moves as a block.
    const [from, to] = dir === "up" ? [r.top - 1, r.bottom - 1] : [r.bottom, r.top];
    return keep(state, dispatch, moveTableRow({ from, to, select: false, pos: r.tableStart }), dir === "up" ? -1 : 1, 0);
  };
export const moveColumn =
  (dir: "left" | "right"): Command =>
  (state, dispatch) => {
    const r = rect(state);
    if (!r || hasSpans(r.table) || (dir === "left" ? r.left === 0 : r.right >= r.map.width)) return false;
    const [from, to] = dir === "left" ? [r.left - 1, r.right - 1] : [r.right, r.left];
    return keep(state, dispatch, moveTableColumn({ from, to, select: false, pos: r.tableStart }), 0, dir === "left" ? -1 : 1);
  };
/** Runs a whole-table move, then puts the selection (cells, or the caret at its offset in its cell) where its cells went. */
function keep(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, move: Command, rows: number, cols: number) {
  const r = selectedRect(state);
  let moved: Transaction | undefined;
  if (!move(state, (tr) => (moved = tr)) || !moved) return false;
  if (!dispatch) return true;
  const table = moved.doc.nodeAt(r.tableStart - 1)!,
    map = TableMap.get(table),
    cell = (row: number, col: number) => r.tableStart + map.positionAt(row + rows, col + cols, table);
  const { selection } = state;
  if (selection instanceof CellSelection) {
    const anchor = TableMap.get(r.table).findCell(selection.$anchorCell.pos - r.tableStart),
      head = TableMap.get(r.table).findCell(selection.$headCell.pos - r.tableStart);
    moved.setSelection(CellSelection.create(moved.doc, cell(anchor.top, anchor.left), cell(head.top, head.left)));
  } else {
    const $cell = state.doc.resolve(selection.head),
      depth = Array.from({ length: $cell.depth }, (_, d) => $cell.depth - d).find((d) =>
        $cell.node(d).type.spec.tableRole?.endsWith("cell"),
      )!,
      from = $cell.before(depth),
      at = TableMap.get(r.table).findCell(from - r.tableStart),
      to = cell(at.top, at.left);
    moved.setSelection(TextSelection.near(moved.doc.resolve(Math.min(to + (selection.head - from), to + moved.doc.nodeAt(to)!.nodeSize - 1))));
  }
  dispatch(moved.scrollIntoView());
  return true;
}

/** Linear's `fb.parseNumericValue`: a number, or digits with separators (no letters). */
const numeric = (text: string) => {
  const value = text.trim();
  if (value !== "" && !isNaN(Number(value))) return Number(value);
  if (/[a-zA-Z]/.test(value)) return NaN;
  const digits = value.replace(/[^\d.+-]/g, "");
  return digits ? Number(digits) : NaN;
};
/** Sorts the body rows by the selection's column: numerically when every value is a number or empty, else by text (Linear's `fb.sortRowsByColumn`). */
export const sortRows =
  (direction: "ascending" | "descending"): Command =>
  (state, dispatch) => {
    const r = rect(state);
    if (!r || hasSpans(r.table)) return false;
    const body = firstBodyRow(r.table),
      rows: { node: EditorNode; value: string; index: number }[] = [];
    r.table.forEach((node, _, index) => {
      if (index >= body) rows.push({ node, value: node.child(r.left).textContent, index });
    });
    if (!rows.length) return false;
    const numbers = rows.every((row) => row.value === "" || !isNaN(numeric(row.value))),
      key = (value: string) => (value === "" ? -Infinity : numeric(value));
    rows.sort((a, b) => {
      const order = numbers ? key(a.value) - key(b.value) : a.value.toLowerCase().localeCompare(b.value.toLowerCase());
      return order === 0 ? a.index - b.index : direction === "ascending" ? order : -order;
    });
    if (dispatch) {
      const head: EditorNode[] = [];
      r.table.forEach((node, _, index) => index < body && head.push(node));
      const tablePos = r.tableStart - 1,
        tr = state.tr.replaceWith(tablePos, tablePos + r.table.nodeSize, r.table.copy(Fragment.from([...head, ...rows.map((row) => row.node)])));
      // The selection stays in the table: mapped through the replaced table it fell after it, and the table's controls went with
      // it. A column selection (the column menu's) selects the sorted column again; a caret goes with its row.
      const sorted = tableAt({ doc: tr.doc } as EditorState, tablePos)!,
        cell = (rowIndex: number, column: number) =>
          tr.doc.resolve(sorted.start + sorted.map.positionAt(rowIndex, column, sorted.table));
      const moved = r.top < body ? r.top : body + rows.findIndex((row) => row.index === r.top);
      tr.setSelection(
        state.selection instanceof CellSelection
          ? CellSelection.colSelection(cell(0, r.left), cell(sorted.map.height - 1, r.left))
          : TextSelection.near(tr.doc.resolve(cell(moved, r.left).pos + 1)),
      );
      dispatch(tr.scrollIntoView());
    }
    return true;
  };

/** Linear's `r8e.setHeader`: the first row becomes header cells or plain ones; a lone row gets a body row to go with its header. */
export const toggleHeader: Command = (state, dispatch) => {
  const r = rect(state);
  if (!r) return false;
  if (dispatch) {
    const on = !hasHeader(r.table),
      type = richSchema.nodes[on ? "tableHeader" : "tableCell"]!,
      tr = state.tr;
    if (on && r.map.height === 1) addRow(tr, r, 1);
    r.table.firstChild!.forEach((cell, offset) => {
      if (cell.type !== type) tr.setNodeMarkup(r.tableStart + 1 + offset, type, cell.attrs, cell.marks);
    });
    dispatch(tr);
  }
  return true;
};

/** Copies `content` (cells or a table) as Linear does: Markdown text, plus our HTML so a paste here keeps the table. */
async function copyContent(view: EditorView, content: Fragment) {
  const rows = content.firstChild?.type.spec.tableRole === "row",
    table = rows ? richSchema.nodes.table!.create(null, content) : content.firstChild!,
    text = adfToMarkdown(fromEditorDocument(richSchema.nodes.doc!.create(null, table))),
    { dom } = view.serializeForClipboard(new Slice(Fragment.from(table), 0, 0));
  const blob = (type: string, value: string) => new Blob([value], { type });
  if (typeof ClipboardItem === "undefined") return navigator.clipboard.writeText(text);
  await navigator.clipboard.write([
    new ClipboardItem({ "text/plain": blob("text/plain", text), "text/html": blob("text/html", dom.innerHTML) }),
  ]);
}
/** Linear's row and column "Copy": the selected cells. */
export const copySelection = (view: EditorView) => {
  if (view.state.selection instanceof CellSelection) void copyContent(view, view.state.selection.content().content).catch(() => {});
};
/** Linear's "Copy table", with its toasts (`l8e`). */
export const copyTable = (view: EditorView, tablePos: number) => {
  const table = view.state.doc.nodeAt(tablePos);
  if (table?.type.spec.tableRole !== "table") return;
  copyContent(view, Fragment.from(table)).then(
    () => toasts.show("Table copied to clipboard"),
    () => toasts.show("Table could not be copied to clipboard"),
  );
};
