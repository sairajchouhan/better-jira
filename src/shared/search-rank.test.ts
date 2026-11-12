import { expect, test } from "bun:test";
import { matchRank } from "./search-rank";

test("exact, prefix and whole-word matches outrank looser ones", () => {
  const titles = [
    "[QA] issue-fields Due date sub",
    "[QA] issue-fields Deep link",
    "[QA] issue-fields D epic",
  ];
  const ranked = [...titles].sort(
    (a, b) => matchRank(a, "issue-fields D") - matchRank(b, "issue-fields D"),
  );
  expect(ranked[0]).toBe("[QA] issue-fields D epic");

  const commands = ["Open sub-issues of parent", "Open sub-issue"];
  expect(
    [...commands].sort((a, b) => matchRank(a, "Open sub-issue") - matchRank(b, "Open sub-issue")),
  ).toEqual(["Open sub-issue", "Open sub-issues of parent"]);
  expect(matchRank("Open sub-issue", "sub-issue")).toBe(2);
  expect(matchRank("Open sub-issues of parent", "sub-issue")).toBe(3);
  expect(matchRank("Move down", "ove")).toBe(4);
  expect(matchRank("Change issue status", "status issue")).toBe(5);
  expect(matchRank("Change issue status", "priority")).toBe(-1);
});
