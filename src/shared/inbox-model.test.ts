import { describe as group, expect, test } from "bun:test";
import {
  DEFAULT_VIEW,
  facetsOf,
  feedCategory,
  filterOperator,
  withOperator,
  withoutFilter,
  findInRow,
  findWords,
  focusGroups,
  inboxOrder,
  statusType,
  adfText,
  commentAnchor,
  describe,
  GROUP_FIRST,
  groupPage,
  groupSummary,
  issueTypeOf,
  prioritize,
  statusChange,
  kindOf,
  mapFeed,
  missingIssueNote,
  rowLabel,
  shortAgo,
  unreadCount,
  visibleItems,
  type InboxItem,
} from "./inbox-model";
import { equalOperators } from "./view-model";

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
        link: URL,
        commentId: "10039",
        issueType: "",
        actor: { name: "Sairaj Chouhan", avatar: "https://secure.gravatar.com/avatar/x" },
        kind: "mentioned",
        message: "Sairaj Chouhan mentioned you in a comment",
        preview: "Hey @cloud sairaj can you take a look?",
        time: "2026-11-08T11:34:52.439Z",
        unread: true,
        category: "direct",
        count: 1,
        others: [],
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
  link: "",
  commentId: "",
  issueType: "",
  others: [],
  ...patch,
});

test("describe uses Linear's wording", () => {
  expect(describe(item({ kind: "assigned", message: "Ana assigned an issue to you" }))).toBe("Ana assigned the issue to you");
  expect(describe(item({ kind: "mentioned", message: "Ana mentioned you in a comment", preview: "hi" }))).toBe(
    "Ana mentioned you in a comment: hi",
  );
  expect(describe(item({ kind: "comment", preview: "ok" }))).toBe("Ana commented: ok");
  expect(describe(item({ kind: "comment", message: "Ana replied to a comment", preview: "ok" }))).toBe("Ana replied: ok");
  expect(describe(item({ kind: "reaction" }))).toBe("Ana reacted to your comment");
  expect(describe(item({ kind: "created", actor: null, message: "" }))).toBe("Someone created a new issue");
  expect(describe(item({}))).toBe("Ana updated a task");
});

test("prod parity #5/#6: a status change keeps both statuses, even a name holding ' to '", () => {
  const status = (message: string, to = "") => describe(item({ kind: "status", message, status: to }));
  expect(status("Ana changed a task from Ready to deploy to Done", "Done")).toBe(
    "Marked as completed by Ana: Ready to deploy → Done",
  );
  expect(status("Ana changed a task from To Do to Cancelled", "Cancelled")).toBe(
    "Marked as canceled by Ana: To Do → Cancelled",
  );
  expect(status("Ana changed a task from In Progress to Review", "Review")).toBe(
    "Status updated by Ana: In Progress → Review",
  );
  // The new status may hold " to " too: the status Jira sent splits the sentence.
  expect(statusChange({ message: "Ana changed a bug from Doing to Ready to deploy", status: "Ready to deploy" })).toEqual({
    from: "Doing",
    to: "Ready to deploy",
  });  // R3 G15: Jira's status field may differ from its sentence in case; the sentence's words stay.
  expect(statusChange({ message: "Ana changed a story from QA to Ready to deploy", status: "Ready to Deploy" })).toEqual({
    from: "QA",
    to: "Ready to deploy",
  });
  expect(status("Ana changed a story from QA to Ready to deploy", "READY TO DEPLOY")).toBe(
    "Status updated by Ana: QA → Ready to deploy",
  );
});

test("prod parity #7/#8/#16: Jira's issue type survives in the words and the row", () => {
  expect(issueTypeOf("Sahil Chalke assigned a task to you")).toBe("Task");
  expect(issueTypeOf("Hitesh Shetty created a story")).toBe("Story");
  expect(issueTypeOf("Epic Bot commented on an epic")).toBe("Epic");
  expect(issueTypeOf("Ana changed a work item from To Do to Done")).toBe("Work item");
  expect(issueTypeOf("Ana mentioned you in a comment")).toBe("");
  expect(describe(item({ kind: "assigned", message: "Ana assigned a bug to you" }))).toBe("Ana assigned the bug to you");
  expect(describe(item({ kind: "created", message: "Ana created a story" }))).toBe("Ana created a new story");
  expect(mapFeed([{ ...live, headNotification: { ...live.headNotification, content: { ...live.headNotification.content, message: "Ana updated a story" } } }])[0]?.issueType).toBe("Story");
});

