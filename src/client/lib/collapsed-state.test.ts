import { expect, test } from "bun:test";
import { collapsedStateStore } from "./collapsed-state";

test("a toggled section stays as it was for 15 minutes, then falls back to its default (Linear's session collapse memory)", () => {
  let clock = 0;
  const store = collapsedStateStore({ expiresAfter: 15 * 60_000, maxSize: 2000, now: () => clock });
  expect(store.get("issue-diffs-TEST-1")).toBeUndefined();
  store.set("issue-diffs-TEST-1", false);
  clock = 15 * 60_000;
  expect(store.get("issue-diffs-TEST-1")).toBe(false);
  clock += 1;
  expect(store.get("issue-diffs-TEST-1")).toBeUndefined();
});
