import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip, useTooltip } from "./tooltip";
import { TOOLTIP_TIMING } from "./tooltip-rules";
import "./resize-handle.css";

/** Which way the resized side grows as the pointer moves right: a panel on the right edge grows `left`. */
export type GrowDirection = "left" | "right";

type Gesture = { clientX: number; pointer: "mouse" } | { clientX: number; pointer: "touch"; touch: number };

/** Linear's `MTe`: how long a single click waits to see whether it is the first half of a double click. */
const CLICK_DELAY = 200;

/**
 * Linear's resize gesture (`z_`), shared by every resizable pane: a press starts it, the first move makes it a drag
 * (`onResizeStart`), each move reports `start ± dx` clamped to min/max once per frame, and release reports the last
 * width to `onResizeEnd`. A press released without moving is a click: `onClick` after 200ms unless a second click
 * turns it into `onDoubleClick` (`jTe`). A tap without moving clicks at once.
 */
export function useResize(options: {
  growDirection: GrowDirection;
  getCurrentWidth: () => number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onResizeStart?: () => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  min?: number;
  max?: number;
}) {
  const [gesture, setGesture] = useState<Gesture>();
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clamp = (width: number) => Math.max(options.min ?? 0, Math.min(width, options.max ?? Infinity));
  const resize = useEffectEvent((width: number) => options.onResize(clamp(width)));
  const end = useEffectEvent((width: number) => options.onResizeEnd(clamp(width)));
  const start = useEffectEvent(() => options.onResizeStart?.());
  const currentWidth = useEffectEvent(() => options.getCurrentWidth());
  const direction = options.growDirection === "left" ? -1 : 1;
  const click = useEffectEvent((detail?: number) => {
    clearTimeout(clickTimer.current);
    if (detail === undefined) return options.onClick?.();
    if (detail === 1) clickTimer.current = setTimeout(() => options.onClick?.(), CLICK_DELAY);
    if (detail % 2 === 0) options.onDoubleClick?.();
  });

  useEffect(() => () => clearTimeout(clickTimer.current), []);
  useEffect(() => {
    if (!gesture) return;
    const from = currentWidth();
    let moved = false;
    let frame: number | undefined;
    let pending = from;
    // `kTe`: moves inside one frame collapse to the last, drawn on the next animation frame.
    const schedule = (width: number) => {
      pending = width;
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        resize(pending);
      });
    };
    const flush = () => {
      if (frame === undefined) return;
      cancelAnimationFrame(frame);
      frame = undefined;
      resize(pending);
    };
    const move = (clientX: number) => {
      if (!moved) {
        moved = true;
        start();
      }
      schedule(from + direction * (clientX - gesture.clientX));
    };
    const finish = (width: number) => {
      flush();
      end(width);
    };
    const stop = () => setGesture(undefined);
    if (gesture.pointer === "mouse") {
      const onMove = (event: globalThis.MouseEvent) => move(event.clientX);
      const onUp = (event: globalThis.MouseEvent) => {
        if (moved) finish(from + direction * (event.clientX - gesture.clientX));
        else click(event.detail);
        stop();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
    }
    const own = (event: TouchEvent) => [...event.changedTouches].find((t) => t.identifier === gesture.touch);
    const onMove = (event: TouchEvent) => {
      const touch = own(event);
      if (touch) move(touch.clientX);
    };
    const onEnd = (event: TouchEvent) => {
      if (!own(event)) return;
      if (moved) finish(pending);
      else click();
      stop();
    };
    const onCancel = (event: TouchEvent) => {
      if (!own(event)) return;
      if (moved) finish(pending);
      stop();
    };
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [gesture, direction]);

  return {
    dragging: gesture !== undefined,
    onMouseDown: (event: MouseEvent) => {
      if (event.button === 0) setGesture({ clientX: event.clientX, pointer: "mouse" });
    },
    onTouchStart: (event: ReactTouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (touch) setGesture({ clientX: touch.clientX, pointer: "touch", touch: touch.identifier });
    },
  };
}

/** Linear's `LTe`: while a drag runs, the whole page shows the col-resize cursor and selects no text. */
function useDragCursor(dragging: boolean) {
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("resize-dragging");
    return () => document.body.classList.remove("resize-dragging");
  }, [dragging]);
}

/** The edge tooltip's gap: Linear's `V_.tooltip` sits 16px from the handle's near edge on the panel's outer side, and the anchor
 *  spans the 7px handle, so the surface is 9px off it. */
