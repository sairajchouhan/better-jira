import { type PropertyActivity } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { GROUP_MS, activityEvents, activityRows, recordActivity, recordRelation, rollbackActivity, visibleActivity } from "./issue-activity";
const me = { id: "me", name: "Me" },
  start = Date.parse("2026-11-08T09:00:00Z");
let n = 0;
const id = () => `e${++n}`,
  at = (ms = 0) => new Date(start + ms).toISOString();
const change = (
  events: readonly PropertyActivity[],
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  ms = 0,
) => recordActivity(events, before, patch, me, at(ms), id);
test("a priority round trip inside the group hides the event, and the next edit reuses the emptied group time, as on RAJ-52", () => {
  const low = change([], { priority: null }, { priority: "Low" });
  expect(low).toMatchObject([{ field: "priority", before: null, after: "Low", at: at() }]);
  const high = change(low, { priority: "Low" }, { priority: "High" }, 420_000);
  expect(high).toHaveLength(1);
  expect(high[0]).toMatchObject({ before: null, after: "High", at: at() });
  const back = change(high, { priority: "High" }, { priority: null }, 430_000);
  expect(visibleActivity(back)).toEqual([]);
  expect(
    visibleActivity(change(back, { status: "todo" }, { status: "progress" }, 600_000)),
  ).toMatchObject([{ field: "status", at: at() }]);
});
test("another field joins the open group and takes its time; the window runs from the group's last edit, as on RAJ-52", () => {
  const events = change(
    change([], { priority: null }, { priority: "Low" }),
    { status: "todo" },
    { status: "progress" },
    360_000,
  );
  expect(events.map((e) => [e.field, e.at])).toEqual([
    ["priority", at()],
    ["status", at()],
  ]);
  // 62.7 min after the group started but under an hour after its last edit (the 6 min status change): it joins and the group keeps its time.
  const later = change(events, { priority: "Low" }, { priority: "Medium" }, 3_761_000);
  expect(later.map((e) => [e.field, e.before, e.after, e.at])).toEqual([
    ["priority", null, "Medium", at()],
    ["status", "todo", "progress", at()],
  ]);
  // An hour after the last edit starts a new group; the old one keeps its time.
  const next = change(later, { labels: [] }, { labels: ["bug"] }, 3_761_000 + GROUP_MS);
  expect(next.map((e) => [e.field, e.at])).toEqual([
    ["priority", at()],
    ["status", at()],
    ["labels", at(3_761_000 + GROUP_MS)],
  ]);
  // Another actor's edit still starts its own group.
  expect(
    recordActivity(
      later,
      { priority: "Medium" },
      { priority: "High" },
      { id: "other", name: "Other" },
      at(3_800_000),
      id,
    ),
  ).toHaveLength(3);
});
test('rows follow Linear: status alone, the group\'s other changes on one row, and lone same-field rows joined by "then" at the later time (RAJ-52)', () => {
  const low = change([], { priority: null }, { priority: "Low" });
  const removed = change(low, { priority: "Low" }, { priority: null }, 3_761_000);
  const rows = activityRows(removed);
  expect(
    rows.map((r) => [r.field, r.events.map((e) => e.after), r.chain.map((e) => e.after), r.at]),
  ).toEqual([["priority", ["Low"], [null], at(3_761_000)]]);
  // The later group gains a label: it is no longer a lone priority change, so both rows stand alone, each at its own time.
  const labelled = change(removed, { labels: [] }, { labels: ["bug"] }, 3_761_000 + 1_200_000);
  expect(
    activityRows(labelled).map((r) => [
      r.field,
      r.events.map((e) => e.field),
      r.chain.length,
      r.at,
    ]),
  ).toEqual([
    ["priority", ["priority"], 0, at()],
    ["multi", ["priority", "labels"], 0, at(3_761_000)],
  ]);
  // A status change takes its own row, ahead of the group's other changes.
  const moved = change(labelled, { status: "todo" }, { status: "progress" }, 3_761_000 + 1_500_000);
  expect(activityRows(moved).map((r) => [r.field, r.events.map((e) => e.field)])).toEqual([
    ["priority", ["priority"]],
    ["status", ["status"]],
    ["multi", ["priority", "labels"]],
  ]);
});
test("an edit 30.5 min after the group started still joins it, as on RAJ-52", () => {
  const medium = change([], { priority: null }, { priority: "Medium" });
  expect(
    visibleActivity(change(medium, { priority: "Medium" }, { priority: null }, 1_830_000)),
  ).toEqual([]);
});
test("a description edit moves the open group to its time, and later edits join it there, as on RAJ-52", () => {
  const low = change([], { priority: null }, { priority: "Low" });
  expect(change([], { description: "a" }, { description: "b" }, 60_000)).toEqual([]);
  expect(change(low, { description: "a" }, { description: "b" }, GROUP_MS + 1)).toBe(low);
  const edited = change(low, { description: "a" }, { description: "b" }, 720_000);
  expect(edited).toMatchObject([{ field: "priority", at: at(720_000) }]);
  expect(change(edited, { description: "b" }, { description: "b" }, 800_000)).toBe(edited);
  expect(
    change(edited, { status: "todo" }, { status: "progress" }, 1_680_000).map((e) => e.at),
  ).toEqual([at(720_000), at(720_000)]);
});
test("unchanged values, reordered labels and renamed assignees are not edits", () => {
  const events: PropertyActivity[] = [];
  expect(
    change(
      events,
      { labels: ["a", "b"], assignee: { id: "x", name: "Old" } },
      { labels: ["b", "a"], assignee: { id: "x", name: "New" }, summary: "renamed" },
    ),
  ).toBe(events);
  expect(change(events, { priority: "Low" }, { priority: "Low" })).toBe(events);
});

