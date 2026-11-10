import { expect, mock, setSystemTime, test } from "bun:test";

// Jira's remote links for the issue, and the calls the write made.
let links: any[] = [];
const calls: string[] = [];
// Jira and the mirror take a turn each, and count how many calls are in flight at once.
let answer: (path: string, init?: RequestInit) => any = () => ({}),
  inFlight = 0,
  mostInFlight = 0;
const turn = async <T>(value: () => T) => {
  mostInFlight = Math.max(mostInFlight, ++inFlight);
  await Bun.sleep(5);
  inFlight--;
  return value();
};
import { Database } from "bun:sqlite";
import { writeLedger } from "./write-ledger";
const ledger = writeLedger(new Database(":memory:"));
mock.module("./jira", () => ({
  JiraError: class extends Error {},
  jira: async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return turn(() => (path.endsWith("/remotelink") && !init?.method ? links : answer(path, init)));
  },
}));
mock.module("./mirror", () => ({
  ESTIMATES: [],
  refresh: () => turn(() => undefined),
  ledger,
}));
const { applyOps } = await import("./jira-writes");
import type { Op } from "./jira-ops";

test("R1-D1: a web link Jira already has, added in Jira's UI under another globalId, is not posted again", async () => {
  links = [{ id: 7, globalId: "jira-ui-1", object: { url: "https://a.test/", title: "A" } }];
  calls.length = 0;
  expect(
    (await applyOps("K-1", [{ op: "weblink", url: "https://a.test/", title: "A" }])).error,
  ).toBe(undefined);
  expect(calls).toEqual(["GET /rest/api/3/issue/K-1/remotelink"]);
  // Removing it deletes that link by id, which a globalId delete would miss.
  calls.length = 0;
  await applyOps("K-1", [{ op: "weblink", url: "https://a.test/", title: "A", remove: true }]);
  expect(calls).toEqual([
    "GET /rest/api/3/issue/K-1/remotelink",
    "DELETE /rest/api/3/issue/K-1/remotelink/7",
  ]);
});

// Jira for creates: issues it made, their status, and the links posted between them.
const moved = new Set<string>(),
  linked: any[] = [];
const jiraAnswers = (path: string, init?: RequestInit) => {
  if (path === "/rest/api/3/issue" && init?.method === "POST")
    return { key: `K-${calls.filter((c) => c === "POST /rest/api/3/issue").length + 10}` };
  if (path.endsWith("/transitions") && init?.method === "POST")
    return void moved.add(path.split("/")[5]!);
  if (path.endsWith("?fields=status"))
    return {
      fields: { status: { id: moved.has(path.split("/")[5]!.split("?")[0]!) ? "3" : "1" } },
    };
  if (path.endsWith("/transitions")) return { transitions: [{ id: "31", to: { id: "3" } }] };
  if (path === "/rest/api/3/issueLinkType")
    return { issueLinkTypes: [{ name: "Blocks", inward: "is blocked by", outward: "blocks" }] };
  if (path === "/rest/api/3/issueLink")
    return void linked.push({ type: { name: "Blocks" }, inwardIssue: { key: "K-2" } });
  if (path.endsWith("?fields=issuelinks")) return { fields: { issuelinks: linked } };
  return {};
};

