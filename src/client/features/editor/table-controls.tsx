/* oxlint-disable react/refs -- The controls are measured from the editor's DOM on each render the editor triggers. */
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { toggleMark } from "prosemirror-commands";
import { TextSelection, type Command } from "prosemirror-state";
import { CellSelection, selectedRect } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { IconButton } from "@/client/components/button";
import { editorKey } from "./editor-bindings";
import { Icon, type IconName } from "@/client/components/icons";
import { richSchema } from "./rich-document";
import {
  appendLine,
  copySelection,
  copyTable,
  deleteColumn,
  deleteRow,
  hasHeader,
  hasSpans,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  moveColumn,
  moveRow,
  removeTable,
  selectLine,
  selectTable,
  sortRows,
  toggleHeader,
} from "./editor-table";

/*
 * Linear's table controls (startup-root.CnUSfl4j.js): the row and column handles (`p4e`, `data-table-cell-control`),
 * the gutter `table-menu-button` (`t7e`), the edge "Add row" / "Add column" bars (`v8e`) and their menus (`i8e`, `a8e`).
 * A right-click in a cell opens the cell menu at the pointer.
 */
type Target = { cell: HTMLTableCellElement; tablePos: number; row: number; column: number };
type Open = { kind: "row" | "column" | "table" | "cell"; target: Target; anchor?: HTMLElement; point?: { x: number; y: number } };

function targetOf(view: EditorView, cell: Element | null | undefined): Target | null {
  if (!(cell instanceof HTMLTableCellElement) || !view.dom.contains(cell)) return null;
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
    for (let depth = $pos.depth; depth > 0; depth--)
      if ($pos.node(depth).type.spec.tableRole === "table") {
        // A nested table's controls would cover its parent's, as Linear hides them (`.tableContainer .tableContainer`).
        if (cell.parentElement!.closest("td, th")) return null;
        return { cell, tablePos: $pos.before(depth), row: (cell.parentElement as HTMLTableRowElement).rowIndex, column: cell.cellIndex };
      }
  } catch {
    /* A cell mid-update has no position yet. */
  }
  return null;
}
/** The caret's cell while the editor has focus. */
function caretCell(view: EditorView) {
  if (!view.hasFocus()) return null;
  const { $head } = view.state.selection;
  for (let depth = $head.depth; depth > 0; depth--)
    if ($head.node(depth).type.spec.tableRole?.endsWith("cell")) {
      const dom = view.nodeDOM($head.before(depth));
      return dom instanceof HTMLTableCellElement ? dom : null;
    }
  return null;
}

const rotated = (name: IconName, turn: 90 | 180 | 0 = 0) => (
  <span className="flex" style={turn ? { transform: `rotate(${turn}deg)` } : undefined}>
    <Icon name={name} size={16} />
  </span>
);

