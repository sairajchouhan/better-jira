import { expect, test } from "bun:test";
import { pointerStep } from "./menu";

test("the pointer entering a pristine menu's first row opens its submenu, though cmdk already selected that row unseen", () => {
  // A right-click menu opens pristine with cmdk's value on its first row, Status; the pointer then reaches Status.
  expect(pointerStep("Status", null, "Status")).toBe("enter");
});

test("moving within the highlighted row leaves a submenu a key closed closed", () => {
  expect(pointerStep("Status", "Status", "Status")).toBe("stay");
});

test("the pointer on a row a key moved the highlight off takes it back; entering another row highlights it", () => {
  expect(pointerStep("Status", "Status", "Priority")).toBe("highlight");
  expect(pointerStep("Priority", "Status", "Status")).toBe("highlight");
});
