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
import { mapFeed } from "../src/shared/inbox-model";
import { boardFromInput } from "../src/server/config";
import { avatarProxy, memoryAvatarCache } from "../src/shared/avatar-proxy";

/** A file in e2e/fixtures, from the repo root the suite runs in, so the built copy in dist/ finds it too. */
const fixtureFile = (name: string) => Bun.file(`e2e/fixtures/${name}`);
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
  board: 1,
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
  /** Speed checks: this many extra issues on each of two boards, like a real team board. */
  bulk = 0,
  /** Board 2 was added from the app. */
  added = false,
  /** BJ-15: TEST-1's Jira links reach issues outside the board and use link types Linear has no kind for. */
  crossLinks = false;
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
  /** Links the app removed, from either end (see `pair`). */
  unlinked = new Set<string>();
const pair = (a: string, b: string) => [a, b].sort().join(" ");
// Jira's createmeta types for TEST, with their hierarchy levels.
const issueTypes = [
  { name: "Epic", hierarchyLevel: 1 },
  { name: "Subtask", hierarchyLevel: -1 },
  { name: "Task", hierarchyLevel: 0 },
  { name: "Story", hierarchyLevel: 0 },
];
const statuses = ["backlog", "todo", "doing", "review", "done"];
const bulkIssues = () =>
  [1, 2].flatMap((boardId) =>
    Array.from({ length: bulk }, (_, i) => ({
      ...issues[1]!,
      key: `${boardId === 1 ? "BULK" : "TWO"}-${i + 1}`,
      board: boardId,
      summary: `Bulk fixture ${i + 1} with a longer title that wraps onto a second line`,
      status: statuses[i % 5]!,
      rank: `0|i1${String(i).padStart(4, "0")}:`,
      priority: priorities[i % 6],
      labels: ["test", ...(i % 3 ? [] : ["perf"])],
      comments: i % 4,
      assignee: people[i % 3]!,
      due: i % 7 ? null : "2026-11-20",
      resolved: i % 5 === 4 ? "2026-11-07T10:00:00Z" : null,
    })),
  );
const listed = () =>
  [
    ...issues,
    ...bulkIssues(),
    ...(added ? [{ ...issues[1]!, key: "ADD-1", board: 2, summary: "Added board issue" }] : []),
  ].map((issue) => ({
    ...issue,
    ...(distinctCreator && issue.key === "TEST-6" ? { creator: alex } : {}),
    ...(subtask && issue.key === "TEST-6" ? { type: "Subtask", parent: "TEST-5" } : {}),
    ...(crossLinks && issue.key === "TEST-1"
      ? { relations: crossRelations.filter((r) => !unlinked.has(pair("TEST-1", r.key))) }
      : {}),
    ...(crossLinks && issue.key === "TEST-2" && !unlinked.has(pair("TEST-1", "TEST-2"))
      ? { relations: [{ key: "TEST-1", kind: "inward:Cloners", label: "is cloned by" }] }
      : {}),
    ...(types.has(issue.key) ? { type: types.get(issue.key) } : {}),
    comments: threadedComments ? thread.length : mediaInComment ? 1 : 0, // the mirror list counts the same Jira comments the detail returns
  }));
