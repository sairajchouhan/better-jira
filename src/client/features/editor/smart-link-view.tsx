import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Node as EditorNode } from "prosemirror-model";
import type { NodeView } from "prosemirror-view";
import { SmartLink, smartLinkWrapper } from "./smart-link";
import { embedSource } from "./embed";

/** A smart link in the editor: the same chip as the read-only document, an atom whose URL and Jira node never change here,
 *  so the node written back is the one Jira sent (BJ-16). An embedCard that can be framed keeps the schema's iframe. */
export function smartLinkNodeView(node: EditorNode): NodeView | undefined {
  const data = node.attrs.original?.data,
    url = data?.attrs?.url;
  if (node.type.name === "embedCard" && embedSource(String(url ?? ""))) return;
  const { tag, className } = smartLinkWrapper(!node.isInline);
  const dom = document.createElement(tag);
  dom.className = className;
  dom.contentEditable = "false";
  const root = createRoot(dom);
  const render = () => root.render(<SmartLink url={url} data={data?.attrs?.data} />);
  // Rendered before the browser paints (the view is built in a layout effect, so not inside React's own render), so the
  // editor's first frame has the chip at its size and swapping the stand-in for the editor moves nothing (BJ-198).
  queueMicrotask(() => flushSync(render));
  let current = node;
  return {
    dom,
    ignoreMutation: () => true,
    update(next) {
      if (next.type !== current.type || next.attrs.original !== current.attrs.original) return false;
      current = next;
      return true;
    },
    destroy() {
      queueMicrotask(() => root.unmount());
    },
  };
}
