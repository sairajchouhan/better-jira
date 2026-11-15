import { Database } from "bun:sqlite";
import { viewRepository } from "../src/server/view-repository";
const viewDb = new Database(":memory:");
const views = viewRepository(viewDb);
/** Disposable browser-test data. No Jira client, credentials, or cache are imported. */
import index from "../src/client/index.html";
import editorMediaFixture from "./editor-media-fixture.html";
import tailwind from "bun-plugin-tailwind";
import { attachmentGateway } from "../src/shared/attachment-media";
import { previewFrom } from "../src/server/link-preview";
import { GROUP_FIRST, GROUP_PAGE, groupPage, mapFeed } from "../src/shared/inbox-model";
import { markGroup } from "./fixture-inbox";
import { boardOps } from "./fixture-ops";
import { boardFromInput } from "../src/server/config";
import { avatarProxy, memoryAvatarCache } from "../src/shared/avatar-proxy";

/** A file in scripts/fixtures, from the repo root, so the built copy in dist/ finds it too. */
const fixtureFile = (name: string) => Bun.file(`scripts/fixtures/${name}`);
const rich = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "heading",
      attrs: { level: 2, localId: "heading-id" },
      content: [{ type: "text", text: "Rich fixture heading" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Formatted fixture",
          marks: [
            { type: "strong" },
            { type: "link", attrs: { href: "https://example.test/reference" } },
          ],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "A list item" }] }],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "const answer = 42;" }],
    },
    {
      type: "table",
      attrs: { layout: "wide" },
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Header" }] }],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Cell" }] }],
            },
          ],
        },
      ],
    },
    {
      type: "extension",
      attrs: {
        extensionType: "test",
        extensionKey: "preserve-me",
        parameters: { nested: [1, 2, 3] },
      },
    },
  ],
};
/** BJ-16: Jira smart links of every kind the survey of work Jira found, with made-up targets. */
const card = (url: string, type = "inlineCard", attrs: object = {}) => ({ type, attrs: { url, ...attrs } });
const smartLinkNodes = [
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Links: " },
      card("https://example.atlassian.net/browse/TEST-3"),
      { type: "text", text: " " },
      card("https://example.atlassian.net/browse/OPS-7?focusedCommentId=10"),
      { type: "text", text: " " },
      card("https://partner.atlassian.net/browse/PX-3"),
      { type: "text", text: " " },
      card("https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Release+checklist"),
      { type: "text", text: " " },
      card("https://github.com/acme/widgets/pull/42"),
      { type: "text", text: " " },
      card("https://docs.google.com/spreadsheets/d/abc123/edit#gid=0"),
      { type: "text", text: " " },
      card("https://acme.slack.com/archives/C0123/p1700000000000100"),
      { type: "text", text: " " },
      card("https://www.figma.com/design/AbC123/Checkout-flow?node-id=1-2"),
      { type: "text", text: " " },
      card("https://www.loom.com/share/0123abcd"),
      { type: "text", text: " " },
      card("https://docs.example.com/guides/getting-started"),
    ],
  },
  card("https://github.com/acme/widgets/issues/7", "blockCard"),
  card("https://example.com/handbook", "embedCard", { layout: "center" }),
];
const smartLinkDetails: Record<string, unknown> = {
  "https://example.atlassian.net/browse/OPS-7?focusedCommentId=10": {
    title: "Rotate the staging keys",
    status: { name: "In Review", category: "indeterminate" },
  },
  "https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Release+checklist": { title: "Release checklist (v2)" },
  // ⌘K reads a pasted link's issue by its /browse/ page.
  "https://example.atlassian.net/browse/OPS-7": {
    title: "Rotate the staging keys",
    status: { name: "In Review", category: "indeterminate" },
  },
};
const board = {
  id: 1,
  name: "Browser audit",
  columns: [
    { name: "Backlog", statuses: [{ id: "backlog", name: "Backlog", category: "new" }] },
    { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
    { name: "Doing", statuses: [{ id: "doing", name: "Doing", category: "indeterminate" }] },
    { name: "Review", statuses: [{ id: "review", name: "Review", category: "indeterminate" }] },
    { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
  ],
};
const user = { id: "audit-me", name: "Audit user" };
// Absolute avatar URLs, as Jira sends them: Alex's loads through the app's avatar proxy, Priya's is broken (initials fallback).
const origin = `http://127.0.0.1:${Number(process.env.FIXTURE_PORT ?? 3001)}`;
const alex = { id: "alex", name: "Alex", avatar: `${origin}/__avatar/alex.png` };
const people = [
  user,
  alex,
  { id: "priya", name: "Priya Raman", avatar: `${origin}/__avatar/missing.png` },
];
const avatar = avatarProxy({ site: origin, cache: memoryAvatarCache() });
const priorities = ["Normal", "Low", "High", "Urgent", "Normal", "Low"];
// FIXTURE_ISSUES pads the board for speed measurements; tests use the default six.
const issues = Array.from({ length: Number(process.env.FIXTURE_ISSUES ?? 6) }, (_, i) => ({
  key: `TEST-${i + 1}`,
  boards: [1],
  summary: i === 0 ? "Rich browser fixture" : `Browser fixture ${i + 1}`,
  status: i === 2 ? "doing" : "todo",
  rank: `0|i0000${i}:`,
  type: "Task",
  priority: priorities[i],
  assignee: i === 1 ? alex : null,
  labels: [i === 0 ? "ui" : "test"],
  comments: 0,
  updated: "2026-11-06T10:00:00Z",
  created: "2026-11-06T10:00:00Z",
  resolved: null,
  project: { key: "TEST", name: "Audit" },
}));
/** A Jira reply thread as the mirror serves it: Jira's numeric parentId, as a string. */
const paragraph = (...content: unknown[]) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content }],
});
const thread = [
  {
    id: "10100",
    author: { accountId: "alex", displayName: "Alex" },
    created: "2026-11-06T10:00:00Z",
    body: paragraph({ type: "text", text: "Thread root from Jira" }),
  },
  {
    id: "10101",
    parentId: "10100",
    author: { accountId: "jordan", displayName: "Jordan" },
    created: "2026-11-06T11:00:00Z",
    body: paragraph(
      { type: "mention", attrs: { id: "alex", text: "@Alex" } },
      { type: "text", text: " Reply made in Jira" },
    ),
  },
];
/** `syncErrors`: the mirror's reasons it can't read Jira (the footer's warning); `syncingReads`: how many /api/boards reads
 *  answer no boards while a first sync runs; `streaming`: how many property polls say the board, shown after its first page,
 *  is still on its first sync (BJ-338). */