test("R2-create-D1: one submit makes one Jira issue, however often or however concurrently it is sent", async () => {
  answer = jiraAnswers;
  calls.length = 0;
  const create = (): Op[] => [
    { op: "create", fields: { summary: "S", project: "K", status: "3" }, client: "K-NEW1@t" },
    { op: "link", target: "K-2", kind: "blocking" },
  ];
  // Two tabs send it at once, then a reload replays it after it settled.
  const [one, two] = await Promise.all([
    applyOps("K-NEW1", create()),
    applyOps("K-NEW1", create()),
  ]);
  const three = await applyOps("K-NEW1", create());
  expect(calls.filter((c) => c === "POST /rest/api/3/issue")).toHaveLength(1);
  expect([one, two, three].map((r) => [r.key, r.created["K-NEW1"], r.error])).toEqual([
    ["K-11", "K-11", undefined],
    ["K-11", "K-11", undefined],
    ["K-11", "K-11", undefined],
  ]);
  // Replays don't move or link it again: the first send did.
  expect(calls.filter((c) => c.startsWith("POST /rest/api/3/issue/K-11/transitions"))).toHaveLength(
    1,
  );
  expect(calls.filter((c) => c === "POST /rest/api/3/issueLink")).toHaveLength(1);
  // A different submit (another client id) still creates its own issue.
  await applyOps("K-NEW2", [
    { op: "create", fields: { summary: "S", project: "K" }, client: "K-NEW2@t" },
  ]);
  expect(calls.filter((c) => c === "POST /rest/api/3/issue")).toHaveLength(2);
});

test("R2-create-D2: a create's independent Jira reads go out together, not one after another", async () => {
  answer = jiraAnswers;
  mostInFlight = 0;
  // The status reads (current status, transitions), and the issue's and the linked issue's re-reads.
  await applyOps("K-NEW3", [
    { op: "create", fields: { summary: "S", project: "K", status: "3" }, client: "K-NEW3@t" },
  ]);
  expect(mostInFlight).toBe(2);
  mostInFlight = 0;
  await applyOps("K-1", [{ op: "link", target: "K-2", kind: "blocking" }]);
  expect(mostInFlight).toBe(2);
  // A client with a later write queued for the issue doesn't wait for its re-read.
  calls.length = 0;
  expect((await applyOps("K-1", [], undefined, false)).issue).toBe(undefined);
});

test("sync D1: a comment whose first send reached Jira is not posted again by a replay, however soon it comes", async () => {
  const { opsFor } = await import("./jira-ops");
  let posted = 0;
  answer = (path, init) =>
    path === "/rest/api/3/issue/K-1/comment" && init?.method === "POST"
      ? { id: String(10120 + posted++) }
      : {};
  calls.length = 0;
  // The ops a closed tab's saved change replays: a local comment Jira has no id for yet.
  const comment = {
    id: "local-7",
    created: "2026-11-10T13:40:06.000Z",
    body: { type: "doc", version: 1, content: [] },
  };
  const issue = { key: "K-1", board: 1, status: "1", labels: [] } as any;
  const ops = () =>
    opsFor(
      { issue, full: { key: "K-1", fields: { comment: { comments: [] } } } },
      { issue, full: { key: "K-1", fields: { comment: { comments: [comment] } } } },
      new Map(),
    );
  // The closing tab's send and the next tab's replay overlap, then a reload replays it again.
  const [one, two] = await Promise.all([applyOps("K-1", ops()), applyOps("K-1", ops())]);
  const three = await applyOps("K-1", ops());
  expect(posted).toBe(1);
  expect([one, two, three].map((r) => r.created["local-7"])).toEqual(["10120", "10120", "10120"]);
  // A comment Jira has since lost is posted again.
  const { JiraError } = await import("./jira");
  answer = (path, init) => {
    if (path === "/rest/api/3/issue/K-1/comment/10120")
      throw Object.assign(new JiraError("GET", path, 404, "gone"), { status: 404 });
    return path === "/rest/api/3/issue/K-1/comment" && init?.method === "POST"
      ? { id: String(10120 + posted++) }
      : {};
  };
  expect((await applyOps("K-1", ops())).created["local-7"]).toBe("10121");
});

