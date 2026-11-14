import { expect, test } from "bun:test";
import { resolveRecents } from "./recents";

test("R3-views-filters-D-9: a local key and the Jira key it became are one recent issue", () => {
  const issues = new Map([
    ["KAN-313", { key: "KAN-313" }],
    ["KAN-2", { key: "KAN-2" }],
  ]);
  const renamed = new Map([["KAN-NEW1", "KAN-313"]]);
  const find = (key: string) => issues.get(renamed.get(key) ?? key);
  expect(resolveRecents(["KAN-313", "KAN-NEW1", "KAN-GONE", "KAN-2"], find, null, 10).map((i) => i.key)).toEqual([
    "KAN-313",
    "KAN-2",
  ]);
  expect(resolveRecents(["KAN-NEW1", "KAN-2"], find, "KAN-313", 10).map((i) => i.key)).toEqual(["KAN-2"]);
  expect(resolveRecents(["KAN-313", "KAN-2"], find, null, 1).map((i) => i.key)).toEqual(["KAN-313"]);
});