let syncErrors: string[] = [],
  syncingReads = 0,
  streaming = 0;
let clientFailures = 0,
  detailFailures = 0,
  includeMedia = false,
  mediaInComment = false,
  threadedComments = false,
  distinctCreator = false,
  mediaFailure = 0,
  contentFailure = 0,
  unmappedMedia = false,
  mediaDelay = 0,
  mediaVariant = "",
  writable = false,
  subtask = false,
  /** Linear's Project is a Jira epic: TEST-7 and TEST-8 (done) are Epics, and TEST-2 and TEST-3 sit in TEST-7. */
  epics = false,
  /** Speed checks: this many extra issues on each of two boards, like a real team board. */
  bulk = 0,
  /** Spreads the bulk issues over this many made-up people and four times as many labels (speed measurements). */
  bulkVariety = 0,
  /** Board 2 was added from the app. */
  added = false,
  /** Blocker 5: board 2 ("Squad board") is configured and holds TEST-2, TEST-3 (also on board 1) and SQUAD-1 (only on it). */
  sharedBoards = false,
  /** BJ-15: TEST-1's Jira links reach issues outside the board and use link types Linear has no kind for. */
  crossLinks = false,
  /** BJ-171: opt into successful, durable Jira creates. */
  createSuccess = false,
  /** Jira changelogs per issue key, in the server's slim shape (src/shared/jira-history.ts), and how long they take. */
  history: Record<string, unknown[]> = {},
  historyDelay = 0,
  /** BJ-16: TEST-2's description and a comment carry a smart link of every kind work Jira has. */
  smartLinks = false,
  /** The site's priority, label and user catalog (/api/options), beyond the values the issues hold. */
  catalog: { priorities: string[]; labels: string[]; users: string[] } = { priorities: [], labels: [], users: [] };
/** TEST-1's links as the mirror projects them: made-up keys and text in the shape work Jira sends. */
const crossRelations = [
  {
    key: "OTHER-41",
    kind: "related",
    issue: { summary: "Partner team task outside the board", status: { name: "In Review", category: "indeterminate" } },
  },
  {
    key: "OTHER-42",
    kind: "inward:Problem/Incident",
    label: "is caused by",
    issue: { summary: "Made-up incident in another project", status: { name: "Done", category: "done" } },
  },
  { key: "TEST-2", kind: "outward:Cloners", label: "clones" },
];
const requests: { method: string; path: string; status: number }[] = [];
/** Writable mode: ops the app sent, and the types they changed (reset with the fixture). */
const writes: { key: string; ops: any[] }[] = [],
  types = new Map<string, string>(),
  /** Parents the app set, null for one it removed, as Jira's edit applies them. */
  parents = new Map<string, string | null>(),
  createdIssues = new Map<string, any>(),
  descriptions = new Map<string, any>(),
  /** Links the app removed, from either end (see `pair`). */
  unlinked = new Set<string>(),
  /** Statuses and ranks the app's status and rank ops set, so a drag's write reads back as Jira's would. */
  moved = new Map<string, string>(),
  ranked = new Map<string, string>(),
  /** `jiraEdits`: field edits Jira kept on existing issues, in the mirror's shape, as live Jira answers with them. */
  edited = new Map<string, Record<string, unknown>>();
/** `jiraEdits` opts into Jira keeping field edits; `refuse` makes Jira refuse a write: every op of that kind ("fields",
 *  "comment", "create"...), or a fields op naming that field ("summary", "parent"), answered with `refuseText`. */
let jiraEdits = false,
  refuse: string[] = [],
  refuseText = "Jira refused the change.";