test("sync review 1: a create, comment or upload Jira took but whose answer was lost is found in Jira by its tag, not sent again", async () => {
  const { uploadAttachment } = await import("./jira-writes");
  // Jira keeps what it was sent; the answer to each first send never arrives (the server exited, the socket dropped).
  const issues: any[] = [],
    comments: any[] = [],
    attachments: any[] = [];
  let lose = true;
  const lost = <T>(value: T) => {
    if (lose) throw new TypeError("socket closed");
    return value;
  };
  answer = (path, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (path === "/rest/api/3/issue" && init?.method === "POST") {
      const issue = {
        key: `K-${30 + issues.length}`,
        properties: { [body.properties[0].key]: body.properties[0].value },
      };
      issues.push(issue);
      return lost({ key: issue.key });
    }
    if (path === "/rest/api/3/search/jql") return { issues };
    if (path === "/rest/api/3/issue/K-1/comment" && init?.method === "POST") {
      comments.push({ id: String(500 + comments.length), properties: body.properties });
      return lost({ id: comments.at(-1).id });
    }
    if (path.startsWith("/rest/api/3/issue/K-1/comment?")) return { comments };
    if (path === "/rest/api/3/issue/K-1/attachments") {
      attachments.push({
        id: String(900 + attachments.length),
        filename: "a.png",
        size: 3,
        created: new Date().toISOString(),
        author: { accountId: "me" },
      });
      return lost([attachments.at(-1)]);
    }
    if (path === "/rest/api/3/issue/K-1?fields=attachment")
      return { fields: { attachment: attachments } };
    if (path === "/rest/api/3/myself") return { accountId: "me" };
    return jiraAnswers(path, init);
  };
  const create: Op[] = [
    { op: "create", fields: { summary: "S", project: "K" }, client: "K-NEW9@t" },
  ];
  const comment: Op[] = [
    { op: "comment", ref: "local-9", body: { type: "doc", version: 1, content: [] }, client: "c9" },
  ];
  const file = new File(["abc"], "a.png");
  expect((await applyOps("K-NEW9", create)).error).toBe("Could not reach Jira.");
  expect((await applyOps("K-1", comment)).error).toBe("Could not reach Jira.");
  expect(await uploadAttachment("K-1", file, "f9").catch(() => "lost")).toBe("lost");
  lose = false;
  // The replays find each one in Jira.
  expect((await applyOps("K-NEW9", create)).created["K-NEW9"]).toBe("K-30");
  expect((await applyOps("K-1", comment)).created["local-9"]).toBe("500");
  expect(await uploadAttachment("K-1", file, "f9")).toEqual({ id: "900", found: true });
  expect([issues.length, comments.length, attachments.length]).toEqual([1, 1, 1]);
  // A comment whose send never reached Jira is sent.
  expect(
    (await applyOps("K-1", [{ ...comment[0]!, ref: "local-10", client: "c10" } as Op])).created[
      "local-10"
    ],
  ).toBe("501");
});

test("sync review 5: a replayed create sends the fields edited since its first send, and the job's later steps", async () => {
  answer = jiraAnswers;
  // The first send made K-15; its answer was lost, the user edited the new issue, then reloaded.
  ledger.intend("K-NEW5@t", { summary: "S", project: { key: "K" }, issuetype: { name: "Task" } });
  ledger.remember("K-NEW5@t", "K-15");
  calls.length = 0;
  const bodies: Record<string, unknown> = {};
  answer = (path, init) => {
    if (init?.method === "PUT") bodies[path] = JSON.parse(String(init.body));
    if (path.startsWith("/rest/api/3/issue/K-15?fields=summary"))
      return { fields: { summary: "S", priority: null } };
    return jiraAnswers(path, init);
  };
  const result = await applyOps("K-NEW5", [
    {
      op: "create",
      fields: { summary: "Edited", project: "K", priority: "High", status: "3" },
      client: "K-NEW5@t",
    },
    { op: "watcher", id: "acc-2", add: true },
  ]);
  expect([result.key, result.error]).toEqual(["K-15", undefined]);
  expect(calls.filter((c) => c === "POST /rest/api/3/issue")).toEqual([]);
  expect(bodies["/rest/api/3/issue/K-15"]).toEqual({
    fields: { summary: "Edited", priority: { name: "High" } },
  });
  expect(calls).toContain("POST /rest/api/3/issue/K-15/transitions");
  expect(calls).toContain("POST /rest/api/3/issue/K-15/watchers");
});

