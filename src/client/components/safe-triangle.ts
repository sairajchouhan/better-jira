/** A box in viewport pixels: what getBoundingClientRect gives, less what the triangle doesn't read. */
type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;
type Edges = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

const within = (edges: Edges, x: number, y: number) => x >= edges.left && x <= edges.right && y >= edges.top && y <= edges.bottom;

/**
 * Linear's submenu safe triangle (`XCe`, startup-root.CnUSfl4j.js): the style of an invisible box laid over the parent menu,
 * absolutely placed in the submenu's own box and stretched back to the pointer, clipped to the polygon from the pointer to the
 * submenu's nearer edges. Rows under it get no pointer events, so a diagonal move toward the submenu crosses them without taking
 * the highlight. Undefined while the pointer is inside the submenu.
 *
 * Changes from XCe, so a press lands where the pointer is and a stopped pointer stays off the rows it crosses:
 * - On the submenu's own row (`row`), the box stops 1px short of the pointer: a press or hover there is the row's.
 * - Off it, the apex sits APEX px behind the pointer, so the pointer is inside the triangle, not on its corner. Each sample
 *   redraws the triangle under a pointer that has stopped, and Chromium then hit-tests the pointer again: on the corner it fell
 *   through to the row beneath, which took the highlight and opened its own submenu (a slow diagonal lost Status for Assignee).
 *   TRIANGLE_EXPIRY later the triangle hides and that row takes the pointer.
 * - With `parent` (the parent menu's box) it is drawn only while the pointer is over the parent menu. Nothing outside it needs
 *   covering, and a press where the pointer rests outside both menus must land on what is under it, not on the invisible box
 *   inside the submenu (which kept both menus open).
 */
export function safeTriangle(
  box: Box,
  pointerX: number,
  pointerY: number,
  { parent, row }: { parent?: Edges; row?: Edges } = {},
): Record<string, string> | undefined {
  const { left, right, top, bottom, width, height } = box;
  if (parent && !within(parent, pointerX, pointerY)) return;
  // The apex: on the submenu's row, the pointer; elsewhere APEX px further from the submenu, on each side the pointer is past it.
  const behind = row && within(row, pointerX, pointerY) ? 0 : APEX;
  const x = pointerX < left ? pointerX - behind : pointerX > right ? pointerX + behind : pointerX,
    y = pointerY < top ? pointerY - behind : pointerY > bottom ? pointerY + behind : pointerY;
  const toLeft = x < left ? left - x : 0,
    toRight = x > right ? x - right : 0,
    above = y < top ? top - y : 0,
    below = y > bottom ? y - bottom : 0;
  const across = toLeft !== 0 || toRight !== 0,
    along = above !== 0 || below !== 0;
  if (!across && !along) return;
  // How far the box reaches back toward the apex on each side: to 1px short of it, past the pointer.
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

/** How far behind the pointer the triangle's apex sits: the pointer's own pixel lies well inside the triangle. */
export const APEX = 3;

/** Linear's JCe: the triangle hides this long after the pointer's last sample, unless the pointer rests on the submenu's own row. */
export const TRIANGLE_EXPIRY = 150;

/**
 * Whether the triangle stays once the pointer has rested TRIANGLE_EXPIRY at (x, y) (JCe's `YCe(triggerSelector, sample)`): only
 * while it rests on the submenu's row. Elsewhere it hides, so the row under the pointer is under the pointer again (and takes it,
 * as Linear's row does on the mouseenter its unmounting brings). Hidden, it comes back only once the pointer is on the row again.
 */
export const triangleStays = (row: Edges | undefined, x: number, y: number) => !!row && within(row, x, y);
