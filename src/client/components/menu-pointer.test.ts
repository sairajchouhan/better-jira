import { describe, expect, test } from "bun:test";
import { pointerStep } from "./menu";
import { settle } from "./menu-geometry";

test("the pointer entering a menu's first row opens its submenu, though a key highlighted that row before the pointer came", () => {
  // A menu opened by a key highlights its first row, Status; the pointer then reaches Status.
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

describe("settle", () => {
  test("an open submenu keeps where it first settled while its row stays put", () => {
    const first = settle(null, 100, 96);
    expect(first.top).toBe(96);
    // Its search shrank the list, so a fresh placement would move it to 140: it stays at 96.
    expect(settle(first.settled, 100, 140).top).toBe(96);
  });

  // A 1044-label Labels submenu settled level with its row while its rows were loading, then grew to the window's height and
  // ended at 1414 in a 969px window: growing past the window moves it up to S3e's clamp, where it settles.
  test("a submenu that grows past the window from where it settled moves up to stay inside, and settles there", () => {
    const first = settle(null, 477, 471, 800);
    expect(settle(first.settled, 477, 16, 16)).toEqual({ top: 16, settled: { row: 477, top: 16 } });
    // Shrinking again (a search) keeps it where it moved to.
    expect(settle({ row: 477, top: 16 }, 477, 471, 800).top).toBe(16);
  });

  test("a moved row, or the submenu opened again, settles anew", () => {
    const first = settle(null, 100, 96);
    expect(settle(first.settled, 132, 128)).toEqual({ top: 128, settled: { row: 132, top: 128 } });
    expect(settle(null, 132, 150).top).toBe(150);
  });
});

test("R3-views-filters-D-1: focus coming back to the parent as the pointer leaves a submenu doesn't close it", async () => {
  const { levelTrigger } = await import("./menu");
  const trigger = levelTrigger({ key: "Status", how: "pointer" });
  // React Aria's SubmenuTrigger asks to close on the virtual focus its parent list takes; the level closes its submenu itself.
  expect(() => trigger.closeSubmenu("submenu:Status", 0)).not.toThrow();
  expect(trigger.expandedKeysStack[0]).toBe("submenu:Status");
  expect(levelTrigger(null).expandedKeysStack[0]).toBeUndefined();
});
