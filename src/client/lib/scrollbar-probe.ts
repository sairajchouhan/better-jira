/**
 * Linear's scrollbar probe. Overlay scrollbars (the macOS trackpad default) take no room and are left alone; only where a
 * scrollbar eats layout width does body get `layoutScrollbarObtrusive`, which thins and themes every scrollbar (index.css,
 * "Scrollbars"), and `--scrollbar-width` on <html> carries the measured width for the paddings that make room for it.
 *
 * Linear does this twice: a boot probe in its entry (`wEe`, startup-entry.Dt5YDWdY.js: a 30×30 `overflow:auto` box, the class
 * added when `30 - e.firstChild.clientWidth` is non-zero) and, once React mounts, a live one (`TTe`, startup-root.BhUCnb9L.js:
 * a 0-tall, 50px `overflow-y:scroll` div measured as `outer.offsetWidth - inner.offsetWidth`, the class toggled, measured
 * again now that the class has thinned it, and `--scrollbar-width` set to that; a ResizeObserver on the inner div re-runs it
 * when the scrollbar mode or the zoom changes). Ours runs the live probe at boot, before the first render (main.tsx), so the
 * boot probe and Linear's localStorage cache of the width (`linear-scrollbar-width`, read until TTe mounts) have nothing left
 * to cover. Plain DOM, not React: nothing renders from it, and React Aria has no scrollbar primitive.
 */

/** Linear's body class for scrollbars that take up space. */
export const OBTRUSIVE = "layoutScrollbarObtrusive";

/** The probe's class (index.css: Linear's `sx-qtp20y sx-1pju0fl sx-1rife3k`, height 0, width 50px, overflow-y scroll). */
export const PROBE = "scrollbar-probe";

type Box = Pick<HTMLElement, "offsetWidth">;
type ProbeDocument = {
  body: { classList: Pick<DOMTokenList, "toggle">; append(node: unknown): void };
  documentElement: { style: Pick<CSSStyleDeclaration, "setProperty"> };
  createElement(tag: "div"): HTMLDivElement;
  querySelector(selector: string): unknown;
};
type Observer = { observe(target: Element): void; disconnect(): void };

/** The room a scrollbar takes beside `inner` in `outer`: 0 for overlay scrollbars. */
export const scrollbarWidth = (outer: Box, inner: Box) => outer.offsetWidth - inner.offsetWidth;

/** TTe's measure: toggle the class from the width, measure again under it (thin), toggle again; returns the width. */
export function measureScrollbar(doc: { body: Pick<ProbeDocument["body"], "classList"> }, outer: Box, inner: Box) {
  let width = scrollbarWidth(outer, inner);
  doc.body.classList.toggle(OBTRUSIVE, width > 0);
  width = scrollbarWidth(outer, inner);
  doc.body.classList.toggle(OBTRUSIVE, width > 0);
  return width;
}

/**
 * Puts the probe in `doc` and keeps body's class and `--scrollbar-width` current. Once per page: a hot reload of main.tsx finds
 * the probe already there. Returns a function that removes it.
 */
export function installScrollbarProbe(
  doc: ProbeDocument = document,
  Resize: new (callback: () => void) => Observer = ResizeObserver,
) {
  if (doc.querySelector(`.${PROBE}`)) return () => {};
  const outer = doc.createElement("div"),
    inner = doc.createElement("div");
  outer.className = PROBE;
  outer.tabIndex = -1;
  outer.setAttribute("aria-hidden", "true");
  outer.append(inner);
  doc.body.append(outer);
  let width: number | undefined;
  const measure = () => {
    const next = measureScrollbar(doc, outer, inner);
    if (next === width) return;
    width = next;
    doc.documentElement.style.setProperty("--scrollbar-width", `${next}px`);
  };
  measure();
  const observer = new Resize(measure);
  observer.observe(inner);
  return () => {
    observer.disconnect();
    outer.remove();
  };
}
