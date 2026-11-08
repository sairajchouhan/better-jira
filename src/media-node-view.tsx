import { createRoot } from "react-dom/client";
import type { Node as EditorNode } from "prosemirror-model";
import type { NodeView } from "prosemirror-view";
import type { MediaProps } from "./media-loader";
import { MediaView } from "./media-loader";
import { mediaContainerStyle } from "./media-layout";
export type MediaNodeView = NodeView & { updateContext: () => void };

/** Media remains an exact ADF atom, while controls isolate events and empty frame clicks select the atom. */
export function mediaNodeView(
  initial: EditorNode,
  context: () => Omit<MediaProps, "node">,
  onDestroy: () => void,
): MediaNodeView {
  const dom = document.createElement(initial.isInline ? "span" : "div");
  dom.contentEditable = "false";
  const root = createRoot(dom);
  let current = initial,
    previous = context();
  const render = () => {
    dom.removeAttribute("style");
    Object.assign(dom.style, mediaContainerStyle(current.attrs.raw));
    root.render(<MediaView node={current.attrs.raw} {...previous} embedded />);
  };
  render();
  return {
    dom,
    stopEvent: (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-video-player][data-expanded="true"]')
      )
        return true;
      if (event.type === "mousedown" || event.type === "click")
        return !!(
          event.target instanceof Element &&
          event.target.closest(
            'button,a,input,select,textarea,video,audio,[role="button"],[data-media-action]',
          )
        );
      return true;
    },
    ignoreMutation: () => true,
    update(node) {
      if (node.type !== current.type) return false;
      if (!node.eq(current)) {
        current = node;
        render();
      }
      return true;
    },
    updateContext() {
      const next = context();
      if (next.issueKey !== previous.issueKey || next.attachments !== previous.attachments) {
        previous = next;
        render();
      }
    },
    destroy() {
      onDestroy();
      queueMicrotask(() => root.unmount());
    },
  };
}
