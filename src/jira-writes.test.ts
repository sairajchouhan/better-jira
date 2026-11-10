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
const created = new Map<string, string>();
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
  madeFor: (client: string) => created.get(client),
  rememberMade: (client: string, key: string) => created.set(client, key),
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

const jiraAnswers = (path: string, init?: RequestInit) =>
  path === "/rest/api/3/issue" && init?.method === "POST"
    ? { key: `K-${calls.filter((c) => c === "POST /rest/api/3/issue").length + 10}` }
    : path.endsWith("?fields=status")
      ? { fields: { status: { id: "1" } } }
      : path.endsWith("/transitions") && !init?.method
        ? { transitions: [{ id: "31", to: { id: "3" } }] }
        : path === "/rest/api/3/issueLinkType"
          ? { issueLinkTypes: [{ name: "Blocks", inward: "is blocked by", outward: "blocks" }] }
          : {};

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
  created.clear();
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
