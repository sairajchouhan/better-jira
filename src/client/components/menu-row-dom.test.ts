import { expect, test } from "bun:test";
import { rowDom } from "./menu";

// views-navigation: a disabled row with a title lost React Aria's aria-disabled to the render override's own.
test("a row's own aria state is laid over React Aria's, never instead of it", () => {
  const disabled = rowDom({ role: "menuitem", "aria-disabled": true }, { muted: false, title: "Why" });
  expect(disabled["aria-disabled"]).toBe(true);
  expect(disabled.title).toBe("Why");
  expect(rowDom({ role: "menuitem" }, { muted: true })["aria-disabled"]).toBe(true);
  expect(rowDom({ role: "menuitem" }, { muted: false })["aria-disabled"]).toBeUndefined();
  const checkbox = rowDom({ role: "menuitem" }, { checks: false, muted: false });
  expect([checkbox.role, checkbox["aria-checked"]]).toEqual(["menuitemcheckbox", false]);
  expect(rowDom({ role: "menuitemradio", "aria-checked": true }, { muted: false, title: "t" })["aria-checked"]).toBe(true);
});
