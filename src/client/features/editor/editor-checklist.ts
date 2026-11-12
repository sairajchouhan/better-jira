import { chainCommands } from "prosemirror-commands";
import { InputRule } from "prosemirror-inputrules";
import { Fragment, type Node as EditorNode } from "prosemirror-model";
import { NodeSelection, TextSelection, type Command, type Transaction } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { toggleList } from "./editor-commands";
import { richSchema } from "./rich-document";

// Linear's checklist (todo_list) is Jira's taskList: items of one line each, TODO or DONE.
const nodes = richSchema.nodes,
  taskList = nodes.taskList!,
  taskItem = nodes.taskItem!,
  paragraph = nodes.paragraph!,
  heading = nodes.heading!,
  listItem = nodes.listItem!,
  bulletList = nodes.bulletList!,
  orderedList = nodes.orderedList!;

/** Puts the caret in the `index`th text block inside the node at `at`, `offset` characters in. */
function caretIn(tr: Transaction, at: number, index: number, offset: number) {
  let seen = 0,
    found = -1;
  tr.doc.nodeAt(at)?.descendants((node, pos) => {
    if (found >= 0) return false;
    if (!node.isTextblock) return true;
    if (seen++ === index) found = at + 1 + pos + 1 + Math.min(offset, node.content.size);
    return false;
  });
  if (found >= 0) tr.setSelection(TextSelection.create(tr.doc, found));
  return tr;
}
/** Which text block of `node` (at `at`) holds `pos`, in document order. */
function textblockIndex(node: EditorNode, at: number, pos: number) {
  let index = -1,
    seen = 0;
  node.descendants((child, offset) => {
    if (index >= 0) return false;
    if (!child.isTextblock) return true;
    const start = at + 1 + offset;
    if (pos >= start && pos <= start + child.nodeSize) index = seen;
    seen++;
    return false;
  });
  return Math.max(0, index);
}
const textOf = (block: EditorNode) =>
  block.type.spec.code ? (block.textContent ? Fragment.from(richSchema.text(block.textContent)) : Fragment.empty) : block.content;

/** The selected items of a checklist become paragraphs where it stood, splitting it around them (Linear's lift). */
const liftTasks: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if ($from.parent.type !== taskItem) return false;
  const depth = $from.depth - 1,
    list = $from.node(depth),
    start = $from.index(depth),
    end = $to.parent.type === taskItem && $to.before(depth) === $from.before(depth) ? $to.index(depth) + 1 : start + 1;
  const before: EditorNode[] = [],
    lifted: EditorNode[] = [],
    after: EditorNode[] = [];
  list.forEach((item, _offset, i) => (i < start ? before : i < end ? lifted : after).push(item));
  const nodes = [
    ...(before.length ? [list.copy(Fragment.from(before))] : []),
    ...lifted.map((item) => paragraph.create(null, item.content)),
    // A new list: the half after keeps none of the original's Jira localId.
    ...(after.length ? [taskList.create(null, after)] : []),
  ];
  const parent = $from.node(depth - 1),
    index = $from.index(depth - 1);
  if (!parent.canReplace(index, index + 1, Fragment.from(nodes))) return false;
  if (dispatch) {
    // Lifted text keeps its place: the list's opening goes, and a list left before it closes first.
    const shift = before.length ? 1 : -1,
      tr = state.tr.replaceWith($from.before(depth), $from.after(depth), nodes);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.pos + shift, $to.pos + shift)).scrollIntoView());
  }
  return true;
};

/** A checklist becomes a bulleted or numbered list (each item one paragraph). */
const tasksToList =
  (name: "bulletList" | "orderedList"): Command =>
  (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.parent.type !== taskItem) return false;
    const depth = $from.depth - 1,
      list = $from.node(depth),
      at = $from.before(depth),
      items: EditorNode[] = [];
    list.forEach((item) => items.push(listItem.create(null, paragraph.create(null, item.content))));
    if (dispatch) {
      const tr = state.tr.replaceWith(at, $from.after(depth), richSchema.nodes[name]!.create(null, items));
      dispatch(caretIn(tr, at, $from.index(depth), $from.parentOffset).scrollIntoView());
    }
    return true;
  };

