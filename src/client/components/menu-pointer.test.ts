import { describe, expect, test } from "bun:test";
import { pointerStep } from "./menu";
import { settle } from "./menu-geometry";
import { ariaKeyboardAfter, keyboardModeAfter, modalityAfterMove, movedPointer } from "./pointer-intent";

test("the pointer entering a menu's first row opens its submenu, though a key highlighted that row before the pointer came", () => {
  // A menu opened by a key highlights its first row, Status; the pointer then reaches Status.
  expect(pointerStep("Status", null, "Status")).toBe("enter");
});

test("moving within the highlighted row leaves a submenu a key closed closed", () => {
  expect(pointerStep("Status", "Status", "Status")).toBe("stay");
});

test("a pointer moved on a row a key moved the highlight off takes it back; entering another row highlights it", () => {
  // pointerStep only sees real moves: menu's pointerMove drops one of no distance first (movedPointer, below).
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

describe("hover follows only a pointer the user moves (Linear's $4e, KLr and Yw, startup-root.BhUCnb9L.js)", () => {
  const menuSource = Bun.file(new URL("./menu.tsx", import.meta.url)).text();

  test("a move of no distance isn't the user's: a list scrolling under a still pointer, or ⌘ pressed over a row", () => {
    expect(movedPointer({ movementX: 0, movementY: 0, pointerType: "mouse" })).toBe(false);
    expect(movedPointer({ movementX: 0, movementY: 0, pointerType: "pen" })).toBe(false);
    expect(movedPointer({ movementX: 1, movementY: 0, pointerType: "mouse" })).toBe(true);
    expect(movedPointer({ movementX: 0, movementY: -2, pointerType: "mouse" })).toBe(true);
    // Linear's pure-touch exemption: a touch always counts.
    expect(movedPointer({ movementX: 0, movementY: 0, pointerType: "touch" })).toBe(true);
  });

  test("keyboard mode starts with any key and ends only with a pointer that went somewhere", () => {
    expect(keyboardModeAfter(false, { type: "keydown" })).toBe(true);
    expect(keyboardModeAfter(true, { type: "pointermove", movementX: 0, movementY: 0, pointerType: "mouse" })).toBe(true);
    expect(keyboardModeAfter(true, { type: "mousemove", movementX: 0, movementY: 0 })).toBe(true);
    expect(keyboardModeAfter(true, { type: "pointermove", movementX: 3, movementY: 0, pointerType: "mouse" })).toBe(false);
    expect(keyboardModeAfter(true, { type: "mousemove", movementX: 0, movementY: 1 })).toBe(false);
    expect(keyboardModeAfter(true, { type: "pointerdown" })).toBe(true);
  });

  test("a still move in keyboard mode keeps React Aria's modality a key's, so its hover start doesn't take the highlight", async () => {
    expect(modalityAfterMove(true, { movementX: 0, movementY: 0, pointerType: "mouse" })).toBe("keep");
    expect(modalityAfterMove(true, { movementX: 2, movementY: 0, pointerType: "mouse" })).toBe("leave");
    expect(modalityAfterMove(false, { movementX: 0, movementY: 0, pointerType: "mouse" })).toBe("leave");
    expect(modalityAfterMove(true, { movementX: 0, movementY: 0, pointerType: "touch" })).toBe("leave");
    // Only while React Aria had the input as a key's: an arrow, not ⌘ or a bare modifier (a ⌘-click's focus ring stays off).
    const still = { type: "pointermove", movementX: 0, movementY: 0, pointerType: "mouse" };
    expect(ariaKeyboardAfter(false, { type: "keydown", key: "ArrowDown" }, true)).toBe(true);
    expect(ariaKeyboardAfter(false, { type: "keydown", key: "Meta", metaKey: true }, true)).toBe(false);
    expect(ariaKeyboardAfter(false, { type: "keydown", key: "c", metaKey: true }, true)).toBe(false);
    expect(ariaKeyboardAfter(true, still, true)).toBe(true);
    expect(ariaKeyboardAfter(true, { ...still, movementX: 4 }, true)).toBe(false);
    expect(ariaKeyboardAfter(true, { type: "pointerdown" }, true)).toBe(false);
    const intent = await Bun.file(new URL("./pointer-intent.ts", import.meta.url)).text();
    expect(intent).toContain('=== "keep") setInteractionModality("keyboard");');
    expect(intent).toContain('document.addEventListener("pointermove", keep);');
  });

  test("an arrowed highlight stays put under a resting pointer: the menu drops a still move before it points at a row", async () => {
    expect(await menuSource).toMatch(/onPointerMove\?\.\(event\);\s*\/\/[^\n]*\n\s*if \(!movedPointer\(event\)\) return;[^]*?level\.actions\.point\(/);
  });

  test("a key pressed while the safe triangle runs out keeps its highlight: the row under the pointer takes it only out of keyboard mode", async () => {
    expect(await menuSource).toMatch(/rest: \(\{ x, y \}\) => \{[^]*?if \(keyboardMode\(\)\) return;[^]*?elementFromPoint/);
  });

  test("a menu opened by a key stays a key's menu when a still move follows (no first-row skip)", async () => {
    const pristine = await Bun.file(new URL("./menu-pristine.ts", import.meta.url)).text();
    expect(pristine).toContain('addEventListener("pointermove", (event: PointerEvent) => movedPointer(event) && by(true)(), true);');
  });

  test("a board card or list row under a still pointer doesn't take the open peek from the card j/k moved to", async () => {
    const board = await Bun.file(new URL("../routes/board-view.tsx", import.meta.url)).text();
    expect(board).toContain("onPointerMove={(e) => movedPointer(e) && followPeek(issue.key)}");
  });
});
