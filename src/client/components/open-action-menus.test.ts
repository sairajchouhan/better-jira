import { expect, test } from "bun:test";
import { actionMenuOpen, closeActionMenuOnKey, registerActionMenu } from "./open-action-menus";

const key = (key: string, more: Partial<KeyboardEvent> = {}) => {
  const event = {
    key,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    stopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
    ...more,
  };
  return event;
};

test("BJ-216: Escape closes the open action menu wherever focus is, as Linear's global isEscape → closeActionMenu", () => {
  const closed: string[] = [];
  const first = registerActionMenu(() => closed.push("first"));
  const second = registerActionMenu(() => closed.push("second"));
  expect(actionMenuOpen()).toBe(true);
  // Only the top menu closes, and the key goes no further (no "Back / clear selection" behind it).
  const escape = key("Escape");
  expect(closeActionMenuOnKey(escape, true)).toBe(true);
  expect([closed, escape.defaultPrevented, escape.stopped]).toEqual([["second"], true, true]);
  second();
  // A menu with focus handled its own Escape already; a modified Escape or another key is not Linear's isEscape.
  expect(closeActionMenuOnKey(key("Escape", { defaultPrevented: true }), true)).toBe(false);
  expect(closeActionMenuOnKey(key("Escape", { shiftKey: true }), true)).toBe(false);
  expect(closeActionMenuOnKey(key("Enter"), true)).toBe(false);
  expect(closeActionMenuOnKey(key("Escape"), true)).toBe(true);
  expect(closed).toEqual(["second", "first"]);
  first();
  expect(actionMenuOpen()).toBe(false);
  expect(closeActionMenuOnKey(key("Escape"), true)).toBe(false);
});

test("BJ-221: ⌘K with an action menu open closes it instead of opening the command menu (Linear yMn's closeActionMenu)", () => {
  const closed: string[] = [];
  const menu = registerActionMenu(() => closed.push("menu"));
  const commandK = key("k", { metaKey: true });
  expect(closeActionMenuOnKey(commandK, true)).toBe(true);
  expect([closed, commandK.defaultPrevented, commandK.stopped]).toEqual([["menu"], true, true]);
  // Ctrl+K is the chord off a Mac; on a Mac it is the menu's own Emacs ↑.
  expect(closeActionMenuOnKey(key("k", { ctrlKey: true }), false)).toBe(true);
  expect(closeActionMenuOnKey(key("k", { ctrlKey: true }), true)).toBe(false);
  expect(closeActionMenuOnKey(key("k", { metaKey: true, shiftKey: true }), true)).toBe(false);
  expect(closeActionMenuOnKey(key("k"), true)).toBe(false);
  menu();
  // With no menu open, ⌘K is left to the palette.
  expect(closeActionMenuOnKey(key("k", { metaKey: true }), true)).toBe(false);
});