/** Stands in for the server's applyOps: type changes follow live Jira, which refuses Subtask ↔ standard types. */
function applyOps(key: string, ops: any[]) {
  writes.push({ key, ops });
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
    if (op.op === "link" && op.remove) unlinked.add(pair(key, op.target));
  return Response.json({
    key,
    created: {},
    others: [],
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
  comment?: string,
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
                  content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }],
                }),
              },
            },
          ]
        : [],
    },
  },
});
/** `extra` appends that many older notifications on issues outside the mirror, so the list pages; read unless `extraUnread`. */
const freshInbox = (extra = 0, extraUnread = false) => ({
  unseen: 4,
  nodes: [
    notification(
      2,
      "TEST-2",
      "Browser fixture 2",
      "updated",
      "Alex assigned a task to you",
      "direct",
      false,
      5,
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
    notification(
      9,
      "OUT-9",
      "Outside the mirror",
      "updated",
      "Sam updated a task",
      "watching",
      false,
      60 * 24 * 400,
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
async function inboxRoute(req: Request, url: URL) {
  let status = 200,
    body: unknown = { ok: true };
  if (req.method === "GET") {
    await Bun.sleep(inboxDelay);
    const category = url.searchParams.get("category"),
      start = Number(url.searchParams.get("after") || 0),
      nodes = inbox.nodes.filter((n) => !category || n.headNotification.category === category);
    body = {
      unseen: inbox.unseen,
      items: mapFeed(nodes.slice(start, start + INBOX_PAGE)),
      more: start + INBOX_PAGE < nodes.length,
      cursor: String(start + INBOX_PAGE),
      ...(start || category ? {} : { unread: unreadGroups() }),
      writable: true,
    };
  } else {
    const { action, groups = [] } = await req.json();
    if (action === "read" || action === "unread") await Bun.sleep(inboxWriteDelays.shift() ?? 0);
    const marks = (node: (typeof inbox.nodes)[number], read: boolean) => {
      node.readStates = [read ? "read" : "unread"];
      node.headNotification.readState = read ? "read" : "unread";
    };
    if (inboxFail && action !== "seen") {
      status = 502;
      body = { error: "Jira did not update the notification." };
    } else if (action === "read" || action === "unread")
      inbox.nodes
        .filter((n) => groups.includes(n.groupId))
        .forEach((n) => marks(n, action === "read"));
    else if (action === "read-all") {
      body = { ok: true, groups: unreadGroups().map((g) => g.id) };
      inbox.nodes.forEach((n) => marks(n, true));
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
function full(key: string): any {
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
      description: {
        ...rich,
        content: mediaVariant.startsWith("nested-")
          ? [nested]
          : mediaVariant === "layouts"
            ? layoutNodes
            : mediaVariant === "natural"
              ? naturalLayoutNodes
              : mediaVariant === "long"
                ? longNodes
                : [...rich.content, ...media],
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
    crossLinks = settings.crossLinks ?? false;
    bulk = settings.bulk ?? 0;
    added = false;
    inbox = freshInbox(settings.inboxExtra ?? 0, settings.inboxExtraUnread ?? false);
    inboxFail = settings.inboxFail ?? false;
    inboxDelay = settings.inboxDelay ?? 0;
    inboxWriteDelays = settings.inboxWriteDelays ?? [];
    requests.length = 0;
    writes.length = 0;
    types.clear();
    unlinked.clear();
    return Response.json({ ok: true });
  }
  if (path === "/__fixture" && req.method === "GET")
    return Response.json({ requests, rich, writes });
  if (path === "/api/inbox") return inboxRoute(req, url);
  let status = 200,
    body: unknown;
  const ops = path.match(/^\/api\/issues\/([^/]+)\/ops$/);
  if (writable && ops && req.method === "POST")
    return applyOps(decodeURIComponent(ops[1]!), (await req.json()).ops);
  // Stands in for the server's addBoard: board 2 exists on the fixture site, nothing else does.
  if (path === "/api/boards" && req.method === "POST") {
    try {
      const id = boardFromInput((await req.json()).board ?? "", "https://example.atlassian.net");
      if (id === 1 || (id === 2 && (added || bulk)))
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
  } else if (path === "/api/boards")
    body =
      bulk || added
        ? [board, { ...board, id: 2, name: "Second board", ...(added ? { removable: true } : {}) }]
        : [board];
  else if (path === "/api/issues") body = listed();
  else if (path === "/api/options")
    body = { priorities: [], users: [], labels: [], versions: {}, types: { TEST: issueTypes } };
  else if (path === "/api/view-defaults") body = {};
  else if (path === "/api/users") {
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    // Like Jira: an issue's search (viewissue/assignable) never finds someone who can't see it; the site-wide search does.
    body = [
      ...people,
      ...(url.searchParams.get("issue") ? [] : [{ id: "sam", name: "Sam Outsider" }]),
    ].filter((person) => person.name.toLowerCase().includes(query));
  } else if (path === "/api/properties")
    body = { entries: {}, progress: { total: 0, pending: 0, completed: 0, errors: 0 } };
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
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.FIXTURE_PORT ?? 3001),
  routes: {
    "/*": index,
    "/api/views": (req) => views.handle(req, "fixture"),
    "/api/views/:id": (req) => views.handle(req, "fixture", req.params.id),
    "/api/events": (req) => {
      server.timeout(req, 0);
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(": open\n\n"));
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
    "/__editor-media-fixture": editorMediaFixture,
    "/__split-media-assets/*": splitFixture,
    "/api/*": handle,
    "/__fixture": handle,
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
// The e2e launcher holds this pipe open: once it is gone, even killed, the server goes too.
if (process.env.FIXTURE_EXIT_ON_EOF)
  void (async () => {
    for await (const _ of Bun.stdin.stream());
    process.exit();
  })();
