import { describe as group, expect, test } from "bun:test";
import {
  DEFAULT_VIEW,
  adfText,
  describe,
  kindOf,
  mapFeed,
  shortAgo,
  snoozeChoices,
  visibleItems,
  type InboxItem,
} from "./inbox-model";

// Trimmed from a live cloudsairaj `notificationFeed` node (2026-11-08).
const URL =
  "https://cloudsairaj.atlassian.net/browse/KAN-16?focusedCommentId=10039&sourceType=mention#comment-10039";
const live = {
  groupId: "ari:cloud:jira:a42d:issue/10060",
  groupSize: 1,
  readStates: ["unread"],
  additionalActors: [],
  headNotification: {
    notificationId: "YXJpOmNsb3Vk",
    timestamp: "2026-11-08T11:34:52.439Z",
    readState: "unread",
    category: "direct",
    content: {
      type: "mentioned",
      message: "Sairaj Chouhan mentioned you in a comment",
      url: URL,
      actor: { displayName: "Sairaj Chouhan", avatarURL: "https://secure.gravatar.com/avatar/x" },
      entity: { title: "Another YOooooo", url: URL, status: "In Progress" },
      path: [{ title: "KAN-16", url: URL }],
      bodyItems: [
        {
          type: "PRIMARY",
          document: {
            format: "ADF",
            data: '{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Hey "},{"type":"mention","attrs":{"id":"712020:a","text":"@cloud sairaj"}},{"type":"text","text":" can you take a look?"}]}]}',
          },
        },
      ],
    },
  },
};

group("mapFeed", () => {
  test("maps a live mention node", () => {
    expect(mapFeed([live])).toEqual([
      {
        id: "ari:cloud:jira:a42d:issue/10060",
        head: "YXJpOmNsb3Vk",
        key: "KAN-16",
        title: "Another YOooooo",
        status: "In Progress",
        url: "https://cloudsairaj.atlassian.net/browse/KAN-16",
        actor: { name: "Sairaj Chouhan", avatar: "https://secure.gravatar.com/avatar/x" },
        kind: "mentioned",
        message: "Sairaj Chouhan mentioned you in a comment",
        preview: "Hey @cloud sairaj can you take a look?",
        time: "2026-11-08T11:34:52.439Z",
        unread: true,
        category: "direct",
        count: 1,
      },
    ]);
  });
  test("degrades instead of throwing on partial or junk nodes", () => {
    expect(mapFeed(null)).toEqual([]);
    expect(mapFeed([null, {}, { groupId: "g" }])).toEqual([]);
    const [row] = mapFeed([
      {
        groupId: "g",
        readStates: ["read"],
        headNotification: {
          notificationId: "n",
          category: "watching",
          content: { message: "Ana updated a task", url: "https://x.atlassian.net/browse/AB-7" },
        },
      },
    ]);
    expect(row).toMatchObject({
      key: "AB-7",
      title: "Ana updated a task",
      unread: false,
      actor: null,
    });
    expect(row?.category).toBe("watching");
  });
  test("a group with any unread notification is unread", () => {
    const node = {
      ...live,
      readStates: ["read", "unread"],
      headNotification: { ...live.headNotification, readState: "read" },
    };
    expect(mapFeed([node])[0]?.unread).toBe(true);
  });
});

test("kindOf reads Jira's messages (live wording)", () => {
  expect(kindOf("updated", "Ana assigned a story to you")).toBe("assigned");
  expect(kindOf("updated", "Ana unassigned a story from you")).toBe("unassigned");
  expect(kindOf("mentioned", "Ana mentioned you in a comment")).toBe("mentioned");
  expect(kindOf("updated", "Ana commented on a story")).toBe("comment");
  expect(kindOf("updated", "Ana reacted to your comment")).toBe("reaction");
  expect(kindOf("updated", "Ana changed a subtask from To Do to In Progress")).toBe("status");
  expect(kindOf("created", "Ana created a task")).toBe("created");
  expect(kindOf("updated", "Ana updated a task")).toBe("updated");
});

const item = (patch: Partial<InboxItem>): InboxItem => ({
  id: "g",
  head: "h",
  key: "KAN-1",
  title: "T",
  status: "",
  url: "",
  actor: { name: "Ana" },
  kind: "updated",
  message: "Ana updated a task",
  preview: "",
  time: "2026-11-08T10:00:00Z",
  unread: true,
  category: "direct",
  count: 1,
  ...patch,
});

