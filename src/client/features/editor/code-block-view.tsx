import { createRoot } from "react-dom/client";
import type { Node as EditorNode } from "prosemirror-model";
import type { Decoration, EditorView, NodeView } from "prosemirror-view";
import { CodeBlockControls, codeBlockAttributes, codeDisplay, measureGutter } from "./code-block";
import { detectedOf } from "./code-block-editing";
import { COLLAPSE_LINES, lineStarts } from "./code-languages";

/**
 * A code block in the editor (Linear's `r2e` node view): the line-number gutter and the toolbar sit beside the editable
 * <code>, outside ProseMirror's content. Collapsing is this view's own state, like Linear's per-block map.
 */
export function codeBlockNodeView(
  initial: EditorNode,
  view: EditorView,
  getPos: () => number | undefined,
  decorations: readonly Decoration[],
): NodeView {
  const dom = document.createElement("pre"),
    gutter = document.createElement("div"),
    code = document.createElement("code"),
    controls = document.createElement("div");
  dom.className = "code-block";
  gutter.className = "cb-gutter";
  gutter.contentEditable = "false";
  gutter.setAttribute("aria-hidden", "true");
  controls.className = "cb-controls";
  controls.contentEditable = "false";
  dom.append(gutter, code, controls);
  const root = createRoot(controls);
  let current = initial,
    detected = detectedOf(decorations),
    collapsed = lineStarts(initial.textContent).length >= COLLAPSE_LINES;
  const edit = (change: (pos: number) => void) => {
    const pos = getPos();
    if (pos !== undefined) change(pos);
    view.focus();
  };
  const setCollapsed = (next: boolean) => {
    collapsed = next;
    render();
  };
  const measure = () => measureGutter(gutter, code, codeDisplay.get().lineWrap);
  const resize = new ResizeObserver(measure);
  function render() {
    const text = current.textContent,
      lines = lineStarts(text).length,
      display = codeDisplay.get();
    for (const [name, value] of Object.entries(codeBlockAttributes(lines, collapsed, display)))
      if (value) dom.setAttribute(name, value);
      else dom.removeAttribute(name);
    while (gutter.childElementCount < lines) {
      const row = document.createElement("div");
      row.textContent = String(gutter.childElementCount + 1);
      gutter.append(row);
    }
    while (gutter.childElementCount > lines) gutter.lastElementChild!.remove();
    if (display.lineWrap) resize.observe(code);
    else resize.disconnect();
    if (display.lineWrap) requestAnimationFrame(measure);
    else measure();
    root.render(
      <CodeBlockControls
        text={text}
        language={current.attrs.language ?? null}
        detected={current.attrs.language == null ? detected : null}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        setLanguage={(language) =>
          edit((pos) => view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language })))
        }
        remove={() => edit((pos) => view.dispatch(view.state.tr.delete(pos, pos + current.nodeSize)))}
      />,
    );
  }
  // A click on a collapsed block's code expands it (Linear's pointer cursor over the fade).
  dom.addEventListener("mousedown", (event) => {
    if (collapsed && code.contains(event.target as Node)) setCollapsed(false);
  });
  const unsubscribe = codeDisplay.subscribe(render);
  render();
  return {
    dom,
    contentDOM: code,
    update(node, next) {
      if (node.type !== current.type) return false;
      current = node;
      detected = detectedOf(next);
      render();
      return true;
    },
    stopEvent: (event) => controls.contains(event.target as Node),
    ignoreMutation: (mutation) => mutation.type !== "selection" && !code.contains(mutation.target),
    destroy() {
      unsubscribe();
      resize.disconnect();
      // Unmounting while React renders (a toolbar click that deleted the block) is deferred.
      queueMicrotask(() => root.unmount());
    },
  };
}
