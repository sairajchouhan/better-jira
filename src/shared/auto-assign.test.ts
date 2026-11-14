import { expect, test } from "bun:test";
import { AUTO_ASSIGN_DEFAULTS, createAssignee, parseAutoAssign, startAssignee } from "./auto-assign";

const me = { id: "me", name: "Me" },
  other = { id: "o", name: "Other" },
  on = { autoAssignToSelf: true, assignToSelfWhenStarted: true },
  off = AUTO_ASSIGN_DEFAULTS;

test("both automations are off until turned on, as Linear's defaults (`default:!1`)", () => {
  expect(AUTO_ASSIGN_DEFAULTS).toEqual({ autoAssignToSelf: false, assignToSelfWhenStarted: false });
  expect(parseAutoAssign(null)).toEqual(AUTO_ASSIGN_DEFAULTS);
  expect(parseAutoAssign({ autoAssignToSelf: "yes", assignToSelfWhenStarted: 1 })).toEqual(AUTO_ASSIGN_DEFAULTS);
  expect(parseAutoAssign({ autoAssignToSelf: true })).toEqual({ autoAssignToSelf: true, assignToSelfWhenStarted: false });
});

test("Auto-assign to self fills only an assignee no one chose; No assignee and a chosen person win (`c!==null`)", () => {
  expect(createAssignee(undefined, me, on)).toBe(me);
  expect(createAssignee(undefined, me, off)).toBeUndefined();
  expect(createAssignee(null, me, on)).toBeNull();
  expect(createAssignee(other, me, on)).toBe(other);
});

test("moving an unassigned issue to a started status assigns you (`assignToState`)", () => {
  expect(startAssignee({ assignee: null }, "indeterminate", me, on)).toBe(me);
  expect(startAssignee({}, "indeterminate", me, on)).toBe(me);
});

test("the started rule needs the preference, a started status and an unassigned issue, and yields to skipSelfAssign", () => {
  expect(startAssignee({ assignee: null }, "indeterminate", me, off)).toBeUndefined();
  expect(startAssignee({ assignee: null }, "new", me, on)).toBeUndefined();
  expect(startAssignee({ assignee: null }, "done", me, on)).toBeUndefined();
  expect(startAssignee({ assignee: other }, "indeterminate", me, on)).toBeUndefined();
  expect(startAssignee({ assignee: null }, "indeterminate", me, on, true)).toBeUndefined();
  // Each preference is its own: Auto-assign to self alone never assigns on a move.
  expect(startAssignee({ assignee: null }, "indeterminate", me, { ...off, autoAssignToSelf: true })).toBeUndefined();
});
