import { describe as group, expect, test } from "bun:test";
import {
  DEFAULT_VIEW,
  facetsOf,
  focusGroups,
  statusType,
  adfText,
  describe,
  kindOf,
  mapFeed,
  missingIssueNote,
  shortAgo,
  snoozeChoices,
  snoozeTime,
  unreadCount,
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

test("a description mention reads as Linear's (Jira says 'on a task'); a missing issue in a mirrored project is called deleted", () => {
  expect(describe(item({ kind: "mentioned", message: "Ana mentioned you on a task" }))).toBe(
    "Ana mentioned you in an issue description",
  );
  expect(
    describe(item({ kind: "mentioned", message: "Ana mentioned you in a comment", preview: "hi" })),
  ).toBe("Ana mentioned you: hi");
  expect(missingIssueNote("KAN-9", new Set(["KAN"]))).toContain("may have been deleted");
  expect(missingIssueNote("OUT-9", new Set(["KAN"]))).toContain("outside your mirrored boards");
});

test("snooze times read like Linear's: weekday, day month, time", () => {
  expect(snoozeTime(new Date(2026, 10, 8, 19, 13).getTime())).toMatch(/^Sun, 8 Nov, 7:13\sPM$/);
});

test("unreadCount counts Jira's unread rows beyond the loaded pages, less local state", () => {
  const now = 1_000;
  const unread = Array.from({ length: 61 }, (_, i) => ({ head: `h${i}` }));
  const loaded = [
    item({ head: "h0", unread: true }),
    item({ head: "x", unread: false }),
    item({ head: "y", unread: false }),
  ];
  expect(unreadCount(unread, loaded, {}, now)).toBe(61);
  expect(
    unreadCount(
      unread,
      loaded,
      {
        h0: { read: true },
        h1: { deleted: true },
        h2: { snoozed: now + 1 },
        h3: { snoozed: now - 1 },
        x: { read: false },
      },
      now,
    ),
  ).toBe(61 - 3 + 1);
  // Without Jira's list (an older server), the loaded rows still count.
  expect(unreadCount(undefined, loaded, {}, now)).toBe(1);
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
  expect(ids({ priorityInbox: true, tab: "direct" })).toEqual(["b"]);
  expect(ids({ priorityInbox: true, tab: "watching" })).toEqual(["a"]);
  expect(ids({ ordering: "oldest" })).toEqual(["b", "a"]);
  expect(
    visibleItems([d, c, b, a], {}, { ...DEFAULT_VIEW, unreadOnly: true }, now).map((r) => r.id),
  ).toEqual(["b", "c", "d"]);
  expect(
    visibleItems([d, a], {}, { ...DEFAULT_VIEW, unreadFirst: true }, now).map((r) => r.id),
  ).toEqual(["d", "a"]);
  // an expired snooze shows again
  expect(visibleItems([d], local, DEFAULT_VIEW, now + 2000).map((r) => r.id)).toEqual(["d"]);
});

test("filters match any value per field and every field; priority ordering puts no priority last", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const a = item({ id: "a", head: "ha", kind: "mentioned", key: "KAN-1" }),
    b = item({ id: "b", head: "hb", kind: "comment", key: "SAM-2", time: "2026-11-08T11:00:00Z" }),
    c = item({ id: "c", head: "hc", kind: "assigned", key: "KAN-3", actor: { name: "Bo" } });
  const issues: Record<string, { priority?: string; project?: { name: string } }> = {
    "KAN-1": { priority: "Low", project: { name: "Kanban" } },
    "KAN-3": { priority: "Highest", project: { name: "Kanban" } },
  };
  const facets = (i: InboxItem) => facetsOf(i, issues[i.key]);
  const ids = (view = {}) =>
    visibleItems([a, b, c], {}, { ...DEFAULT_VIEW, ...view }, now, null, facets).map((r) => r.id);
  expect(ids({ filters: { type: ["Mentions", "Comments and replies"] } })).toEqual(["b", "a"]);
  expect(ids({ filters: { project: ["Kanban"], from: ["Bo"] } })).toEqual(["c"]);
  expect(ids({ filters: { project: ["SAM"] } })).toEqual(["b"]);
  expect(ids({ filters: { priority: ["No priority"] } })).toEqual(["b"]);
  expect(ids({ filters: { type: [] } })).toEqual(["b", "a", "c"]);
  expect(ids({ ordering: "priority" })).toEqual(["c", "a", "b"]);
});

