import { expect, test } from "bun:test";
import type { InboxItem, InboxNote } from "./inbox-model";
import { COMMENT_SEEN_DELAY, clearedComments, createSeenTracker, visitClears } from "./inbox-visit";

const note = (id: string, commentId = "", unread = true): InboxNote => ({
  id,
  actor: { name: "Sam" },
  kind: commentId ? "comment" : "updated",
  message: "",
  preview: "",
  time: "2026-11-10T00:00:00Z",
  status: "",
  link: "",
  commentId,
  unread,
});
const row = (notes: InboxNote[], unread = notes.some((n) => n.unread)): InboxItem => ({
  ...notes[0]!,
  id: "group-1",
  head: notes[0]!.id,
  key: "TEST-1",
  title: "Fixture",
  url: "",
  issueType: "",
  unread,
  category: "watching",
  count: notes.length,
  others: [],
  ...(notes.length > 1 ? { group: { notes, more: false } } : {}),
});
const none = new Set<string>();

test("B6: opening the issue clears a row whose unread notifications are not about comments", () => {
  expect(visitClears(row([note("a"), note("b")]), undefined, none)).toBe(true);
});

test("B6: a comment notification waits until its comment has been seen", () => {
  const item = row([note("a"), note("b", "101")]);
  expect(visitClears(item, undefined, none)).toBe(false);
  expect(visitClears(item, undefined, new Set(["101"]))).toBe(true);
  // A read comment notification doesn't hold the row back.
  expect(visitClears(row([note("a"), note("b", "101", false)]), undefined, none)).toBe(true);
  // A single-notification row is its own note.
  expect(visitClears(row([note("a", "7")]), undefined, none)).toBe(false);
});

test("B6: a row already read, here or in Jira, needs nothing; one marked unread here counts its head", () => {
  const read = row([note("a", "", false)], false);
  expect(visitClears(read, undefined, none)).toBe(false);
  expect(visitClears(row([note("a")]), { read: true }, none)).toBe(false);
  expect(visitClears(read, { read: false }, none)).toBe(true);
  expect(visitClears(row([note("a", "9", false)], false), { read: false }, none)).toBe(false);
});

test("B6: seeing a reply clears the notification about the comment it answers, as Linear's Comment.markNotificationsAsRead", () => {
  expect(clearedComments({ id: "202", parentId: "101" })).toEqual(["202", "101"]);
  expect(clearedComments({ id: "101" })).toEqual(["101"]);
});

function tracker(focused = true) {
  const timers: { fn: () => void; ms: number }[] = [],
    seen: string[] = [],
    state = { focused };
  const t = createSeenTracker({
    later: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return () => void timers.splice(timers.indexOf(timer) >>> 0, 1);
    },
    focused: () => state.focused,
    seen: (c) => seen.push(c.id),
  });
  const flush = () => timers.splice(0).forEach((x) => x.fn());
  return { t, timers, seen, state, flush };
}

test("B6: a comment in view in a focused window is seen 1 s later, even once scrolled away", () => {
  const { t, timers, seen, flush } = tracker();
  t.show({ id: "101" });
  expect(timers.map((x) => x.ms)).toEqual([COMMENT_SEEN_DELAY]);
  expect(COMMENT_SEEN_DELAY).toBe(1000);
  t.hide("101");
  flush();
  expect(seen).toEqual(["101"]);
  t.hide("101");
  t.show({ id: "101" }); // once per comment
  expect(timers).toHaveLength(0);
});

test("B6: without focus nothing latches until the window takes focus; a comment that leaves the page is cancelled", () => {
  const { t, timers, seen, state, flush } = tracker(false);
  t.show({ id: "101" });
  expect(timers).toHaveLength(0);
  state.focused = true;
  t.focus();
  expect(timers).toHaveLength(1);
  t.remove("101");
  flush();
  expect(seen).toEqual([]);
  t.show({ id: "102" });
  t.dispose();
  flush();
  expect(seen).toEqual([]);
});
