import { expect, test } from "bun:test";

test("Jira writes reach only the personal site; other sites fail before network access but keep reads", async () => {
  const originalFetch = globalThis.fetch;
  const saved = {
    url: process.env.JIRA_URL,
    email: process.env.JIRA_EMAIL,
    token: process.env.JIRA_TOKEN,
  };
  const calls: string[] = [];
  try {
    process.env.JIRA_EMAIL = "test@example.invalid";
    process.env.JIRA_TOKEN = "test-only";
    globalThis.fetch = Object.assign(async (url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      return Response.json({ ok: true });
    }, originalFetch);
    const { jira } = await import("./jira");
    process.env.JIRA_URL = "https://contentstack.atlassian.net";
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "post"])
      await expect(jira("/rest/api/3/issue/TEST-1", { method })).rejects.toThrow(
        "Jira writes are disabled",
      );
    expect(calls).toEqual([]);
    await jira("/rest/api/3/issue/TEST-1");
    await jira("/rest/api/3/changelog/bulkfetch", { method: "POST" });
    expect(calls).toHaveLength(2);
    process.env.JIRA_URL = "https://cloudsairaj.atlassian.net";
    await jira("/rest/api/3/issue/SAM1-1", { method: "PUT" });
    expect(calls.at(-1)).toBe("PUT https://cloudsairaj.atlassian.net/rest/api/3/issue/SAM1-1");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["JIRA_URL", saved.url],
      ["JIRA_EMAIL", saved.email],
      ["JIRA_TOKEN", saved.token],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});

test("R2-comments-D4: Jira's bare refusal codes read as a sentence, once", () => {
  const { JiraError } = require("./jira") as typeof import("./jira");
  const error = new JiraError(
    "POST",
    "/rest/api/3/issue/KAN-200/comment",
    400,
    JSON.stringify({
      errorMessages: ["CONTENT_LIMIT_EXCEEDED"],
      errors: { comment: "CONTENT_LIMIT_EXCEEDED" },
    }),
  );
  expect(error.reason).toBe(
    "The text is longer than Jira allows (32,767 characters). Shorten it and send again.",
  );
});

test("G14: a stalled Jira request gives up with a JiraTimeout; a 429 still waits and retries", async () => {
  const originalFetch = globalThis.fetch;
  const saved = { url: process.env.JIRA_URL, email: process.env.JIRA_EMAIL, token: process.env.JIRA_TOKEN };
  const { jira, jiraTimeouts, JiraTimeout } = await import("./jira");
  const before = { ...jiraTimeouts };
  let calls = 0;
  try {
    process.env.JIRA_URL = "https://cloudsairaj.atlassian.net";
    process.env.JIRA_EMAIL = "test@example.invalid";
    process.env.JIRA_TOKEN = "test-only";
    jiraTimeouts.request = 20;
    // Never answers; only the request's signal ends it.
    globalThis.fetch = Object.assign(
      (_url: string, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          calls++;
          init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
      originalFetch,
    );
    const stalled = jira("/rest/api/3/issue/SAM1-1").catch((e) => e);
    const outcome = await Promise.race([stalled, Bun.sleep(1000).then(() => "hung")]);
    expect(outcome).toBeInstanceOf(JiraTimeout);
    expect(String((outcome as Error).message)).toContain("didn't answer within");

    // A caller's own abort is not reported as a timeout.
    jiraTimeouts.request = 1000;
    const own = new AbortController();
    const aborted = jira("/rest/api/3/issue/SAM1-1", { signal: own.signal }).catch((e) => e);
    own.abort();
    expect(await aborted).not.toBeInstanceOf(JiraTimeout);

    // Retry-After is still honoured: each attempt gets its own timeout.
    jiraTimeouts.request = 50;
    calls = 0;
    globalThis.fetch = Object.assign(async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "0" } })
        : Response.json({ key: "SAM1-1" });
    }, originalFetch);
    expect(await jira("/rest/api/3/issue/SAM1-1")).toEqual({ key: "SAM1-1" });
    expect(calls).toBe(2);
  } finally {
    Object.assign(jiraTimeouts, before);
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["JIRA_URL", saved.url],
      ["JIRA_EMAIL", saved.email],
      ["JIRA_TOKEN", saved.token],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});

test("edits go to Jira only from bun start, for the site setup saved with writes on; off, another site or a dev server stays read-only", async () => {
  const { canWrite } = await import("./jira");
  const site = "https://acme-team.atlassian.net",
    production = { NODE_ENV: "production" },
    on = { site, writes: true };
  expect(canWrite(site, on, production)).toBe(true);
  expect(canWrite(site, { site, writes: false }, production)).toBe(false);
  // A settings file from before setup saved the switch: off until setup is run again.
  expect(canWrite(site, { site }, production)).toBe(false);
  // The switch belongs to the site it was saved with.
  expect(canWrite(site, { site: "https://other.atlassian.net", writes: true }, production)).toBe(false);
  expect(canWrite(site, on, { ...production, JIRA_WRITES: "off" })).toBe(false);
  expect(canWrite(site, {}, { ...production, JIRA_WRITES: site })).toBe(true);
  expect(canWrite(site, on, {})).toBe(false);
});

test("bun start names no site and no write mode of its own: setup's saved switch decides", async () => {
  const start: string = (await Bun.file(new URL("../../package.json", import.meta.url)).json()).scripts.start;
  expect(start).not.toMatch(/atlassian\.net|JIRA_WRITES/);
});
