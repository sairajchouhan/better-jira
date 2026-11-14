import { expect, test } from "bun:test";
import type { InboxItem, InboxNote } from "./inbox-model";
import { DEFAULT_PUSH, PUSH_CATEGORIES, PUSH_CATEGORY, newPushes, noteIds, pushCategoryOn, pushContent, type PushSettings } from "./inbox-push";

const note = (id: string, over: Partial<InboxNote> = {}): InboxNote => ({
  id,
  actor: { name: "Sam" },
  kind: "comment",
  message: "Sam commented on a task",
  preview: "Ship it",
  time: "2026-11-10T00:00:00Z",
  status: "",
  link: "",
  commentId: "",
  unread: true,
  ...over,
});
const row = (head: InboxNote, over: Partial<InboxItem> = {}): InboxItem => ({
  ...head,
  id: `group-${head.id}`,
  head: head.id,
  key: "TEST-1",
  title: "Fixture",
  url: "",
  issueType: "Task",
  category: "direct",
  count: 1,
  others: [],
  ...over,
});
const on: PushSettings = { ...DEFAULT_PUSH, enabled: true };
const ctx = (over: Partial<Parameters<typeof newPushes>[1]> = {}) => ({
  settings: on,
  known: new Set<string>(),
  local: {},
  priorityInbox: false,
  me: "Me Myself",
  now: Date.parse("2026-11-14T00:00:00Z"),
  ...over,
});
const ids = (items: InboxItem[], c = ctx()) => newPushes(items, c).map((p) => p.note.id);

test("B10: a new unread notification pushes, with the issue as title and Linear's sentence as body", () => {
  const pushes = newPushes([row(note("n1"))], ctx());
  expect(pushes.map((p) => p.note.id)).toEqual(["n1"]);
  expect(pushContent(pushes[0]!)).toEqual({ title: "TEST-1 Fixture", body: "Sam commented: Ship it" });
});

test("B10: nothing pushes while desktop notifications are off, which is Linear's default", () => {
  expect(DEFAULT_PUSH.enabled).toBe(false);
  expect(ids([row(note("n1"))], ctx({ settings: DEFAULT_PUSH }))).toEqual([]);
});

test("B10: notifications this tab already knew, read ones, and ones read, deleted or snoozed here don't push", () => {
  expect(ids([row(note("n1"))], ctx({ known: new Set(["n1"]) }))).toEqual([]);
  expect(ids([row(note("n1", { unread: false }), { unread: false })])).toEqual([]);
  expect(ids([row(note("n1"))], ctx({ local: { n1: { read: true } } }))).toEqual([]);
  expect(ids([row(note("n1"))], ctx({ local: { n1: { deleted: true } } }))).toEqual([]);
  expect(ids([row(note("n1"))], ctx({ local: { n1: { snoozed: Date.parse("2026-11-15T00:00:00Z") } } }))).toEqual([]);
  // An expired snooze no longer holds it back.
  expect(ids([row(note("n1"))], ctx({ local: { n1: { snoozed: Date.parse("2026-11-13T00:00:00Z") } } }))).toEqual(["n1"]);
});

test("B10: your own actions never notify you", () => {
  expect(ids([row(note("n1", { actor: { name: "Me Myself" } }))])).toEqual([]);
});

test("B10: each category follows its setting; reactions are off by default on desktop, as Linear's", () => {
  expect(PUSH_CATEGORIES.map(([, label]) => label)).toEqual([
    "Assignments",
    "Status changes",
    "Comments and replies",
    "Mentions",
    "Reactions",
    "Subscriptions",
  ]);
  expect(pushCategoryOn(on, "reactions")).toBe(false);
  expect(pushCategoryOn(on, "mentions")).toBe(true);
  expect(ids([row(note("n1", { kind: "reaction" }))])).toEqual([]);
  const noComments = { ...on, categories: { commentsAndReplies: false } };
  expect(ids([row(note("n1"))], ctx({ settings: noComments }))).toEqual([]);
  expect(ids([row(note("n1", { kind: "mentioned" }))], ctx({ settings: noComments }))).toEqual(["n1"]);
  expect(PUSH_CATEGORY.assigned).toBe("assignments");
  expect(PUSH_CATEGORY.status).toBe("statusChanges");
  expect(PUSH_CATEGORY.updated).toBe("subscriptions");
});

test("B10: only priority notifications keeps Jira's Direct rows, and only while the priority inbox is on", () => {
  const settings = { ...on, onlyPriority: true };
  const watching = row(note("n1"), { category: "watching" });
  expect(ids([watching], ctx({ settings, priorityInbox: true }))).toEqual([]);
  expect(ids([row(note("n2"))], ctx({ settings, priorityInbox: true }))).toEqual(["n2"]);
  expect(ids([watching], ctx({ settings, priorityInbox: false }))).toEqual(["n1"]);
});

test("B10: a group pushes each new unread notification in it, and the baseline holds every loaded one", () => {
  const head = note("n3"),
    group = row(head, { count: 3, group: { notes: [head, note("n2"), note("n1", { unread: false })], more: false } });
  expect(ids([group], ctx({ known: new Set(["n2"]) }))).toEqual(["n3"]);
  expect(noteIds([group])).toEqual(["n3", "n3", "n2", "n1"]);
});
