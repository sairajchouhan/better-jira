import { expect, test } from "bun:test";
import type { HistoryEntry, HistoryItem } from "@/shared/jira-history";
import { activityRows, type PropertyActivity } from "./issue-activity";
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

/** Every row's changes, the head's and the ones it expands to. */
const reachable = (events: PropertyActivity[], breaks: string[] = []) =>
  activityRows(events, breaks).flatMap((row) => [...row.events, ...row.chain]);

test("F2: every Jira change stays reachable at its own time; nothing merges or cancels across changelog entries", () => {
  const labels = (from: string, to: string) => item("labels", { fromText: from, toText: to }, "labels");
  // DRFT-953's shape: one person's agent toggles a label on and off for hours between status moves and description edits.
  const history = [
    entry([labels("", "agentic")]),
    entry([status("Selected", "To Do")], 4 * 60_000),
    entry([status("To Do", "Selected")], 11 * 60_000),
    entry([labels("agentic", "agent-working agentic")], 24 * 60_000),
    entry([status("Selected", "In Progress")], 25 * 60_000),
    entry([labels("agent-working agentic", "agentic")], 44 * 60_000),
    entry([item("description", { fromText: "", toText: "" }, "description")], 50 * 60_000),
    entry([labels("agentic", "agent-working agentic")], 55 * 60_000),
    entry([labels("agent-working agentic", "agent-blocked agentic")], 70 * 60_000),
    // Noise Linear never shows, and a resolution that is its transition's.
    entry([item("Rank", { toText: "Ranked higher" }), status("In Progress", "Done"), item("resolution", { to: "1", toText: "Done" }, "resolution")], 80 * 60_000),
    entry([item("Attachment", { to: "1", toText: "a.png" }, "attachment")], 81 * 60_000),
    entry([item("Attachment", { from: "1", fromText: "a.png" }, "attachment")], 82 * 60_000),
    entry([item("Link", { to: "ABC-2", toText: "This work item blocks ABC-2" })], 83 * 60_000),
    entry([item("Link", { from: "ABC-2", fromText: "This work item blocks ABC-2" })], 84 * 60_000),
  ];
  const events = mergeHistory([], history);
  const hidden = new Set(["Rank", "resolution"]);
  const expected = history.flatMap((e) =>
    e.items.flatMap((i, index) => (hidden.has(i.field) ? [] : [{ id: `jira-${e.id}-${index}`, at: e.at }])),
  );
  expect(reachable(events).map((e) => ({ id: e.id, at: e.at })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    expected.sort((a, b) => a.id.localeCompare(b.id)),
  );
});

test("F2: adjacent changes Linear groups (Xc) form one row at the latest change's time, one actor's for status and labels", () => {
  const history = [
    entry([status("To Do", "Selected")]),
    entry([status("Selected", "In Progress")], 10 * 60_000),
    entry([status("In Progress", "Review")], 3 * 60 * 60_000),
    // Another actor's move starts its own row.
    entry([status("Review", "QA")], 3 * 60 * 60_000 + 1_000, bot),
    entry([item("labels", { fromText: "a", toText: "a b" }, "labels")], 4 * 60 * 60_000),
    entry([item("labels", { fromText: "a b", toText: "a" }, "labels")], 4 * 60 * 60_000 + 5_000),
    // Adding one label while removing another is Linear's aggregated entry (`ss`), which never groups.
    entry([item("labels", { fromText: "a", toText: "c" }, "labels")], 4 * 60 * 60_000 + 9_000),
  ];
  const rows = activityRows(mergeHistory([], history));
  expect(rows.map((r) => [r.field, r.actor.id, r.events.length + r.chain.length, r.at])).toEqual([
    ["status", "ada", 3, at(3 * 60 * 60_000)],
    ["status", "bot", 1, at(3 * 60 * 60_000 + 1_000)],
    ["labels", "ada", 2, at(4 * 60 * 60_000 + 5_000)],
    ["labels", "ada", 1, at(4 * 60 * 60_000 + 9_000)],
  ]);
  // Each grouped change keeps its own time for the expanded list.
  expect(rows[0]!.chain.map((e) => e.at)).toEqual([at(10 * 60_000), at(3 * 60 * 60_000)]);
});

test("F2: a comment or attached link between two changes keeps them apart, as Linear groups only within a run", () => {
  const events = mergeHistory([], [entry([status("To Do", "Selected")]), entry([status("Selected", "Done")], 60_000)]);
  expect(activityRows(events, [at(30_000)]).map((r) => r.chain.length)).toEqual([0, 0]);
  expect(activityRows(events, [at(90_000)]).map((r) => r.chain.length)).toEqual([1]);
});

test("F2: DRFT-784's burst of attachments keeps each file at its own upload time", () => {
  const files = Array.from({ length: 8 }, (_, i) =>
    entry([item("Attachment", { to: String(i), toText: `clip-${i}.png` }, "attachment")], 6_000 + i * 120),
  );
  const rows = activityRows(mergeHistory([], [entry([item("labels", { fromText: "", toText: "bug" }, "labels")]), ...files]));
  expect(rows.map((r) => r.at)).toEqual([at(), ...files.map((f) => f.at)]);
});

test("F2: a description edit is listed though the server drops its text", () => {
  const events = mergeHistory([], [entry([item("description", { fromText: "", toText: "" }, "description")])]);
  expect(fields(events)).toEqual([["description", "", ""]]);
  expect(activityRows(events)).toHaveLength(1);
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

test("BJ-196: time tracking uses Jira working durations and project moves keep both issue keys", () => {
  for (const fieldId of ["timeestimate", "timespent", "timeoriginalestimate"]) {
    expect(mapItem({ field: "Time", fieldId, from: "7200", fromText: "7200", to: "43200", toText: "43200" }, [])).toMatchObject({
      before: { value: "2h" }, after: { value: "1d 4h" },
    });
  }
  const move = { field: "project", from: "1", fromText: "Old", to: "2", toText: "New" };
  expect(mapItem(move, [move, { field: "Key", from: null, to: null, fromText: "OLD-1", toText: "NEW-1" }])).toMatchObject({
    before: { key: "OLD-1" }, after: { key: "NEW-1" },
  });
});

test("BJ-196: title changes coalesce up to one minute, then remain expandable history", () => {
  const title = (id: string, ms: number, fromText: string, toText: string): HistoryEntry => ({ id, actor: ada, at: at(ms), items: [{ field: "summary", from: null, to: null, fromText, toText }] });
  const rows = activityRows(mergeHistory([], [title("1", 0, "A", "B"), title("2", 60_000, "B", "C"), title("3", 120_001, "C", "D")]));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.events[0]).toMatchObject({ before: "A", after: "C", at: at(60_000) });
  expect(rows[0]!.chain).toHaveLength(1);
  expect(rows[0]!.chain[0]).toMatchObject({ before: "C", after: "D" });
});