/** The menus, in Linear's groups and order; an entry whose command can't run here is left out, as Linear's `applicable`. */
function entries(view: EditorView, open: Open, close: () => void): ActionEntry[] {
  const run = (command: Command) => () => {
    command(view.state, view.dispatch, view);
    view.focus();
  };
  const can = (command: Command) => command(view.state, undefined, view);
  const { kind, target } = open,
    table = view.state.doc.nodeAt(target.tablePos)!;
  const copyTableEntry: ActionEntry = { name: "Copy table", icon: "copy", run: () => copyTable(view, target.tablePos) },
    selectEntry: ActionEntry = { name: "Select table", image: rotated("select"), run: run(selectTable(target.tablePos)) },
    removeEntry: ActionEntry = { name: "Remove table", icon: "trash", run: run(removeTable) };
  if (kind === "table") return [copyTableEntry, selectEntry, { ...removeEntry, divider: true }];
  const rect = selectedRect(view.state),
    lines = (axis: "row" | "column") => ((axis === "row" ? rect.bottom - rect.top : rect.right - rect.left) > 1 ? `${axis}s` : axis);
  const grid = !hasSpans(table),
    axes = grid ? (kind === "cell" ? (["row", "column"] as const) : [kind]) : [];
  const header: ActionEntry[] =
    grid && target.row === 0 && kind !== "column"
      ? [{ name: hasHeader(table) ? "Remove header" : "Add header", image: rotated("table-header"), run: run(toggleHeader) }]
      : [];
  const inserts = axes.flatMap((axis): ActionEntry[] =>
    axis === "row"
      ? [
          { name: "Insert row above", image: rotated("row-insert", 180), run: run(insertRowAbove) },
          { name: "Insert row below", image: rotated("row-insert"), run: run(insertRowBelow) },
        ]
      : [
          { name: "Insert column left", image: rotated("column-insert", 180), run: run(insertColumnLeft) },
          { name: "Insert column right", image: rotated("column-insert"), run: run(insertColumnRight) },
        ],
  );
  const moves = axes.flatMap((axis) =>
    (axis === "row"
      ? ([["up", moveRow("up"), "arrow-up"], ["down", moveRow("down"), "arrow-down"]] as const)
      : ([["left", moveColumn("left"), "arrow-left"], ["right", moveColumn("right"), "arrow-left"]] as const)
    )
      .filter(([, command]) => can(command))
      .map(([dir, command, icon]): ActionEntry => ({
        name: kind === "cell" ? `Move ${lines(axis)} ${dir}` : `Move ${dir}`,
        image: rotated(icon, dir === "right" ? 180 : 0),
        shortcut: editorKey(`table-move-${dir}`),
        run: run(command),
      })),
  );
  const deletes = axes
    .filter((axis) => can(axis === "row" ? deleteRow : deleteColumn))
    .map((axis): ActionEntry => ({
      name: `Delete ${lines(axis)}`,
      image: rotated(axis === "row" ? "row-delete" : "column-delete"),
      run: run(axis === "row" ? deleteRow : deleteColumn),
    }));
  // Linear's Format submenu: the marks over the row, column or clicked cell.
  const format: ActionEntry = {
    name: "Format",
    image: rotated("format"),
    children: (
      [
        ["Bold", "strong"],
        ["Italic", "em"],
        ["Underline", "underline"],
        ["Strikethrough", "strike"],
      ] as const
    ).map(([name, mark]) => ({
      name,
      shortcut: editorKey(mark),
      run: () => {
        // The cell menu formats its whole cell, as the row and column menus format their selected line.
        if (!(view.state.selection instanceof CellSelection))
          view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, view.posAtDOM(target.cell, 0) - 2)));
        run(toggleMark(richSchema.marks[mark]!))();
      },
    })),
  };
  const groups: ActionEntry[][] =
    kind === "cell"
      ? [
          header,
          inserts,
          moves.length ? [{ name: "Move", image: rotated("move"), children: moves }] : [],
          [format],
          [copyTableEntry, selectEntry],
          [...deletes, removeEntry],
        ]
      : [
          kind === "column"
            ? (["ascending", "descending"] as const).map((direction) => ({
                name: `Sort ${direction}`,
                image: rotated(direction === "ascending" ? "sort-asc" : "sort-desc"),
                run: run(sortRows(direction)),
              }))
            : header,
          [{ name: `Copy ${lines(kind)}`, icon: "copy", run: () => (copySelection(view), close()) }],
          inserts,
          moves,
          [format],
          deletes,
        ];
  return groups
    .filter((group) => group.length)
    .flatMap((group, index) => group.map((entry, i) => (index && !i ? { ...entry, divider: true } : entry)));
}