test("prod parity #9/#13: a comment notification keeps Jira's link to the comment and its anchor on the issue page", () => {
  const [row] = mapFeed([live]);
  expect(row?.link).toContain("focusedCommentId=10039");
  expect(row?.url).toBe("https://cloudsairaj.atlassian.net/browse/KAN-16");
  expect(commentAnchor(row!)).toBe("comment-10039");
  expect(commentAnchor(item({}))).toBe("");
});

test("prod parity #11: the row's accessible name carries the type, status and group", () => {
  expect(rowLabel(item({ issueType: "Task", status: "Review", count: 3, others: [{ name: "Bo" }, { name: "Cy" }] }))).toBe(
    "Unread KAN-1 T · Task, Review Ana updated a task · +2 updates from Bo and others",
  );
});

test("a description mention reads as Linear's (Jira says 'on a task'); a missing issue in a mirrored project is called deleted", () => {
  expect(describe(item({ kind: "mentioned", message: "Ana mentioned you on a task" }))).toBe(
    "Ana mentioned you in the task description",
  );
  expect(
    describe(item({ kind: "mentioned", message: "Ana mentioned you in a comment", preview: "hi" })),
  ).toBe("Ana mentioned you in a comment: hi");
});

test("BJ-355: the note of a notification whose issue didn't open never says it opens in Jira", () => {
  expect(missingIssueNote("missing")).toBe("Jira has no such issue, or you can't see it. It may have been deleted.");
  expect(missingIssueNote("unreachable")).toContain("Couldn't reach Jira");
  expect(missingIssueNote("reading")).toBe("Opening this issue…");
  for (const outcome of ["reading", "missing", "unreachable"] as const) expect(missingIssueNote(outcome)).not.toContain("opens in Jira");
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

test("an undone ⌥U counts rows being marked unread that Jira's last list and the loaded pages lack (R3-inbox-D5)", () => {
  expect(unreadCount([], [], { far: { read: false }, gone: { read: false, deleted: true } })).toBe(1);
});

test("R3 G23: the feed and its group pages carry a comment's text, not its ADF, which no card reads", () => {
  const [row] = mapFeed([live]);
  expect(row?.preview).toBe("Hey @cloud sairaj can you take a look?");
  expect(row).not.toHaveProperty("doc");
  expect(groupPage([live.headNotification], {}, GROUP_FIRST).notes[0]).not.toHaveProperty("doc");
});

test("R3 G23: a row's accessible name cuts a long comment to 100 characters, as Linear cuts a comment in a line", () => {
  const long = "A made-up comment that goes on and on. ".repeat(30).trim();
  const label = rowLabel(item({ kind: "comment", message: "Ana commented on a task", preview: long }));
  expect(label).toContain(`Ana commented: ${long.slice(0, 99)}…`);
  expect(label.length).toBeLessThan(160);
  expect(rowLabel(item({ kind: "comment", message: "Ana commented on a task", preview: "Short" }))).toEndWith("Ana commented: Short");
});

test("a Jira system notification's row label leaves no gap for its missing key (R3-inbox-D7)", () => {
  const system = item({ key: "", title: "View work", kind: "updated", message: "You have 1 item due today" });
  expect(rowLabel(system)).not.toContain("  ");
  expect(rowLabel(system)).toStartWith("Unread View work");
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

test("prod parity #20: list times round to the nearest unit, as Jira's bell does", () => {
  const now = Date.parse("2026-11-08T12:00:00Z"),
    ago = (days: number) => shortAgo(new Date(now - days * 86_400_000).toISOString(), now);
  expect(ago(1.99)).toBe("2d"); // Jira: "2 days ago"
  expect(ago(10.7)).toBe("2w"); // Jira: "2 weeks ago"
  expect(ago(6.6)).toBe("1w");
  expect(ago(23.5 / 24)).toBe("1d");
  expect(shortAgo(new Date(now - 59.6 * 60_000).toISOString(), now)).toBe("1h");
});

group("prod parity #14/#15: groups", () => {
  const note = (id: string, message: string, hoursAgo: number, actor = message.split(" ")[0]!) => ({
    notificationId: id,
    timestamp: new Date(Date.parse("2026-11-08T12:00:00Z") - hoursAgo * 3_600_000).toISOString(),
    readState: "read",
    content: { type: "updated", message, url: "https://x.atlassian.net/browse/AB-7", actor: { displayName: actor } },
  });
  const node = (head: ReturnType<typeof note>, actors: string[]) => ({
    groupId: "ari:cloud:jira:x:issue/7",
    groupSize: actors.length + 1,
    readStates: ["read"],
    additionalActors: actors.map((displayName) => ({ displayName })),
    headNotification: { ...head, category: "direct", content: { ...head.content, entity: { title: "Seven", status: "In Progress" } } },
  });
  const now = Date.parse("2026-11-08T12:00:00Z");
  test("Jira's '+N updates from X and others'", () => {
    const [one] = mapFeed([node(note("h", "Kai updated a story", 1), ["Hana"])], {}, now);
    expect(groupSummary(one!)).toBe("+1 update from Hana");
    const [many] = mapFeed([node(note("h", "Kai updated a story", 1), ["Pia", "Ola", "Pia"])], {}, now);
    const [same] = mapFeed([node(note("h", "Kai updated a story", 1), ["Pia", "Pia"])], {}, now);
    expect(groupSummary(same!)).toBe("+2 updates from Pia");
    expect(many!.count).toBe(4);
    expect(groupSummary(many!)).toBe("+3 updates from Pia and others");
    expect(groupSummary(item({}))).toBe("");
  });
  test("R3 G15: a recent assignment under a newer update stays folded; only a mention leads (Linear's prioritize)", () => {
    const head = note("h", "Kai updated a story", 1),
      assign = note("a", "Hana assigned a story to you", 20);
    const [row] = mapFeed([node(head, ["Hana"])], { "ari:cloud:jira:x:issue/7": [head, assign] }, now);
    expect(row).toMatchObject({ kind: "updated", actor: { name: "Kai" }, head: "h", time: head.timestamp, count: 2 });
    const mention = note("m", "Hana mentioned you in a comment", 20);
    const [led] = mapFeed([node(head, ["Hana"])], { "ari:cloud:jira:x:issue/7": [head, mention] }, now);
    expect(led).toMatchObject({ kind: "mentioned", actor: { name: "Hana" }, head: "h", time: head.timestamp });
  });
  test("R3 G15: the summary names whom Jira names (its additionalActors), even the actor who leads the row", () => {
    // Jira: "+1 update from Kai" on a group whose head and other notification are both Kai's.
    const head = note("h", "Kai changed a task from In Progress to Review", 1),
      assign = note("a", "Kai assigned a task to you", 2);
    const [one] = mapFeed([node(head, ["Kai"])], { "ari:cloud:jira:x:issue/7": [head, assign] }, now);
    expect(groupSummary(one!)).toBe("+1 update from Kai");
    // Jira: "+3 updates from Pia and others", whoever is newest among the loaded notifications.
    const kids = [head, note("b", "Automation updated a task", 2), note("c", "Pia updated a task", 3), note("d", "Ola updated a task", 4)];
    const [many] = mapFeed([node(head, ["Pia", "Ola", "Automation"])], { "ari:cloud:jira:x:issue/7": kids }, now);
    expect(groupSummary(many!)).toBe("+3 updates from Pia and others");
    // Without Jira's actors, the loaded notifications name them.
    const [bare] = mapFeed([node(head, [])], { "ari:cloud:jira:x:issue/7": [head, assign] }, now);
    expect(groupSummary(bare!)).toBe("+1 update from Kai");
  });
  test("prioritize: unread first, newest first, a recent mention to the front, never a reaction first", () => {
    const n = (id: string, kind: InboxItem["kind"], hoursAgo: number, unread = false) => ({
      id,
      kind,
      unread,
      time: new Date(now - hoursAgo * 3_600_000).toISOString(),
    });
    expect(prioritize([n("u", "updated", 1), n("m", "mentioned", 5)], now).map((x) => x.id)).toEqual(["m", "u"]);
    expect(prioritize([n("r", "reaction", 1), n("c", "comment", 5)], now).map((x) => x.id)).toEqual(["c", "r"]);
    expect(prioritize([n("u", "updated", 1), n("c", "comment", 5, true)], now)[0]?.id).toBe("c");
  });
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
  // Linear's "is not" (equalValue `not`): a negated field keeps the rows with none of its values; another field still ANDs.
  expect(ids({ filters: { type: ["Mentions"] }, negated: ["type"] })).toEqual(["b", "c"]);
  expect(ids({ filters: { type: ["Mentions"], project: ["Kanban"] }, negated: ["type"] })).toEqual(["c"]);
  // A negated field without values filters nothing.
  expect(ids({ filters: { type: [] }, negated: ["type"] })).toEqual(["b", "a", "c"]);
});

test("a block's operator segment switches is / is not; × drops the field and its operator, so the next pick is 'is' again", () => {
  const view = { ...DEFAULT_VIEW, filters: { from: ["Bo"], type: ["Mentions"] } };
  expect(filterOperator(view, "from")).toBe("is");
  const not = { ...view, ...withOperator(view, "from", "isNot") };
  expect(not.negated).toEqual(["from"]);
  expect(filterOperator(not, "from")).toBe("isNot");
  expect(filterOperator(not, "type")).toBe("is");
  expect(withOperator(not, "from", "is").negated).toEqual([]);
  expect(withOperator(not, "from", "isNot").negated).toEqual(["from"]);
  const removed = { ...not, ...withoutFilter(not, "from") };
  expect(removed.filters).toEqual({ from: [], type: ["Mentions"] });
  expect(filterOperator(removed, "from")).toBe("is");
  expect(equalOperators(1)).toEqual([["is", "is"], ["isNot", "is not"]]);
  expect(equalOperators(2)[0]).toEqual(["is", "is any of"]);
});

test("R2-inbox-D5: a row whose issue isn't mirrored takes its project's name from the key prefix", () => {
  const projects = new Map([["KAN", "Team Astro"]]);
  const mirrored = item({ id: "a", key: "KAN-1" }),
    deleted = item({ id: "b", key: "KAN-69" }),
    outside = item({ id: "c", key: "OUT-9" });
  expect(facetsOf(mirrored, { project: { name: "Team Astro" } }, undefined, projects).project).toBe(
    "Team Astro",
  );
  expect(facetsOf(deleted, undefined, undefined, projects).project).toBe("Team Astro");
  const rows = [mirrored, deleted];
  const facets = (row: InboxItem) =>
    facetsOf(
      row,
      row === mirrored ? { project: { name: "Team Astro" } } : undefined,
      undefined,
      projects,
    );
  expect(new Set(rows.map((row) => facets(row).project)).size).toBe(1);
  expect(
    visibleItems(
      rows,
      {},
      { ...DEFAULT_VIEW, filters: { project: ["Team Astro"] } },
      Date.now(),
      null,
      facets,
    )
      .map((row) => row.id)
      .sort(),
  ).toEqual(["a", "b"]);
  expect(facetsOf(outside, undefined, undefined, projects).project).toBe("OUT");
  expect(facetsOf(item({ id: "d", key: "" }), undefined, undefined, projects).project).toBe(
    "No space",
  );
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

group("⌘F find (Linear's Notification.matchInlineFind)", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const ids = (rows: InboxItem[]) => rows.map((r) => r.id);
  const a = item({ id: "a", head: "ha", key: "KAN-1", title: "Login page broken", actor: { name: "Ana Ruiz" } }),
    b = item({
      id: "b",
      head: "hb",
      key: "SAM-22",
      title: "Billing export",
      kind: "comment",
      message: "Bo commented on a task",
      preview: "Café menu needs a review",
      actor: { name: "Bo" },
      time: "2026-11-08T09:00:00Z",
      category: "watching",
    }),
    c = item({ id: "c", head: "hc", key: "KAN-3", title: "Release notes", actor: null, message: "Your export is ready", unread: false, time: "2026-11-08T08:00:00Z" });
  const find = (term: string, view = {}) => ids(visibleItems([a, b, c], {}, { ...DEFAULT_VIEW, ...view, find: term }, now));

  test("a term is lowercased, folds accents as lodash deburr does, and splits on spaces", () => {
    expect(findWords("  Café  MENU ")).toEqual(["cafe", "menu"]);
    expect(findWords("Straße Øre")).toEqual(["strasse", "ore"]);
    expect(findWords("   ")).toEqual([]);
  });

  test("matches the issue key, title, actor, notification text and comment text, every word somewhere", () => {
    expect(find("kan-1")).toEqual(["a"]);
    expect(find("billing")).toEqual(["b"]);
    expect(find("ana")).toEqual(["a"]);
    expect(find("commented")).toEqual(["b"]);
    expect(find("cafe menu")).toEqual(["b"]);
    expect(find("menu login")).toEqual([]);
    // A notification with no actor is Jira's, as Linear's is "Linear".
    expect(find("jira")).toEqual(["c"]);
    expect(find("")).toEqual(["a", "b", "c"]);
  });

  test("find looks through both priority tabs, reads the whole feed, and keeps the unread filter", () => {
    expect(find("billing", { priorityInbox: true, tab: "direct" })).toEqual(["b"]);
    expect(feedCategory({ ...DEFAULT_VIEW, priorityInbox: true, tab: "direct", find: "x" })).toBe("all");
    expect(feedCategory({ ...DEFAULT_VIEW, priorityInbox: true, tab: "direct", find: " " })).toBe("direct");
    expect(find("export", { unreadOnly: true })).toEqual(["b"]);
    expect(find("export")).toEqual(["b", "c"]);
  });

  test("a row whose own notification misses but a loaded group notification matches leads with that one", () => {
    const mention = { id: "n2", actor: { name: "Kim" }, kind: "mentioned" as const, message: "Kim mentioned you in a comment", preview: "see the dashboard", time: "2026-11-08T07:00:00Z", status: "", link: "https://x/browse/KAN-1?focusedCommentId=7", commentId: "7", unread: true };
    const head = { id: "n1", actor: { name: "Ana Ruiz" }, kind: "updated" as const, message: "Ana updated a task", preview: "", time: "2026-11-08T10:00:00Z", status: "", link: "", commentId: "", unread: true };
    const row = item({ ...a, count: 2, group: { notes: [head, mention], more: false } });
    const shown = findInRow(row, findWords("dashboard"), now)!;
    expect(shown.id).toBe("a");
    expect(shown.head).toBe("ha");
    expect(describe(shown)).toBe("Kim mentioned you in a comment: see the dashboard");
    expect(shown.commentId).toBe("7");
    expect(shown.count).toBe(2);
    expect(findInRow(row, findWords("login"), now)).toBe(row);
    expect(findInRow(row, findWords("nothing here"), now)).toBeNull();
  });

  test("the base the filters count from leaves out the find, so the hidden count includes what it hides", () => {
    const facets = (i: InboxItem) => facetsOf(i);
    const order = inboxOrder([a, b, c], {}, { ...DEFAULT_VIEW, priorityInbox: true, tab: "direct", find: "billing" }, now, null, facets);
    expect(ids(order.rows)).toEqual(["b"]);
    expect(ids(order.base)).toEqual(["a", "b", "c"]);
    const tabbed = inboxOrder([a, b, c], {}, { ...DEFAULT_VIEW, priorityInbox: true, tab: "direct" }, now, null, facets);
    expect(ids(tabbed.base)).toEqual(["a", "c"]);
  });
});

test("BJ-264: a row back from snooze sorts by when it came back (Linear's movedToInboxAt = unsnoozedAt ?? createdAt)", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const old = item({ id: "old", head: "ho", time: "2026-11-01T09:00:00Z" }),
    newer = item({ id: "newer", head: "hn", time: "2026-11-08T10:00:00Z" });
  const local = { ho: { unsnoozed: Date.parse("2026-11-08T11:00:00Z") } };
  const ids = (ordering: "newest" | "oldest") =>
    visibleItems([newer, old], local, { ...DEFAULT_VIEW, ordering }, now).map((r) => r.id);
  expect(ids("newest")).toEqual(["old", "newer"]);
  expect(ids("oldest")).toEqual(["newer", "old"]);
  // Without the unsnooze it stays where its own time puts it.
  expect(visibleItems([newer, old], {}, DEFAULT_VIEW, now).map((r) => r.id)).toEqual(["newer", "old"]);
});