/** `jiraComments` opts into Jira keeping comments posted, edited and deleted from the app, by issue, with Jira's ids. */
let jiraComments = false;
const posted = new Map<string, any[]>();
let commentId = 9000;
/** A comment op as Jira would apply it; a new comment's id, for `created[ref]`. */
function postComment(key: string, op: any): string | undefined {
  const list = posted.get(key) ?? [];
  posted.set(key, list);
  if (op.op === "comment") {
    const id = String(commentId++);
    list.push({
      id,
      author: { accountId: user.id, displayName: user.name },
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      body: op.body,
      ...(op.parentId && /^\d+$/.test(op.parentId) ? { parentId: Number(op.parentId) } : {}),
    });
    return id;
  }
  const at = list.findIndex((c) => c.id === op.id);
  if (op.op === "comment.edit" && at >= 0) list[at] = { ...list[at], body: op.body, updated: new Date().toISOString() };
  if (op.op === "comment.delete" && at >= 0) list.splice(at, 1);
}
/** A fields op as the mirror would read it back from Jira. */
function mirrored(key: string, fields: Record<string, any>) {
  const before = listed().find((i) => i.key === key) as any,
    out: Record<string, unknown> = {};
  if (fields.summary !== undefined) out.summary = fields.summary;
  if (fields.priority !== undefined) out.priority = fields.priority;
  if (fields.due !== undefined) out.due = fields.due;
  if (fields.assignee !== undefined)
    out.assignee = fields.assignee ? (people.find((p) => p.id === fields.assignee) ?? null) : null;
  if (fields.labels !== undefined) out.labels = fields.labels;
  if (fields.labelEdits)
    out.labels = [
      ...((before?.labels ?? []) as string[]).filter((l) => !fields.labelEdits.remove.includes(l)),
      ...fields.labelEdits.add,
    ];
  return out;
}
/** Jira's development panel pull requests as the server projects them (src/shared/pull-requests.ts), made up. */
const fixturePullRequests: Record<string, unknown[]> = {
  "TEST-1": [
    { url: "https://github.com/example/app/pull/12", title: "Fix the fixture sync", number: "#12", status: "open", repo: "example/app", author: "Alex", updated: "2026-11-10T10:00:00Z" },
    { url: "https://github.com/example/app/pull/9", title: "Add the fixture board", number: "#9", status: "merged", repo: "example/app", author: "Sam", updated: "2026-11-01T10:00:00Z" },
  ],
  "TEST-2": [
    { url: "https://github.com/example/app/pull/7", title: "Tidy fixture labels", number: "#7", status: "open", repo: "example/app", author: "Alex", branch: "alex/tidy-labels", target: "main", tool: "GitHub", updated: "2026-11-02T10:00:00Z" },
  ],
};
const pair = (a: string, b: string) => [a, b].sort().join(" ");
// Jira's createmeta types for TEST, with their hierarchy levels.
const issueTypes = [
  { name: "Epic", hierarchyLevel: 1 },
  { name: "Subtask", hierarchyLevel: -1 },
  { name: "Task", hierarchyLevel: 0 },
  { name: "Story", hierarchyLevel: 0 },
];
const statuses = ["backlog", "todo", "doing", "review", "done"];
/** Made-up epics in the shape work Jira sends: hierarchy level 1, in the board's Jira project. */
const epicIssues = [
  { key: "TEST-7", summary: "Fixture epic", status: "todo", priority: "High", labels: ["roadmap"] },
  { key: "TEST-8", summary: "Shipped epic", status: "done", priority: "Low", labels: [] },
].map((epic, i) => ({ ...issues[1]!, ...epic, type: "Epic", level: 1, assignee: null, rank: `0|i0100${i}:` }));
const bulkIssues = () =>
  [1, 2].flatMap((boardId) =>
    Array.from({ length: bulk }, (_, i) => ({
      ...issues[1]!,
      key: `${boardId === 1 ? "BULK" : "TWO"}-${i + 1}`,
      boards: [boardId],
      summary: `Bulk fixture ${i + 1} with a longer title that wraps onto a second line`,
      status: statuses[i % 5]!,
      rank: `0|i1${String(i).padStart(4, "0")}:`,
      priority: priorities[i % 6],
      labels: ["test", ...(i % 3 ? [] : ["perf"])],
      comments: i % 4,
      assignee: people[i % 3]!,
      due: i % 7 ? null : "2026-11-20",
      resolved: i % 5 === 4 ? "2026-11-07T10:00:00Z" : null,
      // `bulkVariety` spreads the bulk issues over that many made-up people and labels, with watchers, as a large work board is.
      ...(bulkVariety ? varied(i) : {}),
    })),
  );
const variedPerson = (n: number) => ({ id: `person-${n}`, name: `Person ${String(n).padStart(3, "0")}`, avatar: null });
const varied = (i: number) => ({
  assignee: i % 9 ? variedPerson(i % bulkVariety) : null,
  creator: variedPerson((i * 7) % bulkVariety),
  labels: [`label-${i % (bulkVariety * 4)}`, `label-${(i * 13) % (bulkVariety * 4)}`],
  watchers: [0, 1, 2].map((k) => variedPerson((i + k * 11) % bulkVariety)),
  watchersComplete: true,
});
const listed = () =>
  [
    ...issues,
    ...createdIssues.values(),
    ...bulkIssues(),
    ...(added ? [{ ...issues[1]!, key: "ADD-1", boards: [2], summary: "Added board issue" }] : []),
    ...(sharedBoards ? [{ ...issues[3]!, key: "SQUAD-1", boards: [2], summary: "Squad only issue" }] : []),
    ...(epics ? epicIssues : []),
  ].map((issue: any) => ({
    ...issue,
    ...(distinctCreator && issue.key === "TEST-6" ? { creator: alex } : {}),
    ...(subtask && issue.key === "TEST-6" ? { type: "Subtask", parent: "TEST-5" } : {}),
    ...(sharedBoards && (issue.key === "TEST-2" || issue.key === "TEST-3") ? { boards: [1, 2] } : {}),
    ...(crossLinks && issue.key === "TEST-1"
      ? { relations: crossRelations.filter((r) => !unlinked.has(pair("TEST-1", r.key))) }
      : {}),
    ...(crossLinks && issue.key === "TEST-2" && !unlinked.has(pair("TEST-1", "TEST-2"))
      ? { relations: [{ key: "TEST-1", kind: "inward:Cloners", label: "is cloned by" }] }
      : {}),
    ...(types.has(issue.key) ? { type: types.get(issue.key) } : {}),
    ...(moved.has(issue.key) ? { status: moved.get(issue.key) } : {}),
    ...(ranked.has(issue.key) ? { rank: ranked.get(issue.key) } : {}),
    ...(epics && (issue.key === "TEST-2" || issue.key === "TEST-3") ? { parent: "TEST-7", parentLevel: 1 } : {}),
    ...(parents.has(issue.key)
      ? { parent: parents.get(issue.key) ?? undefined, parentLevel: parents.get(issue.key) ? 1 : undefined }
      : {}),
    ...edited.get(issue.key),
    comments: threadedComments ? thread.length : mediaInComment || (smartLinks && issue.key === "TEST-2") ? 1 : 0, // the mirror list counts the same Jira comments the detail returns
  }));