test("statusType maps Jira statuses to Linear's status types", () => {
  expect(statusType({ name: "Done", category: "done" })).toBe("Completed");
  expect(statusType({ name: "Won't do", category: "done" })).toBe("Canceled");
  expect(statusType({ name: "Duplicate", category: "done" })).toBe("Duplicate");
  expect(statusType({ name: "In Review", category: "indeterminate" })).toBe("Started");
  expect(statusType({ name: "Backlog", category: "new" })).toBe("Backlog");
  expect(statusType({ name: "To Do", category: "new" })).toBe("Unstarted");
  expect(statusType({ name: "In Progress", category: "" })).toBe("Started");
  expect(statusType({ name: "", category: "" })).toBe("");
});

test("focusGroups follows Linear's Focus grouping", () => {
  const row = (id: string, kind: InboxItem["kind"], unread = true) =>
    item({ id, head: id, kind, unread });
  const labels = (rows: InboxItem[], facets?: (i: InboxItem) => ReturnType<typeof facetsOf>) =>
    focusGroups(rows, facets).map((g) => `${g.label}:${g.rows.map((r) => r.id).join("")}`);
  // One group alone is "Unread"; read rows go last.
  expect(labels([row("a", "updated"), row("b", "updated", false)])).toEqual(["Unread:a", "Read:b"]);
  // Mentions get their own group; small children stay in Other.
  expect(labels([row("m", "mentioned"), row("u", "updated"), row("x", "assigned")])).toEqual([
    "Mentions:m",
    "Other:ux",
  ]);
  // Comments split out from two; Other alone with one child keeps that child's name.
  expect(labels([row("m", "mentioned"), row("c", "comment"), row("d", "comment")])).toEqual([
    "Mentions:m",
    "Comments:cd",
  ]);
  // Two or more trailing one-row children fold back into Other; earlier ones show on their own.
  expect(
    labels([
      row("c", "comment"),
      row("d", "comment"),
      row("x", "assigned"),
      row("r", "reaction"),
      row("u", "updated"),
    ]),
  ).toEqual(["Comments:cd", "Other:xru"]);
  // Urgent: open issues at the highest priority.
  const urgent = (i: InboxItem) => facetsOf(i, { priority: i.id === "p" ? "Highest" : "Low" });
  expect(labels([row("p", "updated"), row("u", "updated")], urgent)).toEqual([
    "Urgent:p",
    "Other:u",
  ]);
  // No unread rows: one flat, unlabeled list.
  expect(labels([row("a", "updated", false)])).toEqual([":a"]);
});

test("snoozeChoices: Linear's presets, in time order, at 9:00", () => {
  const labels = (now: Date) =>
    snoozeChoices(now).map((c) => `${c.label} ${new Date(c.until).toString().slice(0, 21)}`);
  // Sunday 15:30: this evening is still ahead; next week is Monday.
  expect(labels(new Date(2026, 10, 8, 15, 30))).toEqual([
    "An hour from now Sun Nov 08 2026 16:30",
    "This evening Sun Nov 08 2026 18:00",
    "In 3 hours Sun Nov 08 2026 18:30",
    "Tomorrow Mon Nov 09 2026 09:00",
    "Next week Mon Nov 09 2026 09:00",
    "A month from now Tue Dec 08 2026 09:00",
  ]);
  // Monday 17:30: the evening is under an hour away, so it is not offered; next week is the Monday after.
  expect(labels(new Date(2026, 10, 9, 17, 30)).map((l) => l.split(" 2026")[0])).toEqual([
    "An hour from now Mon Nov 09",
    "In 3 hours Mon Nov 09",
    "Tomorrow Tue Nov 10",
    "Next week Mon Nov 16",
    "A month from now Wed Dec 09",
  ]);
});
