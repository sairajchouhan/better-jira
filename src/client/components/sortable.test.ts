import { describe, expect, test } from "bun:test";
import { dropIndex, rowShift } from "./sortable";

describe("Sortable", () => {
  test("a drop lands whole rows away from where the drag began, inside the list", () => {
    expect(dropIndex(0, 40, 32, 4)).toBe(1);
    expect(dropIndex(0, 15, 32, 4)).toBe(0);
    expect(dropIndex(3, -70, 32, 4)).toBe(1);
    expect(dropIndex(1, 999, 32, 4)).toBe(3);
    expect(dropIndex(1, -999, 32, 4)).toBe(0);
  });
  test("rows the dragged one passes slide a row the other way; the rest stay", () => {
    const down = { id: "a", from: 0, to: 2, height: 32, startY: 0, dy: 70, by: "pointer" as const };
    expect([0, 1, 2, 3].map((i) => rowShift(i, down))).toEqual([70, -32, -32, 0]);
    const up = { ...down, from: 3, to: 1, dy: -60, by: "keyboard" as const };
    expect([0, 1, 2, 3].map((i) => rowShift(i, up))).toEqual([0, 32, 32, -64]);
    expect(rowShift(0, null)).toBe(0);
  });
});