/** Stands in for the server's applyOps: type changes follow live Jira, which refuses Subtask ↔ standard types. */
function applyOps(key: string, ops: any[]) {
  writes.push({ key, ops });
  const refused = ops.find(
    (op) => refuse.includes(op.op) || (op.op === "fields" && Object.keys(op.fields).some((f) => refuse.includes(f))),
  );
  if (refused)
    return Response.json(
      { key, created: {}, others: [], error: refuseText, issue: listed().find((i) => i.key === key) ?? null, full: full(key) },
      { status: 422 },
    );
  const create = ops.find((op) => op.op === "create");
  const created: Record<string, string> = {};
  if (create) {
    if (!createSuccess) return Response.json({ key, created, others: [], error: "Jira refused the new issue." }, { status: 422 });
    const next = `TEST-${90 + createdIssues.size}`;
    created[key] = next;
    key = next;
    const { description, ...fields } = create.fields;
    createdIssues.set(key, { ...issues[1]!, ...fields, key });
    if (description) descriptions.set(key, description);
  }
  for (const op of ops) {
    if (jiraComments && op.op.startsWith("comment")) {
      const id = postComment(key, op);
      if (id) created[op.ref] = id;
    }
    if (jiraEdits && op.op === "fields" && !createdIssues.has(key))
      edited.set(key, { ...edited.get(key), ...mirrored(key, op.fields) });
    if (jiraEdits && op.op === "status") edited.set(key, { ...edited.get(key), status: op.status });
    if (op.op === "fields" && createdIssues.has(key))
      createdIssues.set(key, { ...createdIssues.get(key), ...op.fields });
    if (op.op === "fields" && op.fields.description) descriptions.set(key, op.fields.description);
  }
  const issue = listed().find((i) => i.key === key)!,
    type = ops.find((op) => op.op === "fields" && op.fields.type)?.fields.type;
  if (type && (issue.type === "Subtask") !== (type === "Subtask"))
    return Response.json(
      {
        error: `Jira won't change ${key} to ${type}: The issue type selected is invalid. Use Move in Jira for this change.`,
        key,
        created: {},
        others: [],
        issue,
      },
      { status: 422 },
    );
  if (type) types.set(key, type);
  for (const op of ops)
    if (op.op === "fields" && "parent" in op.fields && !createdIssues.has(key)) parents.set(key, op.fields.parent);
  for (const op of ops)
    if (op.op === "link" && op.remove) unlinked.add(pair(key, op.target));
  const board = boardOps(key, ops, new Map(listed().flatMap((i: any) => (i.rank ? [[i.key, i.rank] as const] : []))));
  if (board.status !== undefined) moved.set(key, board.status);
  if (board.rank !== undefined) ranked.set(key, board.rank);
  return Response.json({
    key,
    created,
    others: [],
    full: full(key),
    issue: listed().find((i) => i.key === key),
  });
}
// Jira's bell feed in the gateway's own shape (from a live cloudsairaj dump), so the fixture runs the real mapping.
const notification = (
  n: number,
  key: string,
  title: string,
  type: string,
  message: string,
  category: "direct" | "watching",
  read: boolean,
  minutesAgo: number,
  /** The comment's text, or its ADF blocks for a rich one. */
  comment?: string | object[],
) => ({
  groupId: `ari:cloud:jira:fixture:issue/${n}`,
  groupSize: 1,
  readStates: [read ? "read" : "unread"],
  headNotification: {
    notificationId: `fixture-${n}-${minutesAgo}`,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    readState: read ? "read" : "unread",
    category,
    content: {
      type,
      message,
      url: `https://example.atlassian.net/browse/${key}`,
      actor: { displayName: message.split(" ")[0], avatarURL: null },
      entity: {
        title,
        url: `https://example.atlassian.net/browse/${key}?focusedCommentId=1`,
        status: "",
      },
      path: [{ title: key, url: `https://example.atlassian.net/browse/${key}` }],
      bodyItems: comment
        ? [
            {
              document: {
                format: "ADF",
                data: JSON.stringify({
                  type: "doc",
                  version: 1,
                  content:
                    typeof comment === "string" ? [{ type: "paragraph", content: [{ type: "text", text: comment }] }] : comment,
                }),
              },
            },
          ]
        : [],
    },
  },
});
/** A comment notification: Jira's link (content and entity) points at the comment. */
const onComment = (node: ReturnType<typeof notification>, id: string) => {
  const link = `${node.headNotification.content.url}?focusedCommentId=${id}#comment-${id}`;
  return {
    ...node,
    headNotification: {
      ...node.headNotification,
      content: { ...node.headNotification.content, url: link, entity: { ...node.headNotification.content.entity, url: link } },
    },
  };
};
/** A Jira group: `older` are the group's earlier notifications (newest first), which `notificationGroup` lists after the head. */
const grouped = (head: ReturnType<typeof notification>, ...older: ReturnType<typeof notification>[]) => ({
  ...head,
  groupSize: older.length + 1,
  additionalActors: older.map((o) => o.headNotification.content.actor),
  children: [head, ...older].map((n) => n.headNotification) as unknown[],
});
/** `extra` appends that many older notifications on issues outside the mirror, so the list pages; read unless `extraUnread`. */
/** A long rich comment, made up: paragraphs with marks and a list, many lines when unclamped (R3 prod parity #29). */
const longRichComment = [
  ...Array.from({ length: 4 }, (_, i) => ({
    type: "paragraph",
    content: [
      { type: "text", text: `Made-up finding ${i + 1}: `, marks: [{ type: "strong" }] },
      { type: "text", text: "the widget renders twice when the panel opens, and the second copy keeps the old value. ".repeat(3) },
    ],
  })),
  {
    type: "bulletList",
    content: ["Open the panel", "Change the value", "Close and reopen"].map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  },
];
const freshInbox = (extra = 0, extraUnread = false, richOutside = false) => ({
  unseen: 4,
  nodes: [
    // Jira's newest is an update and leads; the assignment under it stays folded (Linear's prioritize promotes mentions).
    grouped(
      notification(2, "TEST-2", "Browser fixture 2", "updated", "Sam updated a task", "direct", false, 5),
      notification(2, "TEST-2", "Browser fixture 2", "updated", "Alex assigned a task to you", "direct", false, 10),
    ),
    notification(
      1,
      "TEST-1",
      "Rich browser fixture",
      "mentioned",
      "Alex mentioned you in a comment",
      "direct",
      false,
      30,
      "Can you check this?",
    ),
    notification(
      3,
      "TEST-3",
      "Browser fixture 3",
      "updated",
      "Sam changed a task from Doing to Done",
      "watching",
      false,
      120,
    ),
    // Jira links a comment notification to its comment (`focusedCommentId`, `#comment-`): the reply in the threaded fixture.
    onComment(
      notification(
        4,
        "TEST-4",
        "Browser fixture 4",
        "updated",
        "Sam commented on a task",
        "watching",
        true,
        60 * 26,
        "Looks good to me",
      ),
      "10101",
    ),
    notification(
      5,
      "TEST-5",
      "Browser fixture 5",
      "updated",
      "Alex reacted to your comment",
      "direct",
      true,
      60 * 24 * 3,
    ),
    notification(
      6,
      "TEST-6",
      "Browser fixture 6",
      "created",
      "Sam created a task",
      "watching",
      false,
      60 * 24 * 9,
    ),
    grouped(
      richOutside
        ? notification(9, "OUT-9", "Outside the mirror", "updated", "Sam commented on a task", "watching", false, 60 * 24 * 400, longRichComment)
        : notification(9, "OUT-9", "Outside the mirror", "updated", "Sam updated a task", "watching", false, 60 * 24 * 400),
      notification(9, "OUT-9", "Outside the mirror", "updated", "Kim commented on a task", "watching", false, 60 * 24 * 401, "Earlier comment"),
      notification(9, "OUT-9", "Outside the mirror", "updated", "Lee changed a task from To Do to Doing", "watching", false, 60 * 24 * 402),
    ),
    ...Array.from({ length: extra }, (_, i) =>
      notification(
        100 + i,
        `OLD-${i + 1}`,
        `Older notification ${i + 1}`,
        "updated",
        "Sam updated a task",
        "watching",
        !extraUnread,
        60 * 24 * 500 + i,
      ),
    ),
  ],
});
/** Rows per page; the cursor is the next row's index, like the gateway's opaque one. */
const INBOX_PAGE = 20;
let inbox = freshInbox(),
  /** Writes (read, unread, read-all) answer 502, as when Jira refuses. */
  inboxFail = false,
  /** Milliseconds each feed read waits, like Jira's slow gateway. */
  inboxDelay = 0,
  /** Milliseconds each read/unread write waits before Jira applies it, in order of arrival; overlapping writes then land out of order. */
  inboxWriteDelays: number[] = [];