const doc = (text: string) => ({
  type: "doc" as const,
  version: 1 as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

test("sync review 2-1: a lost upload is matched only to a new file no other upload owns, and marked found", async () => {
  const { uploadAttachment } = await import("./jira-writes");
  const file = new File(["abc"], "b.png");
  const mine = (id: string, created: string) => ({
    id,
    filename: "b.png",
    size: 3,
    created,
    author: { accountId: "me" },
  });
  // The user's own Jira upload of a file with the same name and size, made before.
  const attachments: any[] = [mine("800", "2026-11-10T10:00:00.000Z")];
  let lose = false;
  answer = (path) => {
    if (path === "/rest/api/3/issue/K-2/attachments") {
      attachments.push(mine(String(901 + attachments.length - 1), new Date().toISOString()));
      if (lose) throw new TypeError("socket closed");
      return [attachments.at(-1)];
    }
    if (path === "/rest/api/3/issue/K-2?fields=attachment")
      return { fields: { attachment: [...attachments] } };
    if (path === "/rest/api/3/myself") return { accountId: "me" };
    return {};
  };
  // f20's answer is lost (901); f21, sent meanwhile, gets its answer (902).
  lose = true;
  await uploadAttachment("K-2", file, "f20").catch(() => {});
  lose = false;
  expect(await uploadAttachment("K-2", file, "f21")).toEqual({ id: "902", found: false });
  // f21 was sent while f20's was in flight, so Jira may list its file first.
  attachments.find((a) => a.id === "902").created = "2026-11-10T10:30:00.000Z";
  attachments.find((a) => a.id === "901").created = "2026-11-10T10:31:00.000Z";
  // f20's replay: not 800 (there before it), not 902 (f21's): 901, marked found.
  expect(await uploadAttachment("K-2", file, "f20")).toEqual({ id: "901", found: true });
  expect(ledger.made("upload:f20")).toMatchObject({ key: "901", found: true });
  expect(attachments.map((a) => a.id)).toEqual(["800", "901", "902"]);
});

test("sync review 2-2: an issue search can't find yet doesn't authorize a second create until the intent is old", async () => {
  const issues: any[] = [];
  let indexed = false,
    lose = true;
  answer = (path, init) => {
    if (path === "/rest/api/3/issue" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      issues.push({
        key: `K-${60 + issues.length}`,
        properties: { "better-jira": body.properties[0].value },
      });
      if (lose) throw new TypeError("socket closed");
      return { key: issues.at(-1).key };
    }
    // Jira's index is behind: the new issue isn't in search yet.
    if (path === "/rest/api/3/search/jql") return { issues: indexed ? issues : [] };
    return jiraAnswers(path, init);
  };
  const create = (client: string): Op[] => [
    { op: "create", fields: { summary: "S", project: "K" }, client },
  ];
  const start = Date.now();
  try {
    expect((await applyOps("K-NEW20", create("K-NEW20@t"))).error).toBe("Could not reach Jira.");
    lose = false;
    // Minutes later, still not in search: retry later, don't create.
    setSystemTime(start + 4 * 60_000);
    const early = await applyOps("K-NEW20", create("K-NEW20@t"));
    expect([early.retry, issues.length]).toEqual([true, 1]);
    // Once search shows it, the replay finds it.
    indexed = true;
    expect((await applyOps("K-NEW20", create("K-NEW20@t"))).created["K-NEW20"]).toBe("K-60");
    // An intent search never shows past the bound was never made: it is sent again.
    indexed = false;
    lose = true;
    setSystemTime(start);
    await applyOps("K-NEW21", create("K-NEW21@t"));
    lose = false;
    setSystemTime(start + 6 * 60_000);
    expect((await applyOps("K-NEW21", create("K-NEW21@t"))).created["K-NEW21"]).toBe("K-62");
  } finally {
    setSystemTime();
  }
});

test("sync review 2-4: a replayed create sends only the fields edited here and unchanged in Jira; a refusal doesn't stop the job", async () => {
  // Sent at create: summary S, description "Old", priority Low. Since then Jira's description and priority changed.
  ledger.intend("K-NEW30@t", {
    summary: "S",
    description: doc("Old"),
    priority: { name: "Low" },
    assignee: { accountId: "acc-1" },
    project: { key: "K" },
    issuetype: { name: "Task" },
  });
  ledger.remember("K-NEW30@t", "K-30");
  let refuse = false;
  const puts: unknown[] = [];
  answer = (path, init) => {
    if (init?.method === "PUT" && path === "/rest/api/3/issue/K-30") {
      puts.push(JSON.parse(String(init.body)));
      if (refuse) {
        const { JiraError } = require("./jira");
        throw Object.assign(new JiraError("PUT", path, 400, "{}"), { status: 400, reason: "no" });
      }
      return {};
    }
    if (path.startsWith("/rest/api/3/issue/K-30?fields="))
      return {
        fields: {
          summary: "S",
          description: doc("Theirs"),
          priority: { name: "High" },
          assignee: { accountId: "acc-1" },
        },
      };
    return jiraAnswers(path, init);
  };
  // Here: summary and description edited, priority edited, assignee cleared.
  const ops = (): Op[] => [
    {
      op: "create",
      fields: {
        summary: "Mine",
        description: doc("Mine"),
        priority: "Medium",
        assignee: null,
        project: "K",
      },
      client: "K-NEW30@t",
    },
    { op: "watcher", id: "acc-3", add: true },
  ];
  calls.length = 0;
  expect((await applyOps("K-NEW30", ops())).error).toBe(undefined);
  expect(puts).toEqual([{ fields: { summary: "Mine" } }]);
  refuse = true;
  calls.length = 0;
  const refused = await applyOps("K-NEW30", ops());
  expect(refused.error).toContain("Jira didn't take the edits made to K-30");
  expect(calls).toContain("POST /rest/api/3/issue/K-30/watchers");
});

test("sync review 2-6: reconciliation reads every page of comments and of search results", async () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));
  let posted = 0;
  answer = (path, init) => {
    if (path === "/rest/api/3/issue/K-3/comment" && init?.method === "POST") {
      posted++;
      throw new TypeError("socket closed");
    }
    const page = path.match(/K-3\/comment\?.*startAt=(\d+)/);
    if (page) {
      // 150 newer comments; the tagged one is on the second page.
      const all = [
        ...filler(150),
        { id: "777", properties: [{ key: "better-jira", value: { client: "c40" } }] },
      ];
      const startAt = Number(page[1]);
      return { comments: all.slice(startAt, startAt + 100), total: all.length, startAt };
    }
    if (path === "/rest/api/3/issue" && init?.method === "POST") {
      posted++;
      throw new TypeError("socket closed");
    }
    if (path === "/rest/api/3/search/jql") {
      const token = JSON.parse(String(init!.body)).nextPageToken;
      return token
        ? { issues: [{ key: "K-77", properties: { "better-jira": { client: "K-NEW40@t" } } }] }
        : { issues: filler(100).map((i) => ({ key: `K-${i.id}` })), nextPageToken: "2" };
    }
    return jiraAnswers(path, init);
  };
  const comment: Op[] = [{ op: "comment", ref: "local-40", body: doc("x"), client: "c40" }];
  const create: Op[] = [
    { op: "create", fields: { summary: "S", project: "K" }, client: "K-NEW40@t" },
  ];
  await applyOps("K-3", comment);
  await applyOps("K-NEW40", create);
  expect((await applyOps("K-3", comment)).created["local-40"]).toBe("777");
  expect((await applyOps("K-NEW40", create)).created["K-NEW40"]).toBe("K-77");
  expect(posted).toBe(2);
});
