import { createRoot } from "react-dom/client";
import type { Node as EditorNode } from "prosemirror-model";
import type { NodeView } from "prosemirror-view";
import type { MediaProps } from "./media-loader";
import { MediaView } from "./media-loader";
import { dragWidth, mediaContainerStyle, resizedMedia } from "./media-layout";
import type { AdfNode } from "./document";
export type MediaNodeView = NodeView & { updateContext: () => void };

/** Media remains an exact ADF atom, while controls isolate events and empty frame clicks select the atom. */
export function mediaNodeView(
  initial: EditorNode,
  context: () => Omit<MediaProps, "node">,
  onDestroy: () => void,
  /** Saves a resized mediaSingle; without it images keep their width. */
  resize?: (raw: AdfNode) => void,
): MediaNodeView {
  const dom = document.createElement(initial.isInline ? "span" : "div");
  dom.contentEditable = "false";
  // A resizable image keeps its media in an inner box, so the resize handles beside it stay outside React's root.
  const resizable = !!resize && initial.type.name === "mediaSingle",
    body = resizable ? document.createElement("div") : dom;
  if (resizable) dom.append(body, ...(["left", "right"] as const).map((side) => resizeHandle(side)));
  const root = createRoot(body);
  let current = initial,
    previous = context();
  const render = () => {
    dom.removeAttribute("style");
    Object.assign(dom.style, mediaContainerStyle(current.attrs.raw), resizable ? { position: "relative" } : {});
    root.render(<MediaView node={current.attrs.raw} {...previous} embedded />);
  };
  /** BJ-54: Linear's width handles at the image's sides; drag, or ←/→ by 5%. Jira keeps the width as a percentage. */
  function resizeHandle(side: "left" | "right") {
    const handle = document.createElement("div");
    handle.className = "media-resize-handle";
    handle.dataset.side = side;
    handle.dataset.mediaAction = "resize";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Resize image from the ${side}`);
    const column = () => dom.parentElement?.getBoundingClientRect().width ?? 1;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = dom.getBoundingClientRect().width,
        x = event.clientX,
        layout = current.attrs.raw?.attrs?.layout;
      let width = 0;
      const move = (e: PointerEvent) => {
        width = dragWidth(start, e.clientX - x, side, layout, column());
        dom.style.width = `${width}%`;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        if (width) resize!(resizedMedia(current.attrs.raw, width));
        else render();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const now = Math.round((dom.getBoundingClientRect().width / column()) * 100),
        by = (event.key === "ArrowRight") === (side === "right") ? 5 : -5;
      resize!(resizedMedia(current.attrs.raw, Math.max(10, Math.min(100, now + by))));
    });
    return handle;
  }
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
