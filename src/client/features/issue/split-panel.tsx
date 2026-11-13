import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { ResizeHandle, ResizeTooltip, useResize } from "@/client/components/resize-handle";
import { readSplitPanelWidth, splitPanelLayout, writeSplitPanelWidth } from "./split-panel-layout";

/** The width of `node`'s parent, kept current by a ResizeObserver; 0 until measured, which happens before the first paint. */
function useParentWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(parent);
    // oxlint-disable-next-line react/set-state-in-effect -- a layout read, so the first paint already has the panel's width
    setWidth(parent.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Linear's board split panel (IssueList `Df`): beside the board at the saved width, clamped to its limits as the window
 * changes, with a resize handle on its left edge. Dragging resizes the panel live (the board beside it reflows) and saves
 * every frame; a click on the handle closes the panel. A container too narrow for the panel and the board gets the panel
 * over the whole page, without a handle.
 */
export function SplitPanel({
  className,
  onClose,
  children,
  ...props
}: { className: string; onClose: () => void; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, "className">) {
  const [ref, containerWidth] = useParentWidth();
  const [saved, setSaved] = useState(readSplitPanelWidth);
  const measured = containerWidth > 0;
  const layout = splitPanelLayout(measured ? containerWidth : Infinity, saved);
  const fillsPage = measured && layout.fillsPage;
  const save = (width: number) => {
    setSaved(width);
    writeSplitPanelWidth(width);
  };
  const { onMouseDown, onTouchStart, dragging } = useResize({
    growDirection: "left",
    getCurrentWidth: () => layout.width,
    onClick: onClose,
    onResize: save,
    onResizeEnd: save,
    min: layout.min,
    max: layout.max,
  });
  return (
    <aside
      ref={ref}
      className={`${className} ${fillsPage ? "absolute inset-0 z-20 w-full" : "relative shrink-0 border-l border-line"}`}
      style={fillsPage ? undefined : { width: layout.width }}
      data-fills-page={fillsPage || undefined}
      {...props}
    >
      {children}
      {measured && !fillsPage ? (
        <ResizeHandle
          growDirection="left"
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          dragging={dragging}
          tooltip={<ResizeTooltip />}
          style={{ left: -3 }}
        />
      ) : null}
    </aside>
  );
}
