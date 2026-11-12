import { expect, test } from "bun:test";
import type { HistoryEntry, HistoryItem } from "@/shared/jira-history";
import { activityRows, GROUP_MS, type PropertyActivity } from "./issue-activity";
import { historyChanges, linkRelation, mapItem, mergeHistory } from "./jira-history";

// Made-up fixtures with the shapes Jira's changelog uses (sampled read-only from real tickets, BJ-40).
const ada = { id: "ada", name: "Ada Example" },
  bot = { id: "bot", name: "Automation for Jira", app: true },
  start = Date.parse("2026-03-01T09:00:00Z");
const at = (ms = 0) => new Date(start + ms).toISOString();
const item = (field: string, sides: Partial<HistoryItem> = {}, fieldId?: string): HistoryItem => ({
  field,
  ...(fieldId ? { fieldId } : {}),
  from: null,
  fromText: null,
  to: null,
  toText: null,
  ...sides,
});
let n = 0;
const entry = (items: HistoryItem[], ms = 0, actor: HistoryEntry["actor"] = ada): HistoryEntry => ({
  id: String(++n),
  at: at(ms),
  actor,
  items,
});
const status = (from: string, to: string) =>
  item("status", { from: from.toLowerCase(), fromText: from, to: to.toLowerCase(), toText: to }, "status");
const fields = (events: PropertyActivity[]) => events.map((e) => [e.field, e.before, e.after]);

test("BJ-40: each sampled Jira change kind maps to its Linear field", () => {
  const one = (i: HistoryItem) => mapItem(i, [i]);
  expect(one(status("To Do", "In Progress"))).toMatchObject({
    field: "status",
    before: { id: "to do", name: "To Do" },
    after: { id: "in progress", name: "In Progress" },
  });
  expect(one(item("assignee", { to: "u2", toText: "Grace Example" }, "assignee"))).toMatchObject({
    field: "assignee",
    before: null,
    after: { id: "u2", name: "Grace Example" },
  });
  expect(one(item("labels", { fromText: "alpha", toText: "alpha beta" }, "labels"))).toMatchObject({
    before: ["alpha"],
    after: ["alpha", "beta"],
  });
  expect(one(item("IssueParentAssociation", { to: "100", toText: "ABC-1" }))).toMatchObject({
    field: "parent",
    after: "ABC-1",
  });
  expect(one(item("IssueParentAssociation", { from: "100", fromText: "ABC-1" }))).toMatchObject({
    field: "parent",
    before: "ABC-1",
    after: null,
  });
  expect(one(item("Link", { to: "ABC-2", toText: "This work item blocks ABC-2" }))).toMatchObject({
    field: "relation",
    before: null,
    after: { key: "ABC-2", kind: "blocking" },
  });
  expect(one(item("Link", { from: "ABC-3", fromText: "This work item clones ABC-3" }))).toMatchObject({
    before: { key: "ABC-3", kind: "clones" },
    after: null,
  });
  expect(one(item("Attachment", { to: "9", toText: "clip.mp4" }, "attachment"))).toMatchObject({
    field: "attachment",
    after: { id: "9", name: "clip.mp4" },
  });
  expect(one(item("Fix Version", { to: "7", toText: "Release 1" }, "fixVersions"))).toMatchObject({
    field: "milestone",
    after: { id: "7", name: "Release 1" },
  });
  expect(one(item("Component", { to: "5", toText: "Editor" }, "components"))).toMatchObject({
    field: "component",
  });
  expect(one(item("Sprint", { from: "", fromText: "", to: "3", toText: "Sprint 10" }, "customfield_1"))).toMatchObject({
    field: "cycle",
    before: null,
    after: [{ id: "3", name: "Sprint 10" }],
  });
  // An issue carried into the next sprint lists both, ids and names in step.
  expect(
    one(item("Sprint", { from: "3", fromText: "Sprint 10", to: "3, 4", toText: "Sprint 10, Sprint 11" }, "customfield_1")),
  ).toMatchObject({
    before: [{ id: "3", name: "Sprint 10" }],
    after: [
      { id: "3", name: "Sprint 10" },
      { id: "4", name: "Sprint 11" },
    ],
  });
  expect(one(item("Story Points", { fromText: "2", toText: "" }, "customfield_2"))).toMatchObject({
    field: "estimate",
    before: 2,
    after: null,
  });
  expect(one(item("Team", { to: "t-1", toText: "Builders" }, "customfield_3"))).toMatchObject({
    field: "team",
    after: "Builders",
  });
  expect(one(item("RemoteWorkItemLink", { to: "4", toText: 'This work item links to "Wiki Page"' }))).toMatchObject({
    field: "weblink",
  });
  expect(one(item("project", { from: "1", fromText: "Old", to: "2", toText: "New" }, "project"))).toMatchObject({
    field: "project",
    after: { id: "2", name: "New" },
  });
  expect(one(item("summary", { fromText: "Old title", toText: "New title" }, "summary"))).toMatchObject({
    field: "title",
  });
  expect(one(item("description", { fromText: "", toText: "" }, "description"))).toMatchObject({
    field: "description",
  });
  expect(one(item("Comment", { fromText: "" }, "comment"))).toMatchObject({ field: "comment", after: null });
  expect(one(item("Release notes", { toText: "Shipped" }, "customfield_9"))).toMatchObject({
    field: "field",
    after: { name: "Release notes", value: "Shipped" },
  });
  // Noise Linear never shows, and the new key that is half of a move.
  for (const noise of ["Rank", "Epic Color", "Issue color", "Key"])
    expect(one(item(noise, { toText: "x" }))).toBeNull();
});

