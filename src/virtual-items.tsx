/* oxlint-disable react/refs -- Layout measurements belong to the mounted collection. */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** A measured window within the existing scroll container. Groups and lanes keep their own geometry;
 * only their visible items mount. Small collections retain their normal DOM and native tab order. */
export function VirtualItems<T>({ items, itemKey, selected, estimate, children }: {
  items: T[];
  itemKey: (item: T) => string;
  selected: string | null;
  estimate: number;
  children: (item: T) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, bottom: 900 });
  const [revision, setRevision] = useState(0);
  const [dragged, setDragged] = useState<string | null>(null);
  const enabled = items.length > 20;
  const offsets = [0];
  for (const item of items) offsets.push(offsets.at(-1)! + (heights.current.get(itemKey(item)) ?? estimate));
  const selectedIndex = items.findIndex(item => itemKey(item) === selected);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !enabled) return;
    let scroller = node.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) return;
    const parent = scroller;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect(), clip = parent.getBoundingClientRect();
      setViewport({ top: clip.top - rect.top, bottom: clip.bottom - rect.top });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    parent.addEventListener("scroll", schedule, { passive: true });
    // An earlier group's measured height can move this group even without a scroll.
    const resize = new ResizeObserver(schedule);
    resize.observe(parent);
    resize.observe(parent.firstElementChild ?? parent);
    update();
    return () => { parent.removeEventListener("scroll", schedule); resize.disconnect(); cancelAnimationFrame(frame); };
  }, [enabled, items, revision]);
  useLayoutEffect(() => {
    if (!enabled || selectedIndex < 0 || !root.current) return;
    let parent = root.current.parentElement;
    while (parent && !/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    if (!parent) return;
    const rect = root.current.getBoundingClientRect(), clip = parent.getBoundingClientRect();
    const top = rect.top + offsets[selectedIndex]!, bottom = rect.top + offsets[selectedIndex + 1]!;
    if (top < clip.top) parent.scrollTop += top - clip.top;
    else if (bottom > clip.bottom) parent.scrollTop += bottom - clip.bottom;
    const updated = root.current.getBoundingClientRect();
    setViewport({ top: clip.top - updated.top, bottom: clip.bottom - updated.top });
    // Selection changes trigger scrolling; measuring or scrolling must not snap back to the selection.
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies
  }, [selected, enabled]);
  useLayoutEffect(() => {
    if (!enabled || !root.current) return;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualKey!;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (height > 0 && heights.current.get(key) !== height) { heights.current.set(key, height); changed = true; }
      }
      if (changed) setRevision(value => value + 1);
    });
    for (const child of root.current.querySelectorAll<HTMLElement>("[data-virtual-key]")) observer.observe(child);
    return () => observer.disconnect();
  });
  const overscan = estimate * 4;
  let start = 0, end = items.length;
  if (enabled) {
    while (start < items.length && offsets[start + 1]! < viewport.top - overscan) start++;
    end = start;
    while (end < items.length && offsets[end]! < viewport.bottom + overscan) end++;
  }
  const draggedIndex = items.findIndex(item => itemKey(item) === dragged);
  const pinned = draggedIndex >= 0 && (draggedIndex < start || draggedIndex >= end) ? draggedIndex : -1;
  const rendered = Array.from({ length: end - start }, (_, index) => start + index);
  if (pinned >= 0) rendered.push(pinned);
  return <div ref={root} data-virtual-items={enabled || undefined} style={{ position: "relative", overflowAnchor: "none" }}
    onDragStartCapture={event => setDragged((event.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key ?? null)}
    onDragEndCapture={() => setDragged(null)}>
    <div aria-hidden style={{ height: offsets[start] }} />
    {rendered.map(index => <div key={itemKey(items[index]!)} data-virtual-key={itemKey(items[index]!)} style={index === pinned ? { position: "absolute", top: offsets[index], width: "100%" } : undefined}>{children(items[index]!)}</div>)}
    <div aria-hidden style={{ height: offsets.at(-1)! - offsets[end]! }} />
  </div>;
}
