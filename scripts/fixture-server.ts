/** Disposable browser-test data. No Jira client, credentials, or cache are imported. */
import index from "../src/index.html";
import editorMediaFixture from "./editor-media-fixture.html";
import tailwind from "bun-plugin-tailwind";
import { attachmentGateway } from "../src/attachment-media";
import { previewFrom } from "../src/link-preview";
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
const people = [user, { id: "alex", name: "Alex" }, { id: "priya", name: "Priya Raman" }];
const priorities = ["Normal", "Low", "High", "Urgent", "Normal", "Low"];
const issues = Array.from({ length: 6 }, (_, i) => ({
  key: `TEST-${i + 1}`,
  board: 1,
  summary: i === 0 ? "Rich browser fixture" : `Browser fixture ${i + 1}`,
  status: i === 2 ? "doing" : "todo",
  rank: `0|i0000${i}:`,
  type: "Task",
  priority: priorities[i],
  assignee: i === 1 ? { id: "alex", name: "Alex" } : null,
  labels: [i === 0 ? "ui" : "test"],
  comments: 0,
  updated: "2026-11-06T10:00:00Z",
  created: "2026-11-06T10:00:00Z",
  resolved: null,
  project: { key: "TEST", name: "Audit" },
}));
let clientFailures = 0,
  detailFailures = 0,
  includeMedia = false,
  mediaInComment = false,
  mediaFailure = 0,
  contentFailure = 0,
  unmappedMedia = false,
  mediaDelay = 0,
  mediaVariant = "";
const requests: { method: string; path: string; status: number }[] = [];
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
                size: Bun.file(new URL(`../e2e/fixtures/${a.filename}`, import.meta.url)).size,
                content: `https://example.atlassian.net/secure/attachment/${a.id}/${a.filename}`,
              })),
          }
        : {}),
      reporter: { accountId: user.id, displayName: user.name },
      created: "2026-11-06T10:00:00Z",
      comment: {
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
    const file = Bun.file(new URL(`../e2e/fixtures/${asset.filename}`, import.meta.url));
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
    const settings = await req.json();
    clientFailures = settings.clientFailures ?? 0;
    detailFailures = settings.detailFailures ?? 0;
    includeMedia = settings.includeMedia ?? false;
    mediaInComment = settings.mediaInComment ?? false;
    mediaFailure = settings.mediaFailure ?? 0;
    contentFailure = settings.contentFailure ?? 0;
    unmappedMedia = settings.unmappedMedia ?? false;
    mediaDelay = settings.mediaDelay ?? 0;
    mediaVariant = settings.mediaVariant ?? "";
    requests.length = 0;
    return Response.json({ ok: true });
  }
  if (path === "/__fixture" && req.method === "GET") return Response.json({ requests, rich });
  let status = 200,
    body: unknown;
  if (req.method !== "GET") {
    status = 405;
    body = { error: "Fixture API is read-only" };
  } else if (path === "/api/client") {
    if (clientFailures-- > 0) {
      status = 503;
      body = { error: "Test unavailable" };
    } else body = { site: "https://example.atlassian.net", user };
  } else if (path === "/api/boards") body = [board];
  else if (path === "/api/issues")
    body = issues.map((issue) => ({ ...issue, comments: mediaInComment ? 1 : 0 })); // the mirror list counts the same Jira comments the detail returns
  else if (path === "/api/view-defaults") body = {};
  else if (path === "/api/users") {
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    body = people.filter((person) => person.name.toLowerCase().includes(query));
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
    "/__link-icon.svg": () =>
      new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#fff"/></svg>',
        { headers: { "Content-Type": "image/svg+xml" } },
      ),
  },
});
console.log(`Disposable browser fixture on ${server.url}`);
