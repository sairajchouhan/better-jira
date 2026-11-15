import { expect, test } from "bun:test";
import type { Issue } from "@/shared/issue-model";
import { mergeProperties } from "./local-edits";
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