/** ⌘⇧7, the slash Checklist and the toolbar's list menu: in a checklist its selected items become text; a bulleted or numbered
 * list becomes a checklist (every line an item); selected paragraphs and headings become one. */
export const toggleChecklist: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if ($from.parent.type === taskItem) return liftTasks(state, dispatch);
  for (let depth = $from.depth; depth > 0; depth--) {
    const list = $from.node(depth);
    if (list.type !== bulletList && list.type !== orderedList) continue;
    const items: EditorNode[] = [];
    list.descendants((node) => (node.isTextblock ? (items.push(taskItem.create(null, textOf(node))), false) : true));
    const at = $from.before(depth),
      parent = $from.node(depth - 1),
      index = $from.index(depth - 1);
    if (!parent.canReplaceWith(index, index + 1, taskList)) return false;
    if (dispatch) {
      const tr = state.tr.replaceWith(at, $from.after(depth), taskList.create(null, items));
      dispatch(caretIn(tr, at, textblockIndex(list, at, $from.pos), $from.parentOffset).scrollIntoView());
    }
    return true;
  }
  const range = $from.blockRange($to);
  if (!range) return false;
  const blocks: EditorNode[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) blocks.push(range.parent.child(i));
  if (
    blocks.some((block) => block.type !== paragraph && block.type !== heading) ||
    !range.parent.canReplaceWith(range.startIndex, range.endIndex, taskList)
  )
    return false;
  if (dispatch) {
    // Each block keeps its size as an item, so the selection moves by the list's opening only.
    const tr = state.tr.replaceWith(
      range.start,
      range.end,
      taskList.create(null, blocks.map((block) => taskItem.create(null, block.content))),
    );
    dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.pos + 1, $to.pos + 1)).scrollIntoView());
  }
  return true;
};

/** Any list command: a checklist toggles as above; a bulleted or numbered one from a checklist converts it first. */
export const setList = (name: "bulletList" | "orderedList" | "taskList"): Command =>
  name === "taskList" ? toggleChecklist : chainCommands(tasksToList(name), toggleList(name));

/** ⌘↵ in a checklist item ticks it (or unticks it); with several selected, all follow the first unticked one. */
export const toggleTask: Command = (state, dispatch) => {
  const items: { pos: number; node: EditorNode }[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type === taskItem) items.push({ pos, node });
    return !node.isTextblock;
  });
  if (!items.length) return false;
  const done = items.some(({ node }) => node.attrs.state !== "DONE") ? "DONE" : "TODO";
  if (dispatch) {
    const tr = state.tr;
    for (const { pos, node } of items) tr.setNodeMarkup(pos, undefined, { ...node.attrs, state: done });
    dispatch(tr);
  }
  return true;
};

/** Enter in an item starts a new unticked one; in an empty item it leaves the checklist (the item becomes a paragraph). */
export const taskEnter: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type !== taskItem || state.selection.$to.parent !== $from.parent) return false;
  if (!$from.parent.content.size) return liftTasks(state, dispatch);
  if (dispatch) {
    const tr = state.tr.deleteSelection(),
      pos = tr.selection.from;
    tr.split(pos, 1, [{ type: taskItem, attrs: { state: "TODO" } }]);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView());
  }
  return true;
};

/** Backspace at an item's start turns it into a paragraph. */
export const taskBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  return empty && $from.parent.type === taskItem && !$from.parentOffset && liftTasks(state, dispatch);
};

