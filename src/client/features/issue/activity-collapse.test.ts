import { expect, test } from "bun:test";
import { collapseLabel, partition, summaryItems, type RunPosition } from "./activity-collapse";
import type { ActivityField, PropertyActivity } from "./issue-activity";

const now = Date.parse("2026-11-12T12:00:00Z"),
  HOUR = 3_600_000;
/** `count` entries, an hour apart, ending `hoursAgo` hours before now. */
const run = (count: number, hoursAgo = 48) =>
  Array.from({ length: count }, (_, i) => new Date(now - (hoursAgo + count - 1 - i) * HOUR).toISOString());
const sizes = (entries: string[], position: RunPosition, nextDiscussion?: string) => {
  const { before, hidden, after } = partition(entries, { position, now, at: (e) => e, nextDiscussion });
  return [before.length, hidden.length, after.length];
};

test("BJ-13: a run folds like Linear's ActivityHistoryCollapse, by where it sits", () => {
  // Alone: from 9 entries, keeping 3 at each end.
  expect(sizes(run(8), "only")).toEqual([8, 0, 0]);
  expect(sizes(run(9), "only")).toEqual([3, 3, 3]);
  // Before the first comment: from 5, keeping the first 3 and nothing old at the end.
  expect(sizes(run(4), "first")).toEqual([4, 0, 0]);
  expect(sizes(run(6), "first")).toEqual([3, 3, 0]);
  // After the last comment: from 4, keeping the last 2.
  expect(sizes(run(4), "last")).toEqual([0, 2, 2]);
  // Between comments: any 2 old entries fold.
  expect(sizes(run(2), "middle")).toEqual([0, 2, 0]);
  expect(sizes(run(5), "first")).toEqual([3, 2, 0]);
  // Folding only one entry folds nothing: here the fifth is recent.
  expect(sizes([...run(4), new Date(now).toISOString()], "first")).toEqual([5, 0, 0]);
});

test("BJ-13: entries of the last 4 hours, and those just before a recent comment, stay unfolded", () => {
  // 6 to 1 hours ago: the last 4 are at most 4 hours old.
  expect(sizes(run(6, 1), "middle")).toEqual([0, 2, 4]);
  // A comment 1 day ago keeps the entries in the 5 minutes before it.
  const entries = [...run(3), new Date(now - 24 * HOUR - 60_000).toISOString()];
  expect(sizes(entries, "middle", new Date(now - 24 * HOUR).toISOString())).toEqual([0, 3, 1]);
  // One 5 days ago does not.
  const old = [...run(3, 200), new Date(now - 120 * HOUR - 60_000).toISOString()];
  expect(sizes(old, "middle", new Date(now - 120 * HOUR).toISOString())).toEqual([0, 4, 0]);
});

test("BJ-13: the folded row names what changed, most important first, as Linear words it", () => {
  const events = (fields: ActivityField[]) =>
    fields.map((field) => ({ field }) as PropertyActivity);
  expect(
    collapseLabel(5, [
      ...summaryItems(events(["relation", "priority", "status", "parent"])),
      { action: "added", value: "links", weight: 2 },
    ]),
  ).toBe("Show 5 events: changed priority, status, and related issues, added links…");
  expect(collapseLabel(2, summaryItems(events(["labels", "labels"])))).toBe("Show 2 events: changed labels…");
  // Only the 5 weightiest kinds are named.
  expect(
    collapseLabel(9, summaryItems(events(["cycle", "milestone", "title", "due", "estimate", "assignee", "status"]))),
  ).toBe("Show 9 events: changed assignee, status, title, due date, and estimate…");
  expect(collapseLabel(3, [])).toBe("Show 3 events");
});
