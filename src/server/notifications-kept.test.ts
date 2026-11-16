import { afterEach, beforeEach, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;
const saved = { url: process.env.JIRA_URL, email: process.env.JIRA_EMAIL, token: process.env.JIRA_TOKEN };
type Body = { operationName: string; query: string; variables: Record<string, unknown> };
let bodies: Body[] = [];
/** Answers each gateway operation; `hold` keeps InboxFeed waiting until released. */
let jira: { readState: "read" | "unread"; groups: number; failChunk?: number; hold?: Promise<void> };

const note = (id: string, readState: string) => ({
  notificationId: id,
  timestamp: new Date().toISOString(),
  readState,
  category: "direct",
  content: { type: "updated", message: "Kai updated a task", url: "https://example.atlassian.net/browse/AB-1", actor: { displayName: "Kai" }, entity: { title: "One", status: "Doing" } },
});

beforeEach(() => {
  bodies = [];
  jira = { readState: "unread", groups: 1 };
  process.env.JIRA_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "test@example.invalid";
  process.env.JIRA_TOKEN = "test-only";
  globalThis.fetch = Object.assign(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/_edge/tenant_info")) return Response.json({ cloudId: "cloud" });
    const body: Body = JSON.parse(String(init?.body));
    bodies.push(body);
    if (body.operationName === "InboxFeed") {
      // Jira answers with the read state it had when asked; `hold` delays only the next answer.
      const { hold, readState } = jira;
      jira.hold = undefined;
      await hold;
      return Response.json({
        data: {
          notifications: {
            unseenNotificationCount: 1,
            notificationFeed: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: Array.from({ length: jira.groups }, (_, i) => ({
                groupId: `ari:cloud:jira:c:issue/${i}`,
                groupSize: 2,
                readStates: [readState],
                headNotification: note(`h${i}`, readState),
              })),
            },
          },
        },
      });
    }
    if (body.operationName === "InboxGroups") {
      const chunk = bodies.filter((b) => b.operationName === "InboxGroups").length - 1;
      if (chunk === jira.failChunk) return Response.json({ errors: [{ message: "busy" }] }, { status: 500 });
      const ids = Object.keys(body.variables).filter((k) => /^g\d+$/.test(k));
      return Response.json({
        data: { notifications: Object.fromEntries(ids.map((k) => [k, { pageInfo: { hasNextPage: false }, nodes: [note(`c-${body.variables[k]}`, jira.readState)] }])) },
      });
    }
    if (body.operationName === "InboxUnread")
      return Response.json({
        data: { notifications: { notificationFeed: { pageInfo: { hasNextPage: false }, nodes: jira.readState === "unread" ? [{ groupId: "ari:cloud:jira:c:issue/0", headNotification: { notificationId: "h0" } }] : [] } } },
      });
    return Response.json({ errors: [{ message: "unexpected" }] }, { status: 400 });
  }, originalFetch);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of [
    ["JIRA_URL", saved.url],
    ["JIRA_EMAIL", saved.email],
    ["JIRA_TOKEN", saved.token],
  ] as const)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("R4-inbox-D5: the feed's groups go as parallel requests of six; a failed one costs only its own groups", async () => {
  const { feed, GROUP_CHUNK } = await import("./notifications");
  expect(GROUP_CHUNK).toBe(6);
  jira.groups = 14;
  jira.failChunk = 1;
  const page = await feed();
  const requests = bodies.filter((b) => b.operationName === "InboxGroups");
  expect(requests.map((b) => Object.keys(b.variables).filter((k) => /^g\d+$/.test(k)).length)).toEqual([6, 6, 2]);
  // Every row is listed; the second request's six rows have no group page (they read it on expand).
  expect(page.items).toHaveLength(14);
  expect(page.items.filter((i) => i.group).length).toBe(8);
});