const EDGE_TOOLTIP_OFFSET = 16 - 7;
/** `B_`: the tooltip's top is the pointer's, kept 36px inside the window (`clamp(y - top, 36, innerHeight - 36)`). */
const EDGE_TOOLTIP_INSET = 36;

/**
 * Linear's vertical resize handle (`B_`): a 7px col-resize strip whose hairline track fades in on hover (.1s delay, .25s)
 * and stays while dragging, with a brighter segment that follows the pointer. During a drag a fixed full-window layer
 * keeps the pointer off iframes and text. Its `tooltip` is the app's one tooltip in its edge form: 450ms after the pointer
 * enters (`B_`'s one timer), beside the handle at the pointer's height, hidden by a press. Place it with `style` (the
 * panel's edge sits 3px into it).
 */
export function ResizeHandle({
  growDirection,
  tooltip,
  ...strip
}: {
  growDirection: GrowDirection;
  dragging: boolean;
  onMouseDown: (event: MouseEvent) => void;
  onTouchStart: (event: ReactTouchEvent) => void;
  onDoubleClick?: () => void;
  tooltip: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <Tooltip.Root timing={TOOLTIP_TIMING.edge}>
      <HandleStrip {...strip} />
      <Tooltip.Surface
        placement={growDirection === "left" ? "left" : "right"}
        fallbacks={[]}
        offset={EDGE_TOOLTIP_OFFSET}
        className="app-tooltip resize-tooltip"
      >
        {tooltip}
      </Tooltip.Surface>
    </Tooltip.Root>
  );
}

/** The strip itself, reporting the pointer to its tooltip. An invisible anchor across the strip sits at the pointer's height
 *  until the tooltip opens, so it opens there and stays put. */
function HandleStrip({
  dragging,
  onMouseDown,
  onTouchStart,
  onDoubleClick,
  style,
  className = "",
}: {
  dragging: boolean;
  onMouseDown: (event: MouseEvent) => void;
  onTouchStart: (event: ReactTouchEvent) => void;
  onDoubleClick?: () => void;
  style?: CSSProperties;
  className?: string;
}) {
  const { isOpen, triggerRef, actions } = useTooltip();
  const handle = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  useDragCursor(dragging);

  // `NTe`: the indicator is centred on the pointer inside the track.
  const follow = (clientY: number) => {
    const t = track.current,
      i = indicator.current;
    if (!t || !i) return;
    const { top, height } = t.getBoundingClientRect();
    i.style.transform = `translate3d(0, ${Math.max(0, Math.min(clientY - top, height)) - height / 2}px, 0)`;
  };
  const onMove = (event: MouseEvent) => {
    follow(event.clientY);
    const anchor = triggerRef.current,
      node = handle.current;
    if (anchor && node && !isOpen) {
      const top = event.clientY - node.getBoundingClientRect().top;
      anchor.style.top = `${Math.max(EDGE_TOOLTIP_INSET, Math.min(top, innerHeight - EDGE_TOOLTIP_INSET))}px`;
    }
    actions.move();
  };

  return (
    <>
      {dragging ? createPortal(<div className="resize-drag-layer" onMouseMove={(event) => follow(event.clientY)} />, document.body) : null}
      <div
        ref={handle}
        className={`resize-handle ${className}`}
        data-dragging={dragging || undefined}
        style={style}
        onMouseEnter={(event) => {
          onMove(event);
          if (!dragging) actions.enter();
        }}
        onMouseMove={onMove}
        onMouseLeave={() => actions.leave()}
        onMouseDown={(event) => {
          actions.close();
          onMouseDown(event);
        }}
        onDoubleClick={onDoubleClick}
        onTouchStart={(event) => {
          actions.close();
          indicator.current?.style.removeProperty("transform");
          onTouchStart(event);
        }}
      >
        <div ref={track} className="resize-track" aria-hidden="true">
          <div ref={indicator} className="resize-indicator" />
        </div>
        <span ref={triggerRef as RefObject<HTMLSpanElement | null>} className="resize-tooltip-anchor" aria-hidden="true" />
      </div>
    </>
  );
}

/** Linear's `n1` with its defaults: what dragging and clicking a collapsible pane's edge do. */
export function ResizeTooltip() {
  return (
    <>
      <span>
        <strong>Drag</strong> to resize
      </span>
      <span>
        <strong>Click</strong> to collapse
      </span>
    </>
  );
}
