import { type Board, type Issue, type User, type JiraOptions } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { assignableUsers, knownLabels, statusById, statuses } from "./board-catalog";


const board: Board = {
  id: 1,
  name: "Board",
  columns: [
    { name: "To do", statuses: [{ id: "1", name: "Todo", category: "new" }] },
    { name: "Done", statuses: [{ id: "3", name: "Done", category: "done" }] },
  ],
} as Board;
const issue = (key: string, assignee: User | null, labels: string[] = [], on = 1): Issue =>
  ({ key, board: on, summary: key, status: "1", assignee, labels }) as Issue;

test("statuses come in column order and resolve by id", () => {
  expect(statuses(board).map((s) => s.id)).toEqual(["1", "3"]);
  expect(statusById(board, "3")?.name).toBe("Done");
  expect(statusById(undefined, "3")).toBeUndefined();
});

test("Create and Assign offer the same people: you, Jira's users and every assignee, by name", () => {
  const me = { id: "me", name: "Zed" };
  const jira = [{ id: "j", name: "Jo" }, me];
  const issues = [
    issue("A-1", { id: "b", name: "Bea" }),
    issue("B-1", { id: "o", name: "Al" }, [], 2),
  ];
  // Both pickers call useAssignableUsers, which is this rule over the whole mirror.
  expect(assignableUsers(me, jira, issues).map((u) => u.id)).toEqual(["me", "o", "b", "j"]);
});

test("known labels: the issues' labels first, then Jira's, each once", () => {
  expect(knownLabels([issue("A-1", null, ["b", "a"])], ["a", "c"])).toEqual(["b", "a", "c"]);
});

import { knownPeople, priorityChoices, projectChoices, milestoneChoices } from "./board-catalog";

const options: JiraOptions = {
  users: [],
  labels: [],
  priorities: [{ id: "2", name: "High" }],
  versions: { A: [{ id: "v1", name: "Beta" }] },
};
test("catalog deduplicates priorities and preserves local Normal only without Jira writes", () => {
  const issues = [
    { ...issue("A-1", null), priority: "Urgent" },
    { ...issue("A-2", null), priority: "High" },
  ];
  expect(priorityChoices(options, issues, false)).toEqual(["Urgent", "High", "Normal"]);
  expect(priorityChoices(options, issues, true)).toEqual(["Urgent", "High"]);
});
test("project and milestone choices are deduplicated and scoped to the project", () => {
  const project = { key: "A", name: "Alpha" };
  const issues = [
    {
      ...issue("A-1", null),
      project,
      milestones: [
        { id: "v1", name: "Beta" },
        { id: "v2", name: "Release" },
      ],
    },
    { ...issue("A-2", null), project },
    {
      ...issue("B-1", null),
      project: { key: "B", name: "Bravo" },
      milestones: [{ id: "other", name: "Other" }],
    },
  ];
  expect(projectChoices(issues).map((p) => p.key)).toEqual(["A", "B"]);
  expect(milestoneChoices(options, issues, "A").map((m) => m.id)).toEqual(["v1", "v2"]);
});
test("people includes Jira users, creators, watchers and extras once, with current records first", () => {
  const me = { id: "me", name: "Me" },
    author = { id: "a", name: "Author" },
    watcher = { id: "w", name: "Watcher" };
  const issues = [
    {
      ...issue("A-1", { id: "me", name: "Old name" }),
      creator: author,
      watchers: [watcher],
    },
  ];
  expect(
    knownPeople(me, [{ id: "j", name: "Jira" }], issues, [watcher, { id: "x", name: "Extra" }]),
  ).toEqual([me, author, { id: "x", name: "Extra" }, { id: "j", name: "Jira" }, watcher]);
});
