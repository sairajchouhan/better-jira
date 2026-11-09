import { expect, test } from "bun:test";

test("R2-inbox-D4: the poll sees a new notification even when another tab's seen reset the count in between", async () => {
  const originalFetch = globalThis.fetch;
  const saved = {
    url: process.env.JIRA_URL,
    email: process.env.JIRA_EMAIL,
    token: process.env.JIRA_TOKEN,
  };
  let feed = { unseen: 1, head: "n1" };
  try {
    process.env.JIRA_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "test@example.invalid";
    process.env.JIRA_TOKEN = "test-only";
    globalThis.fetch = Object.assign(
      async (url: string) =>
        String(url).endsWith("/_edge/tenant_info")
          ? Response.json({ cloudId: "cloud" })
          : Response.json({
              data: {
                notifications: {
                  unseenNotificationCount: feed.unseen,
                  notificationFeed: {
                    nodes: [{ headNotification: { notificationId: feed.head } }],
                  },
                },
              },
            }),
      originalFetch,
    );
    const { unseenChanged } = await import("./notifications");
    const g = globalThis as { inboxChecked?: number };
    const poll = () => ((g.inboxChecked = 0), unseenChanged());
    expect(await poll()).toBe(false); // first read is the baseline
    expect(await poll()).toBe(false);
    // A tab cleared the count to 0 and a new notification brought it back to 1 before the next poll.
    feed = { unseen: 1, head: "n2" };
    expect(await poll()).toBe(true);
    feed = { unseen: 0, head: "n2" };
    expect(await poll()).toBe(true);
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
