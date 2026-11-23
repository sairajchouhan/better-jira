import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { canWrite, jira } from "./jira";
import { localMediaRequest } from "@/shared/attachment-media";
import { remoteImage } from "./remote-image";
import { viewRepository } from "./view-repository";

describe("security and safety boundaries", () => {
  test("canWrite blocks writes outside production, with JIRA_WRITES=off, or for non-configured sites", () => {
    const work = "https://work.atlassian.net";
    const personal = "https://personal.atlassian.net";

    expect(canWrite(work, { site: work, writes: true }, { NODE_ENV: "development" })).toBe(false);
    expect(canWrite(work, { site: work, writes: true }, { NODE_ENV: "production", JIRA_WRITES: "off" })).toBe(false);
    expect(canWrite(work, { site: personal, writes: true }, { NODE_ENV: "production" })).toBe(false);
    expect(canWrite(work, { site: work, writes: false }, { NODE_ENV: "production", JIRA_WRITES: personal })).toBe(false);

    expect(canWrite(personal, { site: personal, writes: true }, { NODE_ENV: "production" })).toBe(true);
    expect(canWrite(personal, { site: work, writes: false }, { NODE_ENV: "production", JIRA_WRITES: personal })).toBe(true);
  });

  test("jira() rejects absolute or protocol-relative paths to prevent auth header exfiltration", async () => {
    const prev = {
      JIRA_URL: process.env.JIRA_URL,
      JIRA_EMAIL: process.env.JIRA_EMAIL,
      JIRA_TOKEN: process.env.JIRA_TOKEN,
      JIRA_BOARDS: process.env.JIRA_BOARDS,
    };
    process.env.JIRA_URL = "https://fixture.atlassian.net";
    process.env.JIRA_EMAIL = "test@example.com";
    process.env.JIRA_TOKEN = "token";
    process.env.JIRA_BOARDS = "1";
    try {
      await expect(jira("https://evil.example/rest/api/3/myself")).rejects.toThrow(
        "Jira paths must be relative to the configured site.",
      );
      await expect(jira("//evil.example/rest/api/3/myself")).rejects.toThrow(
        "Jira paths must be relative to the configured site.",
      );
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("localMediaRequest enforces loopback host, matching Host/Origin, and same-origin fetch site", () => {
    expect(
      localMediaRequest(
        new Request("http://127.0.0.1:3002/api/issues", {
          headers: { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002", "sec-fetch-site": "same-origin" },
        }),
      ),
    ).toBe(true);

    expect(localMediaRequest(new Request("https://evil.example/api/issues"))).toBe(false);
    expect(
      localMediaRequest(
        new Request("http://127.0.0.1:3002/api/issues", {
          headers: { host: "evil.example" },
        }),
      ),
    ).toBe(false);
    expect(
      localMediaRequest(
        new Request("http://127.0.0.1:3002/api/issues", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
    expect(
      localMediaRequest(
        new Request("http://127.0.0.1:3002/api/issues", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toBe(false);
  });

  test("viewRepository rejects cross-origin mutating requests with 403", async () => {
    const db = new Database(":memory:", { strict: true });
    const repo = viewRepository(db);
    const res = await repo.handle(
      new Request("http://127.0.0.1:3002/api/views", {
        method: "POST",
        headers: { origin: "https://evil.example", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "CSRF" }),
      }),
      "ns",
    );
    expect(res.status).toBe(403);
    db.close();
  });

  test("remoteImage rejects non-http(s) URL schemes before making any network request", async () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:image/svg+xml,<svg/>"]) {
      const res = await remoteImage(bad);
      expect(res.status).toBe(400);
    }
  });
});
