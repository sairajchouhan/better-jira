import { expect, test } from "bun:test";
import {
  canHaveChildren,
  canHaveSubIssues,
  canParent,
  childTypes,
  matchRank,
  needsParent,
  pullRequestSummary,
  statusDates,
  typeChoices,
} from "./issue-properties";

const categories = (id: string) =>
  (({ todo: "new", doing: "indeterminate", done: "done" }) as Record<string, string>)[id];
test("uses the latest real entry into the current status and first started transition", () => {
  const histories = [
    { created: "2026-11-02T10:00:00Z", items: [{ fieldId: "status", from: "todo", to: "doing" }] },
    {
      created: Date.parse("2026-11-03T10:00:00Z"),
      items: [{ fieldId: "status", from: "doing", to: "done" }],
    },
    { created: "2026-11-04T10:00:00Z", items: [{ fieldId: "status", from: "done", to: "doing" }] },
    { created: "2026-11-05T10:00:00Z", items: [{ fieldId: "status", from: "doing", to: "doing" }] },
  ];
  expect(statusDates("2026-11-01T10:00:00Z", "doing", histories, categories)).toEqual({
    statusSince: "2026-11-04T10:00:00.000Z",
    started: "2026-11-02T10:00:00.000Z",
  });
});
test("keeps a stale status snapshot unknown rather than attaching a different status's timestamp", () => {
  expect(
    statusDates(
      "2026-11-01T10:00:00Z",
      "todo",
      [{ created: 1793613600000, items: [{ fieldId: "status", from: "todo", to: "doing" }] }],
      categories,
    ).statusSince,
  ).toBeUndefined();
  expect(statusDates("2026-11-01T10:00:00Z", "todo", [], categories).statusSince).toBe(
    "2026-11-01T10:00:00Z",
  );
});
test("distinguishes empty Jira development summaries from unsupported or missing summaries", () => {
  expect(pullRequestSummary("{}")).toEqual({ count: 0 });
  expect(pullRequestSummary({ cachedValue: { summary: { pullrequest: { overall: { count: 3 } } } } })).toEqual({ count: 3 });
  expect(pullRequestSummary(undefined)).toBeUndefined();
  expect(pullRequestSummary("unrecognized")).toBeUndefined();
  expect(pullRequestSummary({ somethingElse: 2 })).toBeUndefined();
  expect(
    pullRequestSummary('{build={count=1}, json={"cachedValue":{"summary":{"build":{"overall":{"count":1}}}},"isStale":true}}'),
  ).toEqual({ count: 0 });
  expect(
    pullRequestSummary('{pullrequest={count=2}, json={"cachedValue":{"summary":{"pullrequest":{"overall":{"count":2}}}}}}'),
  ).toEqual({ count: 2 });
});

test("reads the PR count and Jira's summary state from the Development field a search returns, per Jira state", () => {
  // The shape live Jira returns (made-up dates): a Java-map wrapper around the dev summary JSON.
  const field = (count: number, state: string) =>
    `{pullrequest={dataType=pullrequest, state=${state}, stateCount=${count}}, json={"cachedValue":{"errors":[],"summary":{"pullrequest":{"overall":{"count":${count},"lastUpdated":"2026-01-02T10:00:00.000+0530","stateCount":${count},"state":"${state}","open":${state === "OPEN"},"dataType":"pullrequest"},"byInstanceType":{"oAuth-com.github.integration.production":{"count":${count},"name":"GitHub"}}}}},"isStale":true}}`;
  expect(pullRequestSummary(field(1, "MERGED"))).toEqual({ count: 1, status: "merged" });
  expect(pullRequestSummary(field(2, "DRAFT"))).toEqual({ count: 2, status: "draft" });
  expect(pullRequestSummary(field(1, "OPEN"))).toEqual({ count: 1, status: "open" });
  expect(pullRequestSummary(field(3, "DECLINED"))).toEqual({ count: 3, status: "declined" });
  expect(pullRequestSummary(field(1, "SOMETHING_NEW"))).toEqual({ count: 1 });
});