test("BJ-40: a resolution set by its transition is that status change; one set alone is shown", () => {
  const resolution = item("resolution", { to: "1", toText: "Done" }, "resolution");
  expect(mapItem(resolution, [resolution, status("Review", "Done")])).toBeNull();
  expect(mapItem(resolution, [resolution])).toMatchObject({ field: "resolution", after: "Done" });
});

test("BJ-40: Jira link phrases become Linear relation kinds", () => {
  expect(linkRelation("This work item is blocked by ABC-9", "ABC-9")).toEqual({ key: "ABC-9", kind: "blocked" });
  expect(linkRelation("This issue relates to ABC-9", "ABC-9")).toEqual({ key: "ABC-9", kind: "related" });
  expect(linkRelation("This work item is duplicated by ABC-9", null)).toEqual({ key: "ABC-9", kind: "duplicated" });
  expect(linkRelation(null, "ABC-9")).toEqual({ key: "ABC-9", kind: "related" });
});

test("BJ-13: Jira changes group like this app's edits: one actor, under an hour since the last, at the group's first time", () => {
  const history = [
    entry([item("labels", { fromText: "", toText: "alpha" }, "labels")]),
    entry([item("labels", { fromText: "alpha", toText: "alpha beta" }, "labels")], 4_000),
    entry([status("To Do", "Selected")], 8_000),
    entry([item("assignee", { to: "ada", toText: "Ada Example" }, "assignee")], 50 * 60_000),
    // Another actor starts a new group; Ada's next change then starts another.
    entry([item("labels", { fromText: "alpha beta", toText: "alpha beta gamma" }, "labels")], 51 * 60_000, bot),
    entry([status("Selected", "In Progress")], 52 * 60_000),
  ];
  const events = mergeHistory([], history);
  expect(events.map((e) => [e.field, e.actor.id, e.at])).toEqual([
    ["labels", "ada", at()],
    ["status", "ada", at()],
    ["assignee", "ada", at()],
    ["labels", "bot", at(51 * 60_000)],
    ["status", "ada", at(52 * 60_000)],
  ]);
  expect(events[0]).toMatchObject({ before: [], after: ["alpha", "beta"] });
  // The group's status is its own row; its labels and assignee share one.
  expect(activityRows(events).map((r) => [r.field, r.actor.id])).toEqual([
    ["status", "ada"],
    ["multi", "ada"],
    ["labels", "bot"],
    ["status", "ada"],
  ]);
});

test("BJ-13: a value changed back inside its group drops out; a group ends an hour after its last change", () => {
  const events = mergeHistory(
    [],
    [
      entry([item("priority", { fromText: "Low", toText: "High" }, "priority")]),
      entry([item("priority", { fromText: "High", toText: "Low" }, "priority")], 30 * 60_000),
      entry([item("Attachment", { to: "1", toText: "a.png" }, "attachment")], 31 * 60_000),
      entry([item("Attachment", { from: "1", fromText: "a.png" }, "attachment")], 32 * 60_000),
      entry([item("priority", { fromText: "Low", toText: "High" }, "priority")], 32 * 60_000 + GROUP_MS),
    ],
  );
  expect(activityRows(events).map((r) => [r.field, r.events.map((e) => e.after), r.at])).toEqual([
    ["priority", ["High"], at(32 * 60_000 + GROUP_MS)],
  ]);
});

test("BJ-13: relations stay one row each, and one removed within the hour drops its add", () => {
  const events = mergeHistory(
    [],
    [
      entry([item("Link", { to: "ABC-2", toText: "This work item blocks ABC-2" })]),
      entry([item("Link", { to: "ABC-3", toText: "This work item relates to ABC-3" })], 1_000),
      entry([item("Link", { from: "ABC-2", fromText: "This work item blocks ABC-2" })], 2_000),
    ],
  );
  expect(fields(events)).toEqual([["relation", null, { key: "ABC-3", kind: "related" }]]);
});

test("BJ-13: an edit made here appears once: Jira's echo replaces it, an unsent one stays", () => {
  const local: PropertyActivity[] = [
    { id: "l1", field: "status", before: "to do", after: "in progress", actor: ada, at: at() },
    { id: "l2", field: "priority", before: null, after: "High", actor: ada, at: at() },
    { id: "l3", field: "relation", before: null, after: { key: "ABC-2", kind: "blocking" }, actor: ada, at: at() },
  ];
  const events = mergeHistory(local, [
    entry([status("To Do", "In Progress")], 5_000),
    entry([item("Link", { to: "ABC-2", toText: "This work item blocks ABC-2" })], 6_000),
  ]);
  expect(events.map((e) => e.id)).toEqual(["jira-" + (n - 1) + "-0", "jira-" + n + "-0", "l2"]);
  // Someone else's matching change, or one from before the edit, is not an echo.
  const other = mergeHistory(local.slice(0, 1), [entry([status("To Do", "In Progress")], -3_600_000)]);
  expect(other.map((e) => e.id)).toContain("l1");
});

test("BJ-13: an app's change keeps its actor; an entry with no author reads as someone", () => {
  const changes = historyChanges([
    entry([item("Team", { to: "t", toText: "Builders" }, "customfield_1")], 0, bot),
    { id: "x", at: at(), actor: null, items: [item("labels", { fromText: "", toText: "a" }, "labels")] },
  ]);
  expect(changes.map((c) => c.actor)).toEqual([bot, { id: "unknown", name: "Someone" }]);
});
