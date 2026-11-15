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

test("prod parity #14/#15, R3 G20: the feed reads every group's first page in one request and sends it with the row; later pages are five at a time", async () => {
  const originalFetch = globalThis.fetch;
  const saved = { url: process.env.JIRA_URL, email: process.env.JIRA_EMAIL, token: process.env.JIRA_TOKEN };
  const now = Date.now();
  const note = (id: string, message: string, minutesAgo: number) => ({
    notificationId: id,
    timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
    readState: "read",
    category: "direct",
    content: {
      type: "updated",
      message,
      url: "https://example.atlassian.net/browse/AB-1",
      actor: { displayName: message.split(" ")[0] },
      entity: { title: "One", status: "Doing" },
    },
  });
  const bodies: { operationName: string; query: string; variables: Record<string, unknown> }[] = [];
  try {
    process.env.JIRA_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "test@example.invalid";
    process.env.JIRA_TOKEN = "test-only";
    globalThis.fetch = Object.assign(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/_edge/tenant_info")) return Response.json({ cloudId: "cloud" });
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.operationName === "InboxFeed")
        return Response.json({
          data: {
            notifications: {
              unseenNotificationCount: 0,
              notificationFeed: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  { groupId: "ari:cloud:jira:c:issue/1", groupSize: 2, readStates: ["read"], additionalActors: [{ displayName: "Hana" }], headNotification: note("h1", "Kai updated a task", 5) },
                  { groupId: "ari:cloud:jira:c:issue/2", groupSize: 1, readStates: ["read"], headNotification: note("h2", "Kai updated a task", 9) },
                ],
              },
            },
          },
        });
      if (body.operationName === "InboxGroups")
        return Response.json({
          data: {
            notifications: {
              g0: {
                pageInfo: { hasNextPage: true, endCursor: "c2" },
                nodes: [note("h1", "Kai updated a task", 5), note("a1", "Hana mentioned you in a comment", 30)],
              },
            },
          },
        });
      if (body.operationName === "InboxGroup")
        return Response.json({
          data: {
            notifications: {
              notificationGroup: {
                pageInfo: { hasNextPage: true, endCursor: "c5" },
                nodes: [1, 2, 3, 4, 5].map((i) => note(`n${i}`, "Kai updated a task", i)),
              },
            },
          },
        });
      return Response.json({ errors: [{ message: "unexpected" }] }, { status: 400 });
    }, originalFetch);
    const { feed, group } = await import("./notifications");
    const page = await feed();
    // One extra request, for the one group with more than one notification.
    const groups = bodies.filter((b) => b.operationName === "InboxGroups");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.variables).toMatchObject({ g0: "ari:cloud:jira:c:issue/1" });
    expect(groups[0]!.query).toContain("notificationGroup(groupId: $g0");
    // The read group lets a recent mention lead (Linear's prioritize); the summary keeps Jira's additionalActors (R3 G15).
    expect(page.items[0]).toMatchObject({ kind: "mentioned", head: "h1", others: [{ name: "Hana" }] });
    expect(page.items[1]).toMatchObject({ kind: "updated", count: 1 });
    // R3 G20: the page the row was ranked from comes with it, so expanding the group needs no request. Two of ten: the last page.
    expect(groups[0]!.query).toContain("first: 10");
    expect(page.items[0]!.group).toEqual({ notes: expect.any(Array), more: false, cursor: "c2" });
    expect(page.items[0]!.group!.notes.map((n) => n.id)).toEqual(["h1", "a1"]);
    expect(page.items[1]!.group).toBeUndefined();
    // Read on its own (a refetch), the first page is as long as the feed's; later ones are five, as Jira's bell.
    await group("ari:cloud:jira:c:issue/1");
    expect(bodies.at(-1)!.variables).toMatchObject({ group: "ari:cloud:jira:c:issue/1", first: 10, after: null });
    const next = await group("ari:cloud:jira:c:issue/1", "c10");
    expect(next.notes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    expect(next).toMatchObject({ more: true, cursor: "c5" });
    expect(bodies.at(-1)!.variables).toMatchObject({ group: "ari:cloud:jira:c:issue/1", first: 5, after: "c10" });
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

test("a stalled notifications gateway gives up after Jira's request timeout instead of hanging the inbox", async () => {
  const originalFetch = globalThis.fetch;
  const saved = { url: process.env.JIRA_URL, email: process.env.JIRA_EMAIL, token: process.env.JIRA_TOKEN };
  const { jiraTimeouts } = await import("./jira");
  const before = jiraTimeouts.request;
  try {
    process.env.JIRA_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "test@example.invalid";
    process.env.JIRA_TOKEN = "test-only";
    jiraTimeouts.request = 30;
    globalThis.fetch = Object.assign(
      async (url: string, init: RequestInit = {}) =>
        String(url).endsWith("/_edge/tenant_info")
          ? Response.json({ cloudId: "cloud" })
          : new Promise<Response>((_, reject) =>
              init.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
            ),
      originalFetch,
    );
    const { feed } = await import("./notifications");
    const started = Date.now();
    await expect(feed()).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(1000);
  } finally {
    jiraTimeouts.request = before;
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
