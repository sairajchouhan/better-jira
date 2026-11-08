import { expect, test } from "bun:test";
import {
  attachmentGateway,
  jiraAttachmentReader,
  localMediaRequest,
  type AttachmentIssue,
} from "./attachment-media";
const uuid = "5a1a2607-67dd-412a-9f73-23e63bdac640";
const issue: AttachmentIssue = {
  key: "TEST-1",
  fields: {
    attachment: [{ id: "123", filename: "test movie.mp4", mimeType: "video/mp4", size: 6 }],
    description: {
      type: "doc",
      content: [{ type: "mediaSingle", content: [{ type: "media", attrs: { id: uuid } }] }],
    },
  },
};

test("media UUID discovery is exact, shared, and never exposes a signed location", async () => {
  let calls = 0;
  const gateway = attachmentGateway({
    readIssue: async (key) => (key === issue.key ? issue : undefined),
    read: async () => {
      calls++;
      return new Response(null, {
        status: 303,
        headers: { Location: `https://api.media.atlassian.com/file/${uuid}/binary?token=private` },
      });
    },
  });
  const [a, b] = await Promise.all([
    gateway.resolve("TEST-1", uuid),
    gateway.resolve("TEST-1", uuid),
  ]);
  expect(calls).toBe(1);
  expect(a).toEqual(b);
  expect(a?.url).toBe("/api/issues/TEST-1/attachments/123");
  expect(JSON.stringify(a)).not.toContain("token");
  expect(await gateway.resolve("TEST-1", "ffffffff-ffff-ffff-ffff-ffffffffffff")).toBeUndefined();
  expect(calls).toBe(1);
  expect(await gateway.resolve("OTHER-1", uuid)).toBeUndefined();
});

test("attachment gateway streams byte ranges, download names and upstream range errors", async () => {
  let range: string | undefined;
  const gateway = attachmentGateway({
    readIssue: async () => issue,
    read: async (_id, options) => {
      range = options.range;
      return new Response("bc", {
        status: 206,
        headers: { "Content-Range": "bytes 1-2/6", "Content-Length": "2" },
      });
    },
  });
  const response = await gateway.content(
    new Request("http://localhost/api/issues/TEST-1/attachments/123", {
      headers: { Range: "bytes=1-2" },
    }),
    "TEST-1",
    "123",
  );
  expect(range).toBe("bytes=1-2");
  expect(response.status).toBe(206);
  expect(await response.text()).toBe("bc");
  expect(response.headers.get("Content-Range")).toBe("bytes 1-2/6");
  expect(response.headers.get("Content-Disposition")).toContain("inline;");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const download = await gateway.content(
    new Request("http://localhost/api?download=1"),
    "TEST-1",
    "123",
  );
  expect(download.headers.get("Content-Disposition")).toContain(
    "attachment; filename*=UTF-8''test%20movie.mp4",
  );
});

test("numeric endpoint validation and cross-origin guards prevent credentialed arbitrary reads", async () => {
  let calls = 0;
  const gateway = attachmentGateway({
    readIssue: async () => issue,
    read: async () => {
      calls++;
      return new Response("ok");
    },
  });
  for (const id of ["456", "../123", "https://example.invalid", "123?evil=1"])
    expect((await gateway.content(new Request("http://localhost/api"), "TEST-1", id)).status).toBe(
      404,
    );
  expect(
    (
      await gateway.content(
        new Request("http://localhost/api", { headers: { Origin: "https://other.invalid" } }),
        "TEST-1",
        "123",
      )
    ).status,
  ).toBe(403);
  expect(calls).toBe(0);
});

test("untrusted redirects are not followed or used as media identity", async () => {
  for (const url of [
    `https://evil.invalid/file/${uuid}/binary`,
    `https://api.media.atlassian.com.evil.invalid/file/${uuid}/binary`,
    `http://api.media.atlassian.com/file/${uuid}/binary`,
  ]) {
    const gateway = attachmentGateway({
      readIssue: async () => issue,
      read: async () => new Response(null, { status: 303, headers: { Location: url } }),
    });
    expect(await gateway.resolve("TEST-1", uuid)).toBeUndefined();
  }
});

test("attachment HTTP reader sends auth only to the configured origin and keeps redirects manual", async () => {
  let observed: any;
  const reader = jiraAttachmentReader(
    { site: "https://example.atlassian.net", email: "test@example.invalid", token: "test-token" },
    Object.assign(async (url: any, options: any) => {
      observed = { url, options };
      return new Response(null, { status: 303, headers: { Location: "https://other.invalid" } });
    }, fetch),
  );
  await reader("123", { redirect: true });
  expect(observed.url).toBe(
    "https://example.atlassian.net/rest/api/3/attachment/content/123?redirect=true",
  );
  expect(observed.options.redirect).toBe("manual");
  expect(observed.options.headers.get("Accept")).toBe("*/*");
  await expect(reader("//evil.invalid", { redirect: false })).rejects.toThrow(
    "Invalid attachment ID",
  );
  expect((await reader("123", { redirect: false, range: "bytes=0-1,3-4" })).status).toBe(416);
});