const unreadGroups = () =>
  inbox.nodes
    .filter((n) => n.readStates.includes("unread"))
    .map((n) => ({ id: n.groupId, head: n.headNotification.notificationId }));
/** A group's page from `start` (the cursor is the next offset): `GROUP_FIRST` first, then `GROUP_PAGE` at a time, as the server. */
function fixtureGroupPage(raw: unknown[], start: number) {
  const size = start ? GROUP_PAGE : GROUP_FIRST,
    end = start + size;
  return groupPage(raw.slice(start, end), { hasNextPage: end < raw.length, endCursor: String(end) }, size);
}
async function inboxRoute(req: Request, url: URL) {
  let status = 200,
    body: unknown = { ok: true };
  if (req.method === "GET") {
    await Bun.sleep(inboxDelay);
    const category = url.searchParams.get("category"),
      start = Number(url.searchParams.get("after") || 0),
      nodes = inbox.nodes.filter((n) => !category || n.headNotification.category === category);
    const children = (n: (typeof nodes)[number]) => (n as { children?: unknown[] }).children ?? [];
    body = {
      unseen: inbox.unseen,
      // Like the server, each group's first page comes with its row, so expanding the group needs no request.
      items: mapFeed(
        nodes.slice(start, start + INBOX_PAGE),
        Object.fromEntries(nodes.map((n) => [n.groupId, children(n)])),
      ).map((item) => {
        const node = nodes.find((n) => n.groupId === item.id)!;
        return children(node).length
          ? { ...item, group: fixtureGroupPage(children(node), 0) }
          : item;
      }),
      more: start + INBOX_PAGE < nodes.length,
      cursor: String(start + INBOX_PAGE),
      ...(start || category ? {} : { unread: unreadGroups() }),
      writable: true,
    };
  } else {
    const { action, groups = [] } = await req.json();
    if (action === "read" || action === "unread") await Bun.sleep(inboxWriteDelays.shift() ?? 0);
    if (inboxFail && action !== "seen") {
      status = 502;
      body = { error: "Jira did not update the notification." };
    } else if (action === "read" || action === "unread")
      inbox.nodes
        .filter((n) => groups.includes(n.groupId))
        .forEach((n) => markGroup(n, action === "read"));
    else if (action === "read-all") {
      body = { ok: true, groups: unreadGroups().map((g) => g.id) };
      inbox.nodes.forEach((n) => markGroup(n, true));
    } else if (action === "seen") inbox.unseen = 0;
    else {
      status = 400;
      body = { error: "Unknown inbox action" };
    }
  }
  requests.push({ method: req.method, path: url.pathname + url.search, status });
  return Response.json(body, { status });
}
const mediaAssets = [
  {
    id: "101",
    mediaId: "11111111-1111-4111-8111-111111111111",
    filename: "media-video.mp4",
    mimeType: "video/mp4",
    width: 480,
    height: 160,
  },
  {
    id: "102",
    mediaId: "22222222-2222-4222-8222-222222222222",
    filename: "media-image.png",
    mimeType: "image/png",
    width: 320,
    height: 480,
  },
  {
    id: "103",
    mediaId: "33333333-3333-4333-8333-333333333333",
    filename: "media-file.txt",
    mimeType: "text/plain",
    width: undefined,
    height: undefined,
  },
];
const longAsset = {
  id: "104",
  mediaId: "55555555-5555-4555-8555-555555555555",
  filename: "media-long.mp4",
  mimeType: "video/mp4",
  width: 480,
  height: 160,
};
const longNodes = [
  {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [
      { type: "media", attrs: { type: "file", id: longAsset.mediaId, width: 480, height: 160 } },
    ],
  },
];
const mediaNodes = mediaAssets.map((a) => ({
  type: "mediaSingle",
  attrs: { layout: "center" },
  content: [
    {
      type: "media",
      attrs: {
        type: "file",
        id: a.mediaId,
        collection: "",
        ...(a.width ? { width: a.width, height: a.height } : {}),
      },
    },
  ],
}));
const imageNode = mediaNodes[1]!.content[0]!;
const inlineParagraph = {
  type: "paragraph",
  content: [
    { type: "text", text: "Before " },
    {
      type: "mediaInline",
      attrs: { id: mediaAssets[2]!.mediaId, type: "file", collection: "", localId: "inline-file" },
    },
    { type: "text", text: " after" },
  ],
};
const layoutNodes = [
  {
    type: "mediaSingle",
    attrs: { layout: "wrap-left", width: 50, widthType: "percentage" },
    content: [imageNode],
  },
  {
    type: "paragraph",
    content: [{ type: "text", text: "Text following a wrapped image. ".repeat(10) }],
  },
  {
    type: "mediaSingle",
    attrs: { layout: "align-end", width: 160, widthType: "pixel" },
    content: [imageNode],
  },
  { type: "mediaSingle", attrs: { layout: "wide" }, content: [mediaNodes[0]!.content[0]!] },
  { type: "mediaSingle", attrs: { layout: "full-width" }, content: [imageNode] },
  { type: "mediaGroup", content: mediaNodes.map((n) => n.content[0]!) },
  inlineParagraph,
  {
    type: "mediaSingle",
    attrs: { layout: "center", width: 200, widthType: "pixel" },
    content: [
      {
        type: "media",
        attrs: {
          type: "external",
          url: "https://images.example.test/portrait.png",
          width: 320,
          height: 480,
          alt: "External portrait",
        },
      },
    ],
  },
];
const naturalLayoutNodes = [
  mediaNodes[0]!,
  mediaNodes[1]!,
  { type: "mediaSingle", attrs: { layout: "wrap-left" }, content: [imageNode] },
  {
    type: "paragraph",
    content: [{ type: "text", text: "Text beside a naturally sized image. ".repeat(20) }],
  },
];
/** The issue's full record, with the comments `jiraComments` kept. */
function full(key: string): any {
  const record = jiraFull(key),
    kept = posted.get(key);
  if (!kept?.length) return record;
  const { total, comments } = record.fields.comment;
  return { ...record, fields: { ...record.fields, comment: { total: total + kept.length, comments: [...comments, ...kept] } } };
}
function jiraFull(key: string): any {
  const nestedContent = [
    { type: "paragraph", content: [{ type: "text", text: "Before nested media" }] },
    mediaNodes[1]!,
  ];
  const nested =
    mediaVariant === "nested-list"
      ? { type: "bulletList", content: [{ type: "listItem", content: nestedContent }] }
      : mediaVariant === "nested-table"
        ? {
            type: "table",
            content: [
              { type: "tableRow", content: [{ type: "tableCell", content: nestedContent }] },
            ],
          }
        : { type: "blockquote", content: nestedContent };
  const media = includeMedia
    ? [
        ...mediaNodes,
        ...(unmappedMedia
          ? [
              {
                type: "mediaSingle",
                content: [
                  {
                    type: "media",
                    attrs: {
                      id: "44444444-4444-4444-8444-444444444444",
                      type: "file",
                      collection: "",
                    },
                  },
                ],
              },
            ]
          : []),
      ]
    : [];
  return {
    key,
    fields: {
      description: descriptions.get(key) ?? {
        ...rich,
        content: mediaVariant.startsWith("nested-")
          ? [nested]
          : mediaVariant === "layouts"
            ? layoutNodes
            : mediaVariant === "natural"
              ? naturalLayoutNodes
              : mediaVariant === "long"
                ? longNodes
                : [...rich.content, ...media, ...(smartLinks && key === "TEST-2" ? smartLinkNodes : [])],
      },
      ...(includeMedia
        ? {
            attachment: [...(mediaVariant === "long" ? [longAsset] : mediaAssets)]
              .reverse()
              .map((a) => ({
                id: a.id,
                filename: a.filename,
                mimeType: a.mimeType,
                size: fixtureFile(a.filename).size,
                content: `https://example.atlassian.net/secure/attachment/${a.id}/${a.filename}`,
              })),
          }
        : {}),
      reporter: { accountId: user.id, displayName: user.name },
      created: "2026-11-06T10:00:00Z",
      comment: threadedComments
        ? { total: thread.length, comments: thread }
        : smartLinks && key === "TEST-2"
          ? {
              total: 1,
              comments: [
                {
                  id: "jira-smart-link-comment",
                  author: { accountId: user.id, displayName: user.name },
                  created: "2026-11-06T10:00:00Z",
                  body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Done in " }, card("https://github.com/acme/widgets/pull/42")] }] },
                },
              ],
            }
        : {
            total: mediaInComment ? 1 : 0,
            comments: mediaInComment
              ? [
                  {
                    id: "jira-media-comment",
                    author: { accountId: user.id, displayName: user.name },
                    created: "2026-11-06T10:00:00Z",
                    body: {
                      type: "doc",
                      version: 1,
                      content: mediaVariant.startsWith("nested-")
                        ? [nested]
                        : mediaVariant === "layouts"
                          ? [inlineParagraph]
                          : mediaNodes,
                    },
                  },
                ]
              : [],
          },
    },
  };
}
const gateway = attachmentGateway({
  readIssue: async (key) => (issues.some((i) => i.key === key) ? full(key) : undefined),
  read: async (id, options) => {
    const asset = [...mediaAssets, longAsset].find((a) => a.id === id);
    if (!asset) return new Response(null, { status: 404 });
    if (options.redirect) {
      requests.push({
        method: "GET",
        path: `/upstream/attachment/${id}?redirect=true`,
        status: 303,
      });
      return new Response(null, {
        status: 303,
        headers: {
          Location: `https://api.media.atlassian.com/file/${asset.mediaId}/binary?token=fixture-only`,
        },
      });
    }
    if (contentFailure) return new Response(null, { status: contentFailure });
    const file = fixtureFile(asset.filename);
    let start = 0,
      end = file.size - 1,
      status = 200;
    if (options.range) {
      const match = options.range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${file.size}` },
        });
      if (!match[1]) start = Math.max(0, file.size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (start > end || start >= file.size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${file.size}` },
        });
      status = 206;
    }
    requests.push({
      method: "GET",
      path: `/upstream/attachment/${id}?range=${options.range ?? "none"}`,
      status,
    });
    return new Response(file.slice(start, end + 1), {
      status,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}),
      },
    });
  },
});
async function handle(req: Request) {
  const url = new URL(req.url),
    path = url.pathname;
  if (path === "/__fixture" && req.method === "POST") {
    viewDb.run("DELETE FROM saved_views");
    viewDb.run("DELETE FROM view_imports");
    const settings = await req.json();
    clientFailures = settings.clientFailures ?? 0;
    syncErrors = settings.syncErrors ?? [];
    syncingReads = settings.syncingReads ?? 0;
    streaming = settings.streaming ?? 0;
    detailFailures = settings.detailFailures ?? 0;
    includeMedia = settings.includeMedia ?? false;
    mediaInComment = settings.mediaInComment ?? false;
    threadedComments = settings.threadedComments ?? false;
    distinctCreator = settings.distinctCreator ?? false;
    mediaFailure = settings.mediaFailure ?? 0;
    contentFailure = settings.contentFailure ?? 0;
    unmappedMedia = settings.unmappedMedia ?? false;
    mediaDelay = settings.mediaDelay ?? 0;
    mediaVariant = settings.mediaVariant ?? "";
    writable = settings.writable ?? false;
    subtask = settings.subtask ?? false;
    epics = settings.epics ?? false;
    crossLinks = settings.crossLinks ?? false;
    createSuccess = settings.createSuccess ?? false;
    jiraEdits = settings.jiraEdits ?? false;
    jiraComments = settings.jiraComments ?? false;
    posted.clear();
    refuse = settings.refuse ?? [];
    refuseText = settings.refuseText ?? "Jira refused the change.";
    edited.clear();
    createdIssues.clear();
    descriptions.clear();
    bulk = settings.bulk ?? 0;
    bulkVariety = settings.bulkVariety ?? 0;
    added = false;
    sharedBoards = settings.sharedBoards ?? false;
    history = settings.history ?? {};
    historyDelay = settings.historyDelay ?? 0;
    smartLinks = settings.smartLinks ?? false;
    catalog = {
      priorities: settings.catalog?.priorities ?? [],
      labels: settings.catalog?.labels ?? [],
      users: settings.catalog?.users ?? [],
    };
    inbox = freshInbox(settings.inboxExtra ?? 0, settings.inboxExtraUnread ?? false, settings.inboxRichOutside ?? false);
    inboxFail = settings.inboxFail ?? false;
    inboxDelay = settings.inboxDelay ?? 0;
    inboxWriteDelays = settings.inboxWriteDelays ?? [];
    requests.length = 0;
    writes.length = 0;
    types.clear();
    parents.clear();
    unlinked.clear();
    moved.clear();
    ranked.clear();
    return Response.json({ ok: true });
  }
  // Turns Jira's refusals on or off mid-test, keeping everything else the fixture holds.
  if (path === "/__fixture/refuse" && req.method === "POST") {
    const settings = await req.json();
    refuse = settings.refuse ?? [];
    refuseText = settings.refuseText ?? "Jira refused the change.";
    return Response.json({ ok: true });
  }
  if (path === "/__fixture" && req.method === "GET")
    return Response.json({ requests, rich, writes });
  // A new notification lands in Jira's bell as its issue's group head, and the server tells open tabs, as its poll does.
  if (path === "/__fixture/inbox" && req.method === "POST") {
    const n: {
      n: number;
      key: string;
      title: string;
      type?: string;
      message: string;
      category?: "direct" | "watching";
      read?: boolean;
      /** Who acted, when not the message's first word. */
      actor?: string;
      comment?: string;
      commentId?: string;
    } = await req.json();
    let node = notification(n.n, n.key, n.title, n.type ?? "updated", n.message, n.category ?? "direct", n.read ?? false, 0, n.comment);
    if (n.commentId) node = onComment(node, n.commentId);
    if (n.actor) node.headNotification.content.actor.displayName = n.actor;
    inbox.nodes = [node, ...inbox.nodes.filter((g) => g.groupId !== node.groupId)];
    if (!n.read) inbox.unseen += 1;
    for (const listener of eventListeners) listener.enqueue(new TextEncoder().encode("data: inbox\n\n"));
    return Response.json({ ok: true });
  }
  if (path === "/api/inbox") return inboxRoute(req, url);
  if (path === "/api/inbox/group") {
    const node = inbox.nodes.find((n) => n.groupId === url.searchParams.get("id"));
    requests.push({ method: req.method, path: url.pathname + url.search, status: 200 });
    return Response.json(
      fixtureGroupPage(
        (node && "children" in node ? node.children : node ? [node.headNotification] : []) as unknown[],
        Number(url.searchParams.get("after") || 0),
      ),
    );
  }
  let status = 200,
    body: unknown;
  const ops = path.match(/^\/api\/issues\/([^/]+)\/ops$/);
  if (writable && ops && req.method === "POST")
    return applyOps(decodeURIComponent(ops[1]!), (await req.json()).ops);
  // Stands in for the server's addBoard: board 2 exists on the fixture site, nothing else does.
  if (path === "/api/boards" && req.method === "POST") {
    try {
      const id = boardFromInput((await req.json()).board ?? "", "https://example.atlassian.net");
      if (id === 1 || (id === 2 && (added || bulk || sharedBoards)))
        return Response.json({ id, message: `Board ${id} is already in your sidebar.` });
      if (id !== 2)
        throw new Error(
          `Board ${id} doesn't exist on example.atlassian.net, or your Jira account can't see it.`,
        );
      added = true;
      return Response.json({ id, message: "Added Second board." });
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 422 });
    }
  }
  // Stands in for removeBoard: only the board added from the app can go (BJ-24).
  if (path === "/api/boards/2" && req.method === "DELETE" && added) {
    added = false;
    return new Response(null, { status: 204 });
  }
  if (req.method !== "GET") {
    status = 405;
    body = { error: "Fixture API is read-only" };
  } else if (path === "/api/client") {
    if (clientFailures-- > 0) {
      status = 503;
      body = { error: "Test unavailable" };
    } else body = { site: "https://example.atlassian.net", user, writable };
  } else if (path === "/api/sync")
    body = {
      errors: syncErrors,
      syncing: syncingReads > 0 ? [{ board: board.id, loaded: 300, total: 900 }] : [],
    };
  else if (path === "/api/boards")
    body =
      syncingReads-- > 0
        ? []
        : sharedBoards
          ? [board, { ...board, id: 2, name: "Squad board" }]
          : bulk || added
            ? [board, { ...board, id: 2, name: "Second board", ...(added ? { removable: true } : {}) }]
            : [board];
  else if (path === "/api/issues") body = listed();
  else if (path === "/api/options")
    body = {
      priorities: catalog.priorities.map((name, i) => ({ id: String(i + 1), name })),
      users: catalog.users.map((name, i) => ({ id: `catalog-${i}`, name })),
      labels: catalog.labels,
      versions: {},
      types: { TEST: issueTypes },
    };
  else if (path === "/api/view-defaults") body = {};
  else if (path === "/api/users") {
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    // Like Jira: an issue's search (viewissue/assignable) never finds someone who can't see it; the site-wide search does.
    body = [
      ...people,
      ...(url.searchParams.get("issue") ? [] : [{ id: "sam", name: "Sam Outsider" }]),
    ].filter((person) => person.name.toLowerCase().includes(query));
  } else if (path === "/api/properties")
    body = {
      entries: {},
      progress: { total: 0, pending: 0, completed: 0, errors: 0 },
      sync: { errors: syncErrors, syncing: streaming-- > 0 ? [{ board: board.id, loaded: 100, total: 900 }] : [] },
    };
  else if (path.match(/^\/api\/issues\/[^/]+\/media\/[^/]+$/)) {
    if (mediaDelay) await Bun.sleep(mediaDelay);
    if (mediaFailure) {
      status = mediaFailure;
      body = { error: "Fixture media unavailable" };
    } else {
      const [, key, id] = path.match(/^\/api\/issues\/([^/]+)\/media\/([^/]+)$/)!;
      const attachment = await gateway.resolve(key!, id!);
      status = attachment ? 200 : 404;
      body = attachment ?? { error: "Media not found" };
    }
  } else if (path.match(/^\/api\/issues\/[^/]+\/attachments\/[^/]+$/)) {
    const [, key, id] = path.match(/^\/api\/issues\/([^/]+)\/attachments\/([^/]+)$/)!;
    const response = await gateway.content(req, key!, id!);
    requests.push({ method: req.method, path, status: response.status });
    return response;
  }
  // Link previews: example.com unfurls from a canned copy of its page (no network); anything else has none.
  else if (path === "/api/link-preview") {
    const target = url.searchParams.get("url") ?? "";
    body = /^https?:\/\/(www\.)?example\.com(\/|$)/.test(target)
      ? await previewFrom(
          `<html><head><title>Example Domain</title><link rel="icon" href="${url.origin}/__link-icon.svg"></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission.</p></div></body></html>`,
          target,
        )
      : null;
  } else if (path === "/api/smart-link") body = smartLinkDetails[url.searchParams.get("url") ?? ""] ?? null;
  else if (path === "/api/favicon") {
    // GitHub's icon is "fetched"; every other site has none (the link icon shows).
    requests.push({ method: req.method, path: path + url.search, status: 200 });
    return url.searchParams.get("origin") === "https://github.com"
      ? new Response(fixtureFile("media-image.png"), { headers: { "Content-Type": "image/png" } })
      : new Response(null, { status: 404 });
  } else if (path.match(/^\/api\/issues\/[^/]+\/pull-requests$/)) {
    body = fixturePullRequests[decodeURIComponent(path.split("/").at(-2)!)] ?? [];
  } else if (path.match(/^\/api\/issues\/[^/]+\/history$/)) {
    if (historyDelay) await Bun.sleep(historyDelay);
    body = history[decodeURIComponent(path.split("/").at(-2)!)] ?? [];
  } else if (path.startsWith("/api/issues/")) {
    if (detailFailures-- > 0) {
      status = 503;
      body = { error: "Test unavailable" };
    } else body = full(decodeURIComponent(path.split("/").at(-1)!));
  } else {
    status = 404;
    body = { error: "Unknown fixture route" };
  }
  requests.push({ method: req.method, path, status });
  return Response.json(body, { status });
}
// A real split build lets the browser hold the media chunk pending and exercise Suspense.
let splitBuild: Promise<{ files: Map<string, Blob>; mediaChunk: string | undefined }> | undefined;
async function splitFixture(req: Request) {
  splitBuild ??= (async () => {
    const result = await Bun.build({
      entrypoints: ["./scripts/editor-media-fixture.html"],
      target: "browser",
      splitting: true,
      plugins: [tailwind],
      naming: "[name]-[hash].[ext]",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
    });
    if (!result.success) throw new Error("Could not build split media fixture");
    const mediaChunk = (
      await Promise.all(
        result.outputs
          .filter((output) => output.path.endsWith(".js"))
          .map(async (output) => ({
            name: output.path.split("/").at(-1)!,
            text: await output.text(),
          })),
      )
    ).find((output) => output.text.includes("function MediaRenderer("))?.name;
    return {
      files: new Map(result.outputs.map((output) => [output.path.split("/").at(-1)!, output])),
      mediaChunk,
    };
  })();
  const { files, mediaChunk } = await splitBuild,
    name = new URL(req.url).pathname.split("/").at(-1)!;
  if (name === "manifest.json") return Response.json({ mediaChunk });
  const file =
    name === "index.html"
      ? [...files.entries()].find(([name]) => name.endsWith(".html"))?.[1]
      : files.get(name);
  return file
    ? new Response(file, { headers: { "Content-Type": file.type } })
    : new Response(null, { status: 404 });
}
/** Open event streams, told "inbox" when `/__fixture/inbox` adds a notification. */
const eventListeners = new Set<ReadableStreamDefaultController>();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.FIXTURE_PORT ?? 3001),
  routes: {
    "/*": index,
    "/api/views": (req) => views.handle(req, "fixture"),
    "/api/views/:id": (req) => views.handle(req, "fixture", req.params.id),
    "/api/events": (req) => {
      server.timeout(req, 0);
      let listener: ReadableStreamDefaultController;
      return new Response(
        new ReadableStream({
          start(c) {
            listener = c;
            eventListeners.add(c);
            c.enqueue(new TextEncoder().encode(": open\n\n"));
          },
          cancel() {
            eventListeners.delete(listener);
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
    "/__editor-media-fixture": editorMediaFixture,
    "/__split-media-assets/*": splitFixture,
    "/api/*": handle,
    "/__fixture": handle,
    "/__fixture/inbox": handle,
    "/__fixture/refuse": handle,
    "/api/avatar": avatar,
    "/__avatar/alex.png": () => new Response(fixtureFile("media-image.png")),
    "/__link-icon.svg": () =>
      new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#fff"/></svg>',
        { headers: { "Content-Type": "image/svg+xml" } },
      ),
  },
});
console.log(`Disposable browser fixture on ${server.url}`);
// A launcher that holds this pipe open: once it is gone, even killed, the server goes too.
if (process.env.FIXTURE_EXIT_ON_EOF)
  void (async () => {
    for await (const _ of Bun.stdin.stream());
    process.exit();
  })();
