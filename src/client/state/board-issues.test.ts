import { expect, test } from "bun:test";
import type { Issue } from "@/shared/issue-model";
import { boardIssues } from "./board-issues";

const issue = (key: string, boards: number[]) =>
  ({ key, boards, summary: key, status: "1", assignee: null, labels: [], comments: 0, updated: "", resolved: null }) as Issue;

test("an issue two boards hold is listed on both; one only linked from a board is on none", () => {
  const all = new Map(
    [issue("TEAM-1", [1, 2]), issue("TEAM-2", [1]), issue("SQUAD-1", [2]), issue("OTHER-9", [])].map((i) => [i.key, i]),
  );
  expect(boardIssues(all, 1).map((i) => i.key)).toEqual(["TEAM-1", "TEAM-2"]);
  expect(boardIssues(all, 2).map((i) => i.key)).toEqual(["TEAM-1", "SQUAD-1"]);
  expect(boardIssues(all, undefined)).toEqual([]);
});
