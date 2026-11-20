import { afterAll, afterEach, expect, test } from "bun:test";
import { mark, NoAnswer } from "./notifications";

// A made-up writable site for this file only: env, not mock.module, which would reach every other test file.
const SITE = "https://fixture.atlassian.net";
const env = { JIRA_URL: SITE, JIRA_EMAIL: "sam@example.com", JIRA_TOKEN: "token", JIRA_WRITES: SITE, NODE_ENV: "production" };
const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);
afterAll(() => {
  for (const [key, value] of Object.entries(before))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

const realFetch = globalThis.fetch;
afterEach(() => void (globalThis.fetch = realFetch));
/** Jira's site answers its tenant info, and the gateway as `gateway` says. */
const jiraAnswers = (gateway: () => Promise<Response>) =>
  void (globalThis.fetch = (async (url: string | URL | Request) =>
    String(url).endsWith("/_edge/tenant_info") ? Response.json({ cloudId: "cloud-1" }) : gateway()) as typeof fetch);

// First: the site's tenant info is read once and kept after.
test("a site that can't be reached for its tenant info is NoAnswer too", async () => {
  globalThis.fetch = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
  await expect(mark(["group-1"], false)).rejects.toBeInstanceOf(NoAnswer);
});

test("a mark Jira gives no answer to is NoAnswer, so the tab sends it again", async () => {
  jiraAnswers(() => Promise.reject(new TypeError("fetch failed")));
  await expect(mark(["group-1"], true)).rejects.toBeInstanceOf(NoAnswer);
});

test("a mark Jira refuses is not NoAnswer: the tab rolls it back", async () => {
  jiraAnswers(async () => Response.json({ errors: [{ message: "Not allowed" }] }, { status: 403 }));
  const failure = await mark(["group-1"], true).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(NoAnswer);
});
