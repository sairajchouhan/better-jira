import { expect, test } from "bun:test";
import { actionMenuOpen, closeActionMenuOnEscape, registerActionMenu } from "./open-action-menus";

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
  expect(closeActionMenuOnEscape(escape)).toBe(true);
  expect([closed, escape.defaultPrevented, escape.stopped]).toEqual([["second"], true, true]);
  second();
  // A menu with focus handled its own Escape already; a modified Escape or another key is not Linear's isEscape.
  expect(closeActionMenuOnEscape(key("Escape", { defaultPrevented: true }))).toBe(false);
  expect(closeActionMenuOnEscape(key("Escape", { shiftKey: true }))).toBe(false);
  expect(closeActionMenuOnEscape(key("Enter"))).toBe(false);
  expect(closeActionMenuOnEscape(key("Escape"))).toBe(true);
  expect(closed).toEqual(["second", "first"]);
  first();
  expect(actionMenuOpen()).toBe(false);
  expect(closeActionMenuOnEscape(key("Escape"))).toBe(false);
});
