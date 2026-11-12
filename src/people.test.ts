import { expect, test } from "bun:test";
import { peopleOf, personIssues } from "./people";
import type { Issue } from "./store";

const alex = { id: "alex", name: "Alex" }, me = { id: "me", name: "Me" };
const issue = (key: string, extra: Partial<Issue> = {}): Issue => ({
  key, board: 1, summary: key, status: "1", assignee: null, labels: [], comments: 0, updated: "", resolved: null, ...extra,
});
const issues = [
  issue("A-1", { assignee: alex }),
  issue("A-2", { creator: alex, watching: true }),
  issue("A-3", { watchers: [alex] }),
  issue("A-4", { activity: [{ id: "1", field: "status", before: "", after: "", actor: alex, at: "" }] }),
  issue("A-5", { assignee: me }),
];
const keys = (user: string, tab: Parameters<typeof personIssues>[1]) =>
  issues.filter(personIssues(user, tab, "me")).map((i) => i.key);

test("BJ-28 / BJ-77: a person's Assigned, Created, Subscribed and Activity lists", () => {
  expect(keys("alex", "assigned")).toEqual(["A-1"]);
  expect(keys("alex", "created")).toEqual(["A-2"]);
  expect(keys("alex", "subscribed")).toEqual(["A-3"]);
  expect(keys("me", "subscribed")).toEqual(["A-2"]); // my own watching, before the watcher list loads
  expect(keys("alex", "activity")).toEqual(["A-1", "A-2", "A-4"]);
  expect(peopleOf(issues).map((u) => u.id)).toEqual(["alex", "me"]);
});
