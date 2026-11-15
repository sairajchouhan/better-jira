import { expect, test } from "bun:test";
import { safeTriangle, TRIANGLE_EXPIRY, triangleStays } from "./safe-triangle";

// The submenu sits right of the parent menu: x 200..400, y 100..300.
const box = { left: 200, right: 400, top: 100, bottom: 300, width: 200, height: 200 };

/** The style's box in viewport pixels. */
function boxOf(style: Record<string, string>) {
  const px = (v: string | undefined) => (v === undefined ? undefined : Number.parseFloat(v));
  const left = px(style.left) !== undefined ? box.left + px(style.left)! : box.right - px(style.right)! - px(style.width)!;
  const top = px(style.top) !== undefined ? box.top + px(style.top)! : box.bottom - px(style.bottom)! - px(style.height)!;
  return { left, top, width: px(style.width) ?? box.width, height: px(style.height) ?? box.height };
}

/** Whether viewport point (x, y) falls inside the painted triangle: resolves the style's box and clip-path back to pixels. */
function covers(style: Record<string, string>, x: number, y: number) {
  const { left, top, width, height } = boxOf(style);
  if (x < left || x > left + width || y < top || y > top + height) return false;
  const points = [...style.clipPath!.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map(
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
  expect(left.right).toBe("-42px"); // 40px to the pointer and APEX (3px) past it, less 1px
  expect(covers(left, 420, 180)).toBe(true);
  expect(covers(left, 440, 260)).toBe(false);
});

test("no triangle while the pointer is inside the submenu", () => {
  expect(safeTriangle(box, 300, 200)).toBeUndefined();
});

test("R3-relations-D3: the pointer is inside the triangle redrawn at it, so a stopped pointer stays off the rows beneath", () => {
  // Left, right, above, below, and the four corners of the submenu: the sample's own point and the pixels around it are covered.
  for (const [x, y] of [
    [160, 120],
    [440, 200],
    [300, 60],
    [300, 340],
    [5, 5],
    [450, 20],
    [150, 350],
    [430, 330],
  ] as const) {
    const style = safeTriangle(box, x, y)!;
    expect([x, y, covers(style, x, y)]).toEqual([x, y, true]);
    expect([x, y, covers(style, x + 0.5 * Math.sign(300 - x), y + 0.5 * Math.sign(200 - y))]).toEqual([x, y, true]);
  }
});

test("a press or hover on the submenu's own row is the row's: there the box stops 1px short of the pointer", () => {
  const row = { left: 2, right: 202, top: 110, bottom: 140 };
  const style = safeTriangle(box, 160, 120, { row })!;
  expect(style.left).toBe("-39px");
  expect(covers(style, 160, 120)).toBe(false);
  expect(covers(style, 180, 125)).toBe(true);
  // Off the row, the pointer is inside it.
  expect(covers(safeTriangle(box, 160, 150, { row })!, 160, 150)).toBe(true);
});

test("a press where the pointer rests outside both menus lands on what is under it: no triangle off the parent menu", () => {
  // The parent menu sits left of the submenu, overlapping it by 2px.
  const parent = { left: 2, right: 202, top: 80, bottom: 400, width: 200, height: 320 };
  expect(safeTriangle(box, 160, 120, { parent })).toBeDefined();
  for (const [x, y] of [
    [1, 120],
    [160, 60],
    [160, 420],
    [450, 20],
  ] as const)
    expect([x, y, safeTriangle(box, x, y, { parent })]).toEqual([x, y, undefined]);
});

test("the triangle lasts 150ms after the pointer stops off its row, as Linear's JCe (qCe samples every 50ms)", () => {
  expect(TRIANGLE_EXPIRY).toBe(150);
});

test("the triangle stays while the pointer is on the submenu's own row, and only then shows again once expired", () => {
  const row = { left: 0, right: 200, top: 40, bottom: 68 };
  expect(triangleStays(row, 100, 50)).toBe(true);
  expect(triangleStays(row, 200, 68)).toBe(true);
  expect(triangleStays(row, 100, 80)).toBe(false);
  expect(triangleStays(row, 220, 50)).toBe(false);
  expect(triangleStays(undefined, 100, 50)).toBe(false);
});