test("each relation change is its own row, never joined to the property group, and removing a fresh one drops its row, as on RAJ-52", () => {
  let events = change([], { priority: null }, { priority: "Low" });
  events = recordRelation(events, { key: "RAJ-53", kind: "related" }, false, me, at(60_000), id);
  events = recordRelation(events, { key: "RAJ-54", kind: "blocked" }, false, me, at(120_000), id);
  // A later property edit still joins the priority group, not a relation row.
  events = change(events, { priority: "Low", labels: [] }, { labels: ["Bug"] }, 180_000);
  expect(activityRows(events).map((row) => [row.field, row.events.length, row.at])).toEqual([
    ["multi", 2, at()],
    ["relation", 1, at(60_000)],
    ["relation", 1, at(120_000)],
  ]);
  events = recordRelation(events, { key: "RAJ-53", kind: "related" }, true, me, at(240_000), id);
  expect(
    activityRows(events)
      .filter((row) => row.field === "relation")
      .map((row) => (row.events[0]!.after as { key: string }).key),
  ).toEqual(["RAJ-54"]);
  // Removing one added longer ago than the window is listed.
  events = recordRelation(
    events,
    { key: "RAJ-54", kind: "blocked" },
    true,
    me,
    at(120_000 + GROUP_MS),
    id,
  );
  expect(
    activityRows(events)
      .filter((row) => row.field === "relation")
      .map((row) => [row.events[0]!.before, row.events[0]!.after]),
  ).toEqual([
    [null, { key: "RAJ-54", kind: "blocked" }],
    [{ key: "RAJ-54", kind: "blocked" }, null],
  ]);
  // Two relations recorded in the same instant are still two rows.
  const same = recordRelation(
    recordRelation([], { key: "A", kind: "related" }, false, me, at(), id),
    { key: "B", kind: "related" },
    false,
    me,
    at(),
    id,
  );
  expect(activityRows(same).map((row) => row.events.length)).toEqual([1, 1]);
});

test("a write Jira rejected takes its Activity entries with it; earlier saved changes in the group stay", () => {
  // Defect 4/5: "set parent to SAM1-29" stayed after Jira's pid error rolled the parent back.
  const parent = change([], { parent: null }, { parent: "SAM1-29" });
  expect(rollbackActivity(parent, { parent: "SAM1-29" }, { parent: undefined }, me.id)).toEqual([]);
  // Low was saved, then High was rejected: the group goes back to "set priority to Low".
  const priority = change(
    change([], { priority: null }, { priority: "Low" }),
    { priority: "Low" },
    { priority: "High" },
    60_000,
  );
  expect(
    rollbackActivity(priority, { priority: "High" }, { priority: "Low" }, me.id),
  ).toMatchObject([{ field: "priority", before: null, after: "Low" }]);
  // A rejected link removes its relation row; another actor's events and unchanged fields are untouched.
  const other = { id: "other", name: "Other" },
    events = [
      ...recordRelation([], { key: "A-2", kind: "blocked" }, false, me, at(), id),
      ...recordActivity([], { status: "todo" }, { status: "done" }, other, at(), id),
    ];
  expect(
    rollbackActivity(
      events,
      { relations: [{ key: "A-2", kind: "blocked" }], status: "done" },
      { relations: [], status: "done" },
      me.id,
    ).map((e) => e.field),
  ).toEqual(["status"]);
  expect(rollbackActivity(events, { status: "done" }, { status: "done" }, me.id)).toBe(events);
});

test("activityEvents lists image threads at their first comment, property rows, and only attached links with a time", () => {
  const events = activityEvents({
    mediaEdits: {
      img: { comments: [{ id: "c1", text: "hi", author: "Me", at: at(5) }] },
      cropped: { crop: { x: 0, y: 0, width: 1, height: 1 } } as never,
    },
    activity: change([], { priority: null }, { priority: "Low" }),
    resources: [
      { id: "l1", kind: "link", url: "https://x", created: at(9) } as never,
      { id: "l2", kind: "link", url: "https://y" } as never,
      { id: "d1", kind: "document", created: at(1) } as never,
    ],
  });
  expect(events.map((e) => [e.kind, e.id, e.at])).toEqual([
    ["image-thread", "img", at(5)],
    ["property", expect.any(String), at()],
    ["link", "l1", at(9)],
  ]);
});
