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

test("R3-palette-shortcuts-D3: when the highlighted row leaves the list, the highlight moves to the first row, as Linear's B6e", async () => {
  const { vanishedHighlight } = await import("./menu");
  // ⌘K scoped to an issue highlights its first command; ⌫ drops the issue and with it that whole group.
  expect(vanishedHighlight("Change issue status", "Change issue status", ["Go to inbox", "Create issue"])).toBe("Go to inbox");
  // Still listed, never rendered yet (rows still loading), or nothing highlighted: left alone.
  expect(vanishedHighlight("Go to inbox", "Go to inbox", ["Create issue", "Go to inbox"])).toBeNull();
  expect(vanishedHighlight("Done", null, [])).toBeNull();
  expect(vanishedHighlight("", null, ["Go to inbox"])).toBeNull();
  expect(vanishedHighlight("Change issue status", "Change issue status", [])).toBeNull();
});
