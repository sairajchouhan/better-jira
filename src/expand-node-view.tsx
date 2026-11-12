import { createRoot } from "react-dom/client";
import type { Node as EditorNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { IconButton } from "./button";
import { Icon } from "./icons";

/** A collapsible section (Jira's expand): a disclosure and a title above its editable blocks. Jira stores no open state,
 * so a section shows collapsed when loaded and open when just made (empty). */
export function expandNodeView(
  initial: EditorNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("div"),
    header = document.createElement("div"),
    contentDOM = document.createElement("div");
  dom.className = "rich-expand";
  header.className = "rich-expand-header";
  header.contentEditable = "false";
  contentDOM.className = "rich-expand-body";
  dom.append(header, contentDOM);
  const root = createRoot(header);
  let current = initial,
    open = !initial.textContent && initial.childCount === 1,
    // Remounts the title field only when the title changed elsewhere (undo), so typing keeps its caret.
    revision = 0,
    typed = initial.attrs.title as string;
  const setTitle = (title: string) => {
    const pos = getPos();
    typed = title;
    if (pos !== undefined)
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, title }));
  };
  const render = () => {
    dom.dataset.open = String(open);
    contentDOM.hidden = !open;
    root.render(
      <>
        <IconButton
          label={open ? "Collapse section" : "Expand section"}
          aria-expanded={open}
          size="small"
          className="rich-expand-toggle"
          onClick={() => {
            open = !open;
            render();
          }}
        >
          <Icon name="chevron" size={14} />
        </IconButton>
        {/* A bare title line, like a heading in the document, not a boxed form field. */}
        <input
          key={revision}
          className="rich-expand-title"
          aria-label="Collapsible section title"
          placeholder="Add section title…"
          defaultValue={current.attrs.title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== "ArrowDown") return;
            event.preventDefault();
            open = true;
            render();
            const pos = getPos();
            if (pos === undefined) return;
            view.focus();
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))));
          }}
        />
      </>,
    );
  };
  render();
  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== current.type) return false;
      if (next.attrs.title !== typed) {
        typed = next.attrs.title;
        revision++;
      }
      current = next;
      render();
      return true;
    },
    stopEvent: (event) => header.contains(event.target as Node),
    ignoreMutation: (mutation) =>
      header.contains(mutation.target) || (mutation.type === "attributes" && (mutation.target === dom || mutation.target === contentDOM)),
    destroy: () => queueMicrotask(() => root.unmount()),
  };
}