/** `[ ]` or `[]` at a paragraph's start makes it a checklist item (Linear fires on the `]`). */
export const checklistRule = new InputRule(/^\s*\[ ?\]$/, (state, _match, start, end) => {
  const $start = state.doc.resolve(start);
  if ($start.parent.type !== paragraph) return null;
  const parent = $start.node(-1),
    index = $start.index(-1);
  if (!parent.canReplaceWith(index, index + 1, taskList)) return null;
  const rest = $start.parent.content.cut(end - $start.start()),
    tr = state.tr.replaceWith($start.before(), $start.after(), taskList.create(null, taskItem.create(null, rest)));
  return tr.setSelection(TextSelection.create(tr.doc, $start.before() + 2));
});

// Linear's todo drag handle: six dots, 6×10.
const HANDLE =
  "M1 8C1.55228 8 2 8.44772 2 9C2 9.55228 1.55228 10 1 10C0.447715 10 0 9.55228 0 9C0 8.44772 0.447715 8 1 8ZM5 8C5.55228 8 6 8.44772 6 9C6 9.55228 5.55228 10 5 10C4.44772 10 4 9.55228 4 9C4 8.44772 4.44772 8 5 8ZM1 4C1.55228 4 2 4.44772 2 5C2 5.55228 1.55228 6 1 6C0.447715 6 0 5.55228 0 5C0 4.44772 0.447715 4 1 4ZM5 4C5.55228 4 6 4.44772 6 5C6 5.55228 5.55228 6 5 6C4.44772 6 4 5.55228 4 5C4 4.44772 4.44772 4 5 4ZM1 0C1.55228 0 2 0.447715 2 1C2 1.55228 1.55228 2 1 2C0.447715 2 0 1.55228 0 1C0 0.447715 0.447715 0 1 0ZM5 0C5.55228 0 6 0.447715 6 1C6 1.55228 5.55228 2 5 2C4.44772 2 4 1.55228 4 1C4 0.447715 4.44772 0 5 0Z";

/** Linear's todo item: a drag handle and a checkbox in the gutter, then the item's text. The same markup the read-only view draws. */
export function taskItemView(initial: EditorNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement("li"),
    gutter = document.createElement("div"),
    handle = document.createElement("span"),
    box = document.createElement("div"),
    contentDOM = document.createElement("div");
  gutter.className = "todo-checkbox-container";
  gutter.contentEditable = "false";
  handle.className = "todo-drag-handle";
  handle.draggable = true;
  handle.innerHTML = `<svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" aria-hidden="true"><path d="${HANDLE}"/></svg>`;
  box.className = "todo-checkbox";
  box.setAttribute("role", "checkbox");
  box.setAttribute("aria-label", "Checklist item");
  contentDOM.className = "todo-content";
  gutter.append(handle, box);
  dom.append(gutter, contentDOM);
  let current = initial;
  const show = (node: EditorNode) => {
    const done = node.attrs.state === "DONE";
    dom.dataset.taskState = node.attrs.state;
    dom.dataset.done = String(done);
    box.setAttribute("aria-checked", String(done));
  };
  show(initial);
  // The checkbox never takes the caret or focus; a click ticks the item.
  gutter.addEventListener("mousedown", (event) => {
    if (event.target !== handle && !handle.contains(event.target as Node)) event.preventDefault();
  });
  box.addEventListener("click", () => {
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...current.attrs,
        state: current.attrs.state === "DONE" ? "TODO" : "DONE",
      }),
    );
  });
  // Dragging the handle drags the item: ProseMirror's own drag then moves the selected node.
  handle.addEventListener("dragstart", () => {
    const pos = getPos();
    if (pos !== undefined) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  });
  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== current.type) return false;
      current = next;
      show(next);
      return true;
    },
    stopEvent: (event) => gutter.contains(event.target as Node) && !event.type.startsWith("drag"),
    ignoreMutation: (mutation) =>
      mutation.type !== "selection" && (mutation.type === "attributes" || gutter.contains(mutation.target)),
  };
}
