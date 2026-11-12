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
