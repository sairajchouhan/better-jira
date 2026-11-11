import { expect, test } from "bun:test";
import { viewShortcutId } from "./view-shortcut";
const event = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  code: "KeyV",
};
test("view shortcuts use physical codes even with macOS Option characters", () => {
  expect(viewShortcutId({ ...event, key: "√" } as typeof event)).toBe(
    "view-create",
  );
  expect(viewShortcutId({ ...event, code: "KeyS" })).toBe("view-save");
  expect(viewShortcutId({ ...event, code: "KeyF" })).toBe("view-favorite");
});
test("view shortcuts require Option alone", () => {
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey"])
    expect(viewShortcutId({ ...event, [modifier]: true })).toBeNull();
  expect(viewShortcutId({ ...event, altKey: false })).toBeNull();
  expect(viewShortcutId({ ...event, code: "KeyA" })).toBeNull();
});
