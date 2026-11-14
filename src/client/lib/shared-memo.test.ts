import { expect, test } from "bun:test";
import { sharedMemo } from "./shared-memo";

test("sharedMemo computes once per owner, key and deps, for every caller", () => {
  const memo = sharedMemo();
  const owner = {};
  let runs = 0;
  const compute = () => ({ run: ++runs });
  const a = memo(owner, "k", [1], compute);
  expect(memo(owner, "k", [1], compute)).toBe(a);
  expect(runs).toBe(1);
  // Another key, another owner or changed deps compute again.
  expect(memo(owner, "other", [1], compute)).not.toBe(a);
  expect(memo({}, "k", [1], compute)).not.toBe(a);
  const b = memo(owner, "k", [2], compute);
  expect(b).not.toBe(a);
  expect(memo(owner, "k", [2], compute)).toBe(b);
  expect(runs).toBe(4);
});