test("describe uses Linear's wording", () => {
  expect(describe(item({ kind: "assigned" }))).toBe("Ana assigned the issue to you");
  expect(describe(item({ kind: "mentioned", preview: "hi" }))).toBe("Ana mentioned you: hi");
  expect(describe(item({ kind: "comment", preview: "ok" }))).toBe("Ana commented: ok");
  expect(describe(item({ kind: "reaction" }))).toBe("Ana reacted to your comment");
  const status = (message: string) => describe(item({ kind: "status", message }));
  expect(status("Ana changed a task from To Do to Done")).toBe("Marked as completed by Ana");
  expect(status("Ana changed a task from To Do to Cancelled")).toBe("Marked as canceled by Ana");
  expect(status("Ana changed a task from To Do to In Review")).toBe("Status updated by Ana");
  expect(describe(item({ kind: "created", actor: null }))).toBe("Someone created a new issue");
  expect(describe(item({}))).toBe("Ana updated a task");
});

test("adfText flattens ADF and its JSON string", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "emoji", attrs: { shortName: ":+1:" } },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
    ],
  };
  expect(adfText(doc)).toBe("a:+1: b");
  expect(adfText(JSON.stringify(doc))).toBe("a:+1: b");
  expect(adfText("not json")).toBe("not json");
  expect(adfText(undefined)).toBe("");
});

test("shortAgo matches Linear's list times", () => {
  const now = Date.parse("2026-11-08T12:00:00Z"),
    ago = (m: number) => shortAgo(new Date(now - m * 60_000).toISOString(), now);
  expect([ago(0), ago(5), ago(180), ago(2 * 1440), ago(4 * 10080), ago(400 * 1440)]).toEqual([
    "now",
    "5m",
    "3h",
    "2d",
    "4w",
    "1y",
  ]);
  expect(shortAgo("", now)).toBe("now");
});

test("visibleItems applies local state, filters and ordering", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const a = item({
      id: "a",
      head: "ha",
      time: "2026-11-08T11:00:00Z",
      unread: false,
      category: "watching",
    }),
    b = item({ id: "b", head: "hb", time: "2026-11-08T10:00:00Z" }),
    c = item({ id: "c", head: "hc", time: "2026-11-08T09:00:00Z" }),
    d = item({ id: "d", head: "hd", time: "2026-11-08T08:00:00Z" });
  const local = { hc: { deleted: true }, hd: { snoozed: now + 1000 }, ha: { read: false } };
  const ids = (view = {}) =>
    visibleItems([d, c, b, a], local, { ...DEFAULT_VIEW, ...view }, now).map((r) => r.id);
  expect(ids()).toEqual(["a", "b"]);
  expect(visibleItems([a], local, DEFAULT_VIEW, now)[0]?.unread).toBe(true);
  expect(ids({ showSnoozed: true })).toEqual(["a", "b", "d"]);
  expect(ids({ category: "direct" })).toEqual(["b"]);
  expect(ids({ oldest: true })).toEqual(["b", "a"]);
  expect(
    visibleItems([d, c, b, a], {}, { ...DEFAULT_VIEW, unreadOnly: true }, now).map((r) => r.id),
  ).toEqual(["b", "c", "d"]);
  expect(
    visibleItems([d, a], {}, { ...DEFAULT_VIEW, unreadFirst: true }, now).map((r) => r.id),
  ).toEqual(["d", "a"]);
  // an expired snooze shows again
  expect(visibleItems([d], local, DEFAULT_VIEW, now + 2000).map((r) => r.id)).toEqual(["d"]);
});

test("snoozeChoices: tomorrow and next week at 8:00, a month from now", () => {
  const [tomorrow, week, month] = snoozeChoices(new Date(2026, 10, 8, 15, 30));
  expect(new Date(tomorrow!.until)).toEqual(new Date(2026, 10, 9, 8));
  expect(new Date(week!.until)).toEqual(new Date(2026, 10, 15, 8));
  expect(new Date(month!.until)).toEqual(new Date(2026, 11, 8, 15, 30));
});
