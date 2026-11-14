import { expect, test } from "bun:test";
import { axisStep, edgeSpeed } from "./drag-auto-scroll";

test("Linear's board auto-scroll: 45px a frame at the edge, easing in by the cube over 250px (IssueList `Yc`)", () => {
  expect(edgeSpeed(0, false)).toBe(45);
  expect(edgeSpeed(125, false)).toBeCloseTo(45 / 8);
  expect(edgeSpeed(250, false)).toBe(0);
  expect(edgeSpeed(251, false)).toBe(0);
  // Past the edge (the pointer outside the scroller) is the edge's full speed.
  expect(edgeSpeed(-20, false)).toBe(45);
});

test("on a phone the zone is 150px and the top speed 35px a frame", () => {
  expect(edgeSpeed(0, true)).toBe(35);
  expect(edgeSpeed(75, true)).toBeCloseTo(35 / 8);
  expect(edgeSpeed(150, true)).toBe(0);
});

test("only the edge the pointer is moving towards scrolls", () => {
  expect(axisStep(1, 10, 20, false)).toBeCloseTo(edgeSpeed(20, false));
  expect(axisStep(-1, 10, 20, false)).toBeCloseTo(-edgeSpeed(10, false));
  expect(axisStep(0, 10, 20, false)).toBe(0);
  // Moving down, near the top edge only: no scroll.
  expect(axisStep(1, 10, 900, false)).toBe(0);
});