test("active attachment formats download instead of executing in the application origin", async () => {
  for (const type of ["text/html", "image/svg+xml", "application/pdf"]) {
    const item = {
      ...issue,
      fields: {
        ...issue.fields,
        attachment: [{ id: "123", filename: "untrusted.html", mimeType: type, size: 8 }],
      },
    };
    const gateway = attachmentGateway({
      readIssue: async () => item,
      read: async () => new Response("<script>bad()</script>"),
    });
    const response = await gateway.content(new Request("http://localhost/api"), "TEST-1", "123");
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toStartWith("attachment;");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
  }
});

test("proxy forwards If-Range and client abort signals, streams cancellation, and returns 416", async () => {
  const request = new Request("http://localhost/api", {
    headers: { Range: "bytes=10-20", "If-Range": '"version-1"' },
  });
  let cancelled = false;
  const gateway = attachmentGateway({
    readIssue: async () => issue,
    read: async (_id, options) => {
      expect(options.signal).toBe(request.signal);
      expect(options.ifRange).toBe('"version-1"');
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      );
    },
  });
  const response = await gateway.content(request, "TEST-1", "123");
  await response.body?.cancel();
  expect(cancelled).toBe(true);
  const invalid = attachmentGateway({
    readIssue: async () => issue,
    read: async () => new Response(null, { status: 416 }),
  });
  const error = await invalid.content(new Request("http://localhost/api"), "TEST-1", "123");
  expect(error.status).toBe(416);
  expect(error.headers.get("Content-Range")).toBe("bytes */6");
});

test("non-GET media content, rebinding hosts, mismatched hosts and cross-site origins are rejected", async () => {
  expect(localMediaRequest(new Request("http://evil.invalid/api"))).toBe(false);
  expect(
    localMediaRequest(new Request("http://localhost/api", { headers: { Host: "evil.invalid" } })),
  ).toBe(false);
  expect(
    localMediaRequest(
      new Request("http://localhost/api", { headers: { "sec-fetch-site": "cross-site" } }),
    ),
  ).toBe(false);
  expect(
    localMediaRequest(
      new Request("http://localhost/api", { headers: { Origin: "http://localhost:9999" } }),
    ),
  ).toBe(false);
  expect(
    localMediaRequest(
      new Request("http://localhost:3000/api", {
        headers: { Host: "localhost:3000", Origin: "http://localhost:3000" },
      }),
    ),
  ).toBe(true);
  let calls = 0;
  const gateway = attachmentGateway({
    readIssue: async () => issue,
    read: async () => {
      calls++;
      return new Response();
    },
  });
  expect(
    (
      await gateway.content(
        new Request("http://localhost/api", { method: "POST" }),
        "TEST-1",
        "123",
      )
    ).status,
  ).toBe(405);
  expect(calls).toBe(0);
});

test("a failed media lookup can be retried instead of poisoning the pending cache", async () => {
  let attempts = 0;
  const gateway = attachmentGateway({
    readIssue: async () => issue,
    read: async () =>
      ++attempts === 1
        ? new Response(null, { status: 503 })
        : new Response(null, {
            status: 303,
            headers: {
              Location: `https://api.media.atlassian.com/file/${uuid}/binary?token=not-persisted`,
            },
          }),
  });
  await expect(gateway.resolve("TEST-1", uuid)).rejects.toThrow("Could not resolve Jira media");
  expect((await gateway.resolve("TEST-1", uuid))?.id).toBe("123");
  expect(attempts).toBe(2);
});

test("same-site embeds from another local server are forbidden", () => {
  expect(
    localMediaRequest(
      new Request("http://localhost:3000/api", { headers: { "sec-fetch-site": "same-site" } }),
    ),
  ).toBe(false);
  expect(
    localMediaRequest(
      new Request("http://localhost:3000/api", { headers: { "sec-fetch-site": "none" } }),
    ),
  ).toBe(true);
});

test("successful discovery with no UUID is cached briefly without caching transient errors", async () => {
  let calls = 0,
    time = 100;
  const gateway = attachmentGateway({
    readIssue: async () => issue,
    now: () => time,
    read: async () => {
      calls++;
      return new Response("no redirect");
    },
  });
  expect(await gateway.resolve("TEST-1", uuid)).toBeUndefined();
  expect(await gateway.resolve("TEST-1", uuid)).toBeUndefined();
  expect(calls).toBe(1);
  time += 61000;
  expect(await gateway.resolve("TEST-1", uuid)).toBeUndefined();
  expect(calls).toBe(2);
});

test("gzip upstream data is delivered completely without copying its compressed Content-Length", async () => {
  const text = "column,value\n".repeat(1000),
    bytes = Bun.gzipSync(new TextEncoder().encode(text));
  let encoding: string | null = null;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      encoding = req.headers.get("Accept-Encoding");
      return new Response(bytes, {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Length": String(bytes.length),
          ETag: '"compressed"',
        },
      });
    },
  });
  try {
    const read = jiraAttachmentReader({
      site: server.url.origin,
      email: "test@example.invalid",
      token: "test-only",
    });
    const gateway = attachmentGateway({
      readIssue: async () => ({
        ...issue,
        fields: {
          ...issue.fields,
          attachment: [
            { id: "123", filename: "data.csv", mimeType: "text/csv", size: text.length },
          ],
        },
      }),
      read,
    });
    const response = await gateway.content(new Request("http://localhost/api"), "TEST-1", "123");
    expect(encoding as string | null).toBe("identity");
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("ETag")).toBeNull();
    expect(await response.text()).toBe(text);
  } finally {
    await server.stop(true);
  }
});
