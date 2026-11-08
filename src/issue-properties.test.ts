import { expect, test } from "bun:test";
import { pullRequestCount, statusDates, typeChoices } from "./issue-properties";

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
  expect(pullRequestCount("{}")).toBe(0);
  expect(
    pullRequestCount({ cachedValue: { summary: { pullrequest: { overall: { count: 3 } } } } }),
  ).toBe(3);
  expect(pullRequestCount(undefined)).toBeUndefined();
  expect(pullRequestCount("unrecognized")).toBeUndefined();
  expect(pullRequestCount({ somethingElse: 2 })).toBeUndefined();
  expect(
    pullRequestCount(
      '{build={count=1}, json={"cachedValue":{"summary":{"build":{"overall":{"count":1}}}},"isStale":true}}',
    ),
  ).toBe(0);
  expect(
    pullRequestCount(
      '{pullrequest={count=2}, json={"cachedValue":{"summary":{"pullrequest":{"overall":{"count":2}}}}}}',
    ),
  ).toBe(2);
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
