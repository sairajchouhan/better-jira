import { expect, mock, test } from "bun:test";

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
  expect(await uploadAttachment("K-1", file, "f9")).toBe("900");
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
  ledger.remember("K-NEW5@t", "K-15");
  calls.length = 0;
  const bodies: Record<string, unknown> = {};
  answer = (path, init) => {
    if (init?.method === "PUT") bodies[path] = JSON.parse(String(init.body));
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
