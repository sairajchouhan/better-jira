import { expect, test } from "bun:test";
import { safeTriangle } from "./safe-triangle";

// The submenu sits right of the parent menu: x 200..400, y 100..300.
const box = { left: 200, right: 400, top: 100, bottom: 300, width: 200, height: 200 };

/** Whether viewport point (x, y) falls inside the painted triangle: resolves the style's box and clip-path back to pixels. */
function covers(style: Record<string, string>, x: number, y: number) {
  const px = (v: string | undefined) => (v === undefined ? undefined : Number.parseFloat(v));
  const left = px(style.left) !== undefined ? box.left + px(style.left)! : box.right - px(style.right)! - px(style.width)!;
  const top = px(style.top) !== undefined ? box.top + px(style.top)! : box.bottom - px(style.bottom)! - px(style.height)!;
  const width = px(style.width) ?? box.width,
    height = px(style.height) ?? box.height;
  const points = [...style.clipPath!.matchAll(/([\d.]+)% ([\d.]+)%/g)].map(
    ([, a, b]) => [left + (Number(a) / 100) * width, top + (Number(b) / 100) * height] as const,
  );
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!,
      [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

test("R3-relations-D3: a diagonal path from the pointer toward a lower submenu row stays inside the safe triangle", () => {
  // Pointer on the parent's Status row, 40px left of the submenu, near its top.
  const style = safeTriangle(box, 160, 120)!;
  expect(style.position).toBe("absolute");
  // The straight path to a row lower in the submenu crosses the parent's rows below Status: all of it is covered.
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) expect([t, covers(style, 160 + t * 40, 120 + t * 150)]).toEqual([t, true]);
  // Straight down from the pointer is the next parent row, not the submenu: it stays hoverable.
  expect(covers(style, 160, 160)).toBe(false);
  expect(covers(style, 150, 120)).toBe(false);
});

test("the triangle points at whichever side the submenu opens on", () => {
  const left = safeTriangle(box, 440, 200)!;
  expect(left.right).toBe("-40px");
  expect(covers(left, 420, 180)).toBe(true);
  expect(covers(left, 440, 260)).toBe(false);
});

test("no triangle while the pointer is inside the submenu", () => {
  expect(safeTriangle(box, 300, 200)).toBeUndefined();
});
