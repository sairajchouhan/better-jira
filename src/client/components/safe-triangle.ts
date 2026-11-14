/** A box in viewport pixels: what getBoundingClientRect gives, less what the triangle doesn't read. */
type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

/**
 * Linear's submenu safe triangle (`XCe`, startup-root.CnUSfl4j.js): the style of an invisible box laid over the parent menu,
 * absolutely placed in the submenu's own box and stretched back to the pointer, clipped to the polygon from the pointer to the
 * submenu's nearer edges. Rows under it get no pointer events, so a diagonal move toward the submenu crosses them without taking
 * the highlight. Undefined while the pointer is inside the submenu.
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
  const style: Record<string, string> = { position: "absolute" };
  if (toLeft > 0) Object.assign(style, { left: `${-toLeft}px`, width: `${width + toLeft}px` });
  else if (toRight > 0) Object.assign(style, { right: `${-toRight}px`, width: `${width + toRight}px` });
  else Object.assign(style, { left: "0px", right: "0px" });
  if (above > 0) Object.assign(style, { top: `${-above}px`, height: `${height + above}px` });
  else if (below > 0) Object.assign(style, { bottom: `${-below}px`, height: `${height + below}px` });
  else Object.assign(style, { top: "0px", bottom: "0px" });
  // The pointer and the box's edges as percentages of the stretched box.
  const w = toLeft + width + toRight,
    h = above + height + below,
    px = ((toLeft + (x - left)) / w) * 100,
    py = ((above + (y - top)) / h) * 100,
    near = (toLeft / w) * 100,
    far = ((toLeft + width) / w) * 100,
    start = (above / h) * 100,
    end = ((above + height) / h) * 100;
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
