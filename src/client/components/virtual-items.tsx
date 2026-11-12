/* oxlint-disable react/refs -- Layout measurements belong to the mounted collection. */
import { useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";

const keyOf = (node: EventTarget | null) =>
  (node as HTMLElement | null)?.closest?.<HTMLElement>("[data-virtual-key]")?.dataset.virtualKey ?? null;

/** A measured window within the existing scroll container (BJ-111). Groups, lanes and columns keep their own geometry;
 *  only the items near the viewport mount. The selected, focused and dragged items always stay mounted, so selection
 *  scrolling, menu anchors, focus and an in-flight drag keep their element. */
export function VirtualItems<T>({ items, itemKey, selected, estimate, children }: {
  items: T[];
  itemKey: (item: T) => string;
  selected: string | null;
  estimate: number;
  children: (item: T) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const heights = useRef(new Map<string, number>());
  // Unknown until the first layout effect measures it, so a new collection mounts no items it would drop before paint.
  const [viewport, setViewport] = useState<{ top: number; bottom: number } | null>(null);
  const [, setRevision] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const offsets = [0];
  for (const item of items) offsets.push(offsets.at(-1)! + (heights.current.get(itemKey(item)) ?? estimate));
  const measure = () => {
    const node = root.current, parent = scroller.current;
    if (!node || !parent) return;
    const rect = node.getBoundingClientRect(), clip = parent.getBoundingClientRect();
    const top = clip.top - rect.top, bottom = clip.bottom - rect.top;
    setViewport((v) => (v?.top === top && v.bottom === bottom ? v : { top, bottom }));
  };
  useLayoutEffect(() => {
    let parent = root.current!.parentElement;
    while (parent && !/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    if (!parent) return;
    scroller.current = parent;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    parent.addEventListener("scroll", schedule, { passive: true });
    // A sibling group, lane or column that measures or collapses moves this one without a scroll.
    // ponytail: children present at mount only; a group added later is caught by the per-render measure below.
    const resize = new ResizeObserver(schedule);
    resize.observe(parent);
    for (const child of parent.children) resize.observe(child);
    return () => { parent.removeEventListener("scroll", schedule); resize.disconnect(); cancelAnimationFrame(frame); scroller.current = null; };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- `measure` reads refs only.
  }, []);
  // Every render re-measures before paint: a layout switch, a collapse or new items never paint a stale window.
  // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualKey!;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (height > 0 && heights.current.get(key) !== height) { heights.current.set(key, height); changed = true; }
      }
      if (changed) setRevision(value => value + 1);
    });
    for (const child of root.current.querySelectorAll<HTMLElement>(":scope > [data-virtual-key]")) observer.observe(child);
    return () => observer.disconnect();
  });
  // Many groups or lanes share one viewport, so each windows itself, however short: most sit outside it.
  const overscan = estimate * 4, top = viewport ? viewport.top - overscan : 0, bottom = viewport ? viewport.bottom + overscan : 0;
  let start = 0;
  while (start < items.length && offsets[start + 1]! < top) start++;
  let end = start;
  while (end < items.length && offsets[end]! < bottom) end++;
  const pinned = new Set([selected, focused, dragged].map(key => items.findIndex(item => itemKey(item) === key)).filter(index => index >= 0 && (index < start || index >= end)));
  // Pinned items keep their place in DOM order, so Tab moves on from them towards the window.
  const rendered = [...[...pinned].filter(index => index < start).sort((a, b) => a - b), ...Array.from({ length: end - start }, (_, index) => start + index), ...[...pinned].filter(index => index >= end).sort((a, b) => a - b)];
  // A selection made while its item was outside the window scrolls to the item's estimated place; once the window
  // reaches it and it takes its measured place, it is scrolled to once more. Scrolling back later never snaps to it.
  const selectedPinned = selected !== null && [...pinned].some(index => itemKey(items[index]!) === selected);
  const settling = useRef<string | null>(null);
  useLayoutEffect(() => { settling.current = selectedPinned ? selected : null; }, [selected]); // oxlint-disable-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies
  useLayoutEffect(() => {
    if (!selected || settling.current !== selected || selectedPinned) return;
    settling.current = null;
    root.current?.querySelector(`:scope > [data-virtual-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  });
  return <div ref={root} data-virtual-items style={{ position: "relative", overflowAnchor: "none" }}
    onFocus={(event: FocusEvent) => setFocused(keyOf(event.target))}
    onBlur={(event: FocusEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null); }}
    onDragStartCapture={event => setDragged(keyOf(event.target))}
    onDragEndCapture={() => setDragged(null)}>
    <div aria-hidden style={{ height: offsets[start] }} />
    {rendered.map(index => <div key={itemKey(items[index]!)} data-virtual-key={itemKey(items[index]!)} style={pinned.has(index) ? { position: "absolute", top: offsets[index], width: "100%" } : undefined}>{children(items[index]!)}</div>)}
    <div aria-hidden style={{ height: offsets.at(-1)! - offsets[end]! }} />
  </div>;
}