export function TableControls({ view, frame }: { view: EditorView; frame: RefObject<HTMLDivElement | null> }) {
  // Positions come from the editor's DOM on every render, which the React Compiler would cache on unchanged props.
  "use no memo";
  const [hovered, setHovered] = useState<HTMLTableCellElement | null>(null),
    [open, setOpen] = useState<Open | null>(null);
  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const move = (event: MouseEvent) => {
      const at = event.target as Element;
      if (at.closest?.("[data-table-control]")) return;
      setHovered(at.closest?.("td, th") as HTMLTableCellElement | null);
    };
    const leave = () => setHovered(null);
    // Linear's `i4e`: a right-click in a cell puts the caret there unless the selection already is, then opens the cell menu.
    const contextMenu = (event: MouseEvent) => {
      const target = targetOf(view, (event.target as Element).closest?.("td, th"));
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (!target.cell.contains(view.domAtPos(view.state.selection.head).node))
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.posAtDOM(target.cell, 0)))));
      view.focus();
      setOpen({ kind: "cell", target, point: { x: event.clientX + 3, y: event.clientY } });
    };
    box.addEventListener("mousemove", move);
    box.addEventListener("mouseleave", leave);
    view.dom.addEventListener("contextmenu", contextMenu);
    return () => {
      box.removeEventListener("mousemove", move);
      box.removeEventListener("mouseleave", leave);
      view.dom.removeEventListener("contextmenu", contextMenu);
    };
  }, [view, frame]);
  const target = open?.target.cell.isConnected ? open.target : targetOf(view, hovered?.isConnected ? hovered : caretCell(view));
  // The table grows after its own layout (a new row, a column dragged wider, an image loading), so measure again then.
  const tableDom = target?.cell.closest("table"),
    [, measure] = useState(0);
  useEffect(() => {
    if (!tableDom) return;
    const observer = new ResizeObserver(() => measure((n) => n + 1));
    observer.observe(tableDom);
    return () => observer.disconnect();
  }, [tableDom]);
  const box = frame.current?.getBoundingClientRect();
  if (!target || !box) return null;
  const table = tableDom!,
    wrapper = table.parentElement!.getBoundingClientRect(),
    whole = table.getBoundingClientRect(),
    row = target.cell.parentElement!.getBoundingClientRect(),
    cell = target.cell.getBoundingClientRect();
  // Clipped to the scroll wrapper, so a wide table's controls stay beside what shows.
  const left = Math.max(whole.left, wrapper.left) - box.left,
    right = Math.min(whole.right, wrapper.right) - box.left,
    top = whole.top - box.top,
    bottom = whole.bottom - box.top;
  const grid = !hasSpans(view.state.doc.nodeAt(target.tablePos)!);
  const close = () => {
    setOpen(null);
    view.focus();
  };
  const handle = (axis: "row" | "column", style: React.CSSProperties) => (
    <button
      type="button"
      data-table-control
      data-table-cell-control={axis}
      aria-label={`${axis === "row" ? "Row" : "Column"} actions`}
      aria-haspopup="menu"
      aria-expanded={open?.kind === axis}
      tabIndex={-1}
      className="rich-table-handle"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        const anchor = event.currentTarget;
        selectLine(target.tablePos, axis, axis === "row" ? target.row : target.column)(view.state, view.dispatch);
        view.focus();
        setOpen({ kind: axis, target, anchor });
      }}
    />
  );
  const edge = (label: string, style: React.CSSProperties, command: Command): ReactNode => (
    <button
      type="button"
      data-table-control
      aria-label={label}
      title={label}
      tabIndex={-1}
      className="rich-table-add"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => command(view.state, view.dispatch, view)}
    >
      <Icon name="plus" size={12} />
    </button>
  );
  return (
    <>
      {grid && handle("row", { left: left - 8 + 1, top: row.top - box.top, height: row.height })}
      {grid && handle("column", { left: cell.left - box.left, width: cell.width, top: top - 8 + 1 })}
      <IconButton
        label="Table actions"
        size="small"
        data-table-control
        aria-haspopup="menu"
        aria-expanded={open?.kind === "table"}
        className="rich-block-handle rich-table-menu-button"
        style={{ top: top + 4 }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => setOpen({ kind: "table", target, anchor: event.currentTarget })}
      >
        <Icon name="dots" />
      </IconButton>
      {edge("Add row", { left, width: right - left, top: bottom + 2 }, appendLine(target.tablePos, "row"))}
      {edge("Add column", { left: right + 2, top, height: bottom - top }, appendLine(target.tablePos, "column"))}
      {open && (
        <ActionMenu
          label={open.kind === "table" ? "Table actions" : open.kind === "cell" ? "Cell actions" : `${open.kind === "row" ? "Row" : "Column"} actions`}
          anchor={open.anchor}
          point={open.point}
          entries={entries(view, open, close)}
          close={close}
        />
      )}
    </>
  );
}
