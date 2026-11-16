import { expect, test } from "bun:test";
import type { Issue } from "@/shared/issue-model";
import { markChanged, mergeProperties } from "./local-edits";
import { set } from "./store";

const issue = (boards: number[]) =>
  ({ key: "TEAM-1", boards, summary: "Shared", status: "1", assignee: null, labels: [], comments: 0, updated: "2026-11-01T10:00:00Z", resolved: null }) as Issue;

test("a poll that only changes which boards hold an issue reaches the tab, though Jira's updated is the same", () => {
  set({ issues: new Map([["TEAM-1", issue([1])]]) });
  const joined = mergeProperties({ "TEAM-1": issue([1, 2]) }).issues;
  expect(joined?.get("TEAM-1")?.boards).toEqual([1, 2]);
  set({ issues: joined! });
  expect(mergeProperties({ "TEAM-1": issue([2]) }).issues?.get("TEAM-1")?.boards).toEqual([2]);
});

test("BJ-338: a tab that keeps edits local still takes the issues Jira adds, but never one deleted here", () => {
  set({ writable: false, issues: new Map([["TEAM-1", issue([1])]]) });
  // TEAM-2 was deleted in this tab: a local change marks it.
  markChanged("TEAM-2");
  const merged = mergeProperties({
    "TEAM-1": issue([1]),
    "TEAM-2": { ...issue([1]), key: "TEAM-2" },
    "TEAM-3": { ...issue([1]), key: "TEAM-3" },
  }).issues;
  expect([...merged!.keys()].sort()).toEqual(["TEAM-1", "TEAM-3"]);
});

test("a pull request number the mirror stops sending leaves the issue, so the badge never shows an old pull request's number", () => {
  set({ writable: false, issues: new Map([["TEAM-1", { ...issue([1]), prCount: 1, prStatus: "open", prNumber: "#2965" } as Issue]]) });
  // A second pull request linked: Jira's state moved and no number for two.
  const two = mergeProperties({ "TEAM-1": { ...issue([1]), prCount: 2 } }).issues!.get("TEAM-1")!;
  expect([two.prCount, two.prStatus, two.prNumber]).toEqual([2, undefined, undefined]);
});
