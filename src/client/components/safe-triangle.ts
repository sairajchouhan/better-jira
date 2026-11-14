/** A box in viewport pixels: what getBoundingClientRect gives, less what the triangle doesn't read. */
type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

/**
 * Linear's submenu safe triangle (`XCe`, startup-root.CnUSfl4j.js): the style of an invisible box laid over the parent menu,
 * absolutely placed in the submenu's own box and stretched back to the pointer, clipped to the polygon from the pointer to the
 * submenu's nearer edges. Rows under it get no pointer events, so a diagonal move toward the submenu crosses them without taking
 * the highlight. Undefined while the pointer is inside the submenu.
 *
 * One change from XCe: the box stops 1px short of the pointer (the polygon's apex stays on it, just outside the box), so the
 * pointer's own pixel is never under the box. Once the pointer rests, the last sample is where it is, and a press there must land
 * on what the person sees: with the apex on the pointer, Chromium hit-tested the press onto the box, inside the submenu, and a
 * press outside both menus didn't close them.
 */
export function safeTriangle(box: Box, x: number, y: number): Record<string, string> | undefined {
  const { left, right, top, bottom, width, height } = box;
  const toLeft = x < left ? left - x : 0,
    toRight = x > right ? x - right : 0,
    above = y < top ? top - y : 0,
    below = y > bottom ? y - bottom : 0;
  const across = toLeft !== 0 || toRight !== 0,
    along = above !== 0 || below !== 0;
  if (!across && !along) return;
  // How far the box reaches back toward the pointer on each side: to 1px short of it.
  const reachLeft = Math.max(0, toLeft - 1),
    reachRight = Math.max(0, toRight - 1),
    reachUp = Math.max(0, above - 1),
    reachDown = Math.max(0, below - 1);
  const style: Record<string, string> = { position: "absolute" };
  if (toLeft > 0) Object.assign(style, { left: `${-reachLeft}px`, width: `${width + reachLeft}px` });
  else if (toRight > 0) Object.assign(style, { right: `${-reachRight}px`, width: `${width + reachRight}px` });
  else Object.assign(style, { left: "0px", right: "0px" });
  if (above > 0) Object.assign(style, { top: `${-reachUp}px`, height: `${height + reachUp}px` });
  else if (below > 0) Object.assign(style, { bottom: `${-reachDown}px`, height: `${height + reachDown}px` });
  else Object.assign(style, { top: "0px", bottom: "0px" });
  // The pointer and the box's edges as percentages of the stretched box (the pointer just outside it on a side it reaches to).
  const w = reachLeft + width + reachRight,
    h = reachUp + height + reachDown,
    px = ((reachLeft + (x - left)) / w) * 100,
    py = ((reachUp + (y - top)) / h) * 100,
    near = (reachLeft / w) * 100,
    far = ((reachLeft + width) / w) * 100,
    start = (reachUp / h) * 100,
    end = ((reachUp + height) / h) * 100;
  const polygon = (...points: [number, number][]) =>
    `polygon(${[[px, py], ...points].map(([a, b]) => `${a}% ${b}%`).join(", ")})`;
  style.clipPath =
    across && along
      ? x < left && y < top
        ? polygon([near, end], [near, start], [far, start])
        : x > right && y < top
          ? polygon([far, end], [far, start], [near, start])
          : x < left && y > bottom
            ? polygon([near, start], [near, end], [far, end])
            : polygon([far, start], [far, end], [near, end])
      : across
        ? x < left
          ? polygon([near, start], [near, end])
          : polygon([far, start], [far, end])
        : y < top
          ? polygon([near, start], [far, start])
          : polygon([near, end], [far, end]);
  return style;
}

/** Linear's JCe: the triangle hides this long after the pointer's last sample, unless the pointer rests on the submenu's own row. */
export const TRIANGLE_EXPIRY = 150;

/**
 * Whether the triangle stays once the pointer has rested TRIANGLE_EXPIRY at (x, y) (JCe's `YCe(triggerSelector, sample)`): only
 * while it rests on the submenu's row. Elsewhere it hides, so the row under the pointer is under the pointer again (and takes it,
 * as Linear's row does on the mouseenter its unmounting brings). Hidden, it comes back only once the pointer is on the row again.
 */
export const triangleStays = (row: Pick<DOMRect, "left" | "right" | "top" | "bottom"> | undefined, x: number, y: number) =>
  !!row && x >= row.left && x <= row.right && y >= row.top && y <= row.bottom;