test("type choices stay at the issue's Jira hierarchy level", () => {
  const types = [
    { name: "Epic", hierarchyLevel: 1 },
    { name: "Subtask", hierarchyLevel: -1 },
    { name: "Task", hierarchyLevel: 0 },
    { name: "Story", hierarchyLevel: 0 },
  ];
  expect(typeChoices("Task", types, [])).toEqual(["Task", "Story"]);
  expect(typeChoices("Subtask", types, ["Task"])).toEqual(["Subtask"]);
  expect(typeChoices("Epic", types, [])).toEqual(["Epic"]);
  // Local mode has no Jira type list: offer what the project already uses.
  expect(typeChoices("Task", undefined, ["Bug", "Task"])).toEqual(["Task", "Bug"]);
});

test("hierarchy pickers offer only what Jira accepts: a parent one level up in the same project", () => {
  const levels = [
    { name: "Epic", hierarchyLevel: 1 },
    { name: "Task", hierarchyLevel: 0 },
    { name: "Story", hierarchyLevel: 0 },
    { name: "Subtask", hierarchyLevel: -1 },
  ];
  const jira = { writable: true, options: { types: { KAN: levels, SAM1: levels } } };
  const kan = (type: string) => ({ type, project: { key: "KAN" } });
  expect(canParent(jira, kan("Epic"), kan("Task"))).toBe(true);
  expect(canParent(jira, kan("Task"), kan("Subtask"))).toBe(true);
  expect(canParent(jira, kan("Story"), kan("Task"))).toBe(false);
  expect(canParent(jira, kan("Subtask"), kan("Task"))).toBe(false);
  expect(canParent(jira, { type: "Epic", project: { key: "SAM1" } }, kan("Task"))).toBe(false);
  expect(childTypes(jira, kan("Epic"))).toEqual(["Task", "Story"]);
  expect(childTypes(jira, kan("Task"))).toEqual(["Subtask"]);
  expect(canHaveChildren(jira, kan("Subtask"))).toBe(false);
  expect(needsParent(jira, kan("Subtask"))).toBe(true);
  expect(needsParent(jira, kan("Task"))).toBe(false);
  // Local mode isn't bound by Jira's rules.
  const local = { ...jira, writable: false };
  expect(canParent(local, kan("Story"), kan("Task"))).toBe(true);
  expect(canHaveChildren(local, kan("Subtask"))).toBe(true);
  expect(needsParent(local, kan("Subtask"))).toBe(false);
});

test("BJ-280: an epic's section adds its issues, as Jira's epic page does; an initiative's adds none", () => {
  const levels = [
    { name: "Initiative", hierarchyLevel: 2 },
    { name: "Epic", hierarchyLevel: 1 },
    { name: "Task", hierarchyLevel: 0 },
    { name: "Subtask", hierarchyLevel: -1 },
  ];
  const jira = { writable: true, options: { types: { KAN: levels } } };
  const local = { ...jira, writable: false };
  const kan = (type: string) => ({ type, project: { key: "KAN" } });
  // Jira takes the epic's issues under it, and its Sub-issues section lists and adds them (BJ-280).
  expect(canHaveChildren(jira, kan("Epic"))).toBe(true);
  expect(canHaveSubIssues(jira, kan("Epic"))).toBe(true);
  expect(canHaveSubIssues(local, kan("Epic"))).toBe(true);
  // An initiative's children are epics, never sub-issues.
  expect(canHaveChildren(jira, kan("Initiative"))).toBe(true);
  expect(canHaveSubIssues(jira, kan("Initiative"))).toBe(false);
  expect(canHaveSubIssues(local, kan("Initiative"))).toBe(false);
  expect(canHaveSubIssues(jira, kan("Task"))).toBe(true);
  expect(canHaveSubIssues(jira, kan("Subtask"))).toBe(false);
});

test("search ranks an exact match above a partial one", () => {
  const rank = (summary: string) => matchRank("relations child A", { key: "KAN-1", summary });
  expect(rank("relations child A")).toBe(0);
  expect(rank("[QA] relations child A")).toBe(2);
  expect(rank("[QA] relations child Ab")).toBe(3);
  expect(rank("[QA] relations child B")).toBe(5);
  expect(rank("[QA] relations parent")).toBe(-1);
  expect(matchRank("kan-1", { key: "KAN-1", summary: "x" })).toBe(0);
  expect(matchRank("(", { key: "KAN-1", summary: "a (b)" })).toBe(3); // regex characters are literal
});
