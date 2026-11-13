import { createContext, use, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import "./sortable.css";

/**
 * A vertical sortable list, as Linear builds its Group ordering panel with dnd-kit's SortableContext: each row moves by
 * its handle (`role=button`, `aria-roledescription="sortable"`), the dragged row follows the pointer and the rows it
 * passes slide out of its way, and the order changes only on drop. The keyboard works as dnd-kit's KeyboardSensor:
 * Space or Enter picks the row up, the arrow keys move it, Space or Enter drops it and Escape puts it back.
 */
type Drag = { id: string; from: number; to: number; height: number; startY: number; dy: number; by: "pointer" | "keyboard" };
type Context = {
  ids: readonly string[];
  drag: Drag | null;
  start: (drag: Drag) => void;
  update: (patch: Partial<Drag>) => void;
  drop: (commit: boolean) => void;
};
const SortableContext = createContext<Context | null>(null);
const useSortable = () => {
  const context = use(SortableContext);
  if (!context) throw new Error("Sortable parts render inside <Sortable>");
  return context;
};

/** Where the dragged row would land: `from` moved by whole rows, inside the list. */
export const dropIndex = (from: number, dy: number, height: number, count: number) =>
  Math.max(0, Math.min(count - 1, from + Math.round(dy / height)));

/** How far a row shifts while `drag` is under way: the dragged row by its pointer (or its keyboard slots), every row it
 *  passed by one row the other way. */
export function rowShift(index: number, drag: Drag | null): number {
  if (!drag) return 0;
  if (index === drag.from) return drag.by === "pointer" ? drag.dy : (drag.to - drag.from) * drag.height;
  if (drag.from < index && index <= drag.to) return -drag.height;
  if (drag.to <= index && index < drag.from) return drag.height;
  return 0;
}

function Sortable({
  ids,
  onMove,
  children,
}: {
  /** The rows' ids in their shown order. */
  ids: readonly string[];
  /** A drop that changed the order: `id` lands on `target`'s slot. */
  onMove: (id: string, target: string) => void;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const context: Context = {
    ids,
    drag,
    start: setDrag,
    update: (patch) => setDrag((d) => (d ? { ...d, ...patch } : d)),
    drop: (commit) => {
      if (commit && drag && drag.to !== drag.from) onMove(drag.id, ids[drag.to]!);
      setDrag(null);
    },
  };
  return (
    <SortableContext value={context}>
      <div className="ui-sortable" data-dragging={drag ? "" : undefined}>
        {children}
      </div>
    </SortableContext>
  );
}

const ItemContext = createContext<{ id: string; index: number } | null>(null);

/** One row: shifted while a drag passes it, lifted while it is the one dragged. Renders its Handle among its children. */
function Item({ id, className = "", children }: { id: string; className?: string; children: ReactNode }) {
  const { ids, drag } = useSortable();
  const index = ids.indexOf(id);
  const shift = rowShift(index, drag);
  const dragged = drag?.id === id;
  return (
    <ItemContext value={{ id, index }}>
      <div
        tabIndex={-1}
        data-sortable-item={id}
        data-dragged={dragged ? drag.by : undefined}
        className={`ui-sortable-item ${className}`}
        style={shift ? ({ transform: `translate3d(0, ${shift}px, 0)` } as CSSProperties) : undefined}
      >
        {children}
      </div>
    </ItemContext>
  );
}

/** The row's drag handle. `label` names it for screen readers. */
function Handle({ label, children }: { label?: string; children: ReactNode }) {
  const { ids, drag, start, update, drop } = useSortable();
  const item = use(ItemContext);
  if (!item) throw new Error("Sortable.Handle renders inside Sortable.Item");
  const mine = drag?.id === item.id;
  const rowHeight = (node: Element) => node.closest(".ui-sortable-item")?.getBoundingClientRect().height ?? 32;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start({ id: item.id, from: item.index, to: item.index, height: rowHeight(e.currentTarget), startY: e.clientY, dy: 0, by: "pointer" });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!mine || drag.by !== "pointer") return;
    const dy = e.clientY - drag.startY;
    update({ dy, to: dropIndex(drag.from, dy, drag.height, ids.length) });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const pick = e.key === " " || e.key === "Enter";
    if (!mine) {
      if (!pick || drag) return;
      e.preventDefault();
      start({ id: item.id, from: item.index, to: item.index, height: rowHeight(e.currentTarget), startY: 0, dy: 0, by: "keyboard" });
      return;
    }
    if (pick || e.key === "Escape") {
      // Escape puts the row back without closing the popup around the list.
      e.preventDefault();
      e.stopPropagation();
      drop(pick);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      update({ to: Math.max(0, Math.min(ids.length - 1, drag.to + (e.key === "ArrowUp" ? -1 : 1))) });
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-roledescription="sortable"
      aria-pressed={mine || undefined}
      className="ui-sortable-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => mine && drop(true)}
      onPointerCancel={() => mine && drop(false)}
      onKeyDown={onKeyDown}
      onBlur={() => mine && drag.by === "keyboard" && drop(false)}
    >
      {children}
    </div>
  );
}

/** Linear's drag-handle glyph: two columns of three dots, 6 x 10. */
function Grip() {
  return (
    <svg aria-hidden width="6" height="10" viewBox="0 0 6 10" fill="currentColor" className="ui-sortable-grip">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM1 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM1 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
      />
    </svg>
  );
}

Sortable.Item = Item;
Sortable.Handle = Handle;
Sortable.Grip = Grip;
export { Sortable };
