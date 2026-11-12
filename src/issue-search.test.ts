import { expect, test } from "bun:test";
import { matchIssues, shorthandKey } from "./issue-search";
import type { Issue } from "./store";

const issue = (key: string, summary: string, extra: Partial<Issue> = {}): Issue => ({
  key, board: 1, summary, status: "1", assignee: null, labels: [], comments: 0,
  updated: "2026-11-01T00:00:00Z", resolved: null, ...extra,
});
const map = (...list: Issue[]) => new Map(list.map((i) => [i.key, i]));
const keys = (list: Issue[]) => list.map((i) => i.key);

test("BJ-36: a shorthand key opens that issue, hyphen optional", () => {
  expect(shorthandKey("sam11")).toBe("SAM-11");
  expect(shorthandKey("sam 11")).toBe("SAM-11");
  expect(shorthandKey("Sam-011")).toBeUndefined(); // Linear rejects a zero-padded number
  expect(shorthandKey("login bug")).toBeUndefined();
  const issues = map(issue("SAM-1", "Sam 11 notes"), issue("SAM-11", "Login"), issue("SAM-110", "Other"));
  expect(keys(matchIssues(issues, "sam11"))).toEqual(["SAM-11"]);
  expect(keys(matchIssues(issues, "sam 11"))[0]).toBe("SAM-11");
});
