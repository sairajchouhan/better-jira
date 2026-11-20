import { expect, jest, mock, setSystemTime, test } from "bun:test";

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
// Jira's copy of the issue, read after the write.
let refreshing = (..._args: unknown[]): Promise<any> => turn(() => undefined);
// Where the mirror last saw each issue in its workflow.
let places: Record<string, { project: string; type: string; status: string }> = {};
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
  refresh: (...args: unknown[]) => refreshing(...args),
  workflowPlace: (key: string) => places[key],
  ledger,
}));
const { applyOps, SETTLE_WAIT } = await import("./jira-writes");
import { DESCRIPTION_CONFLICT, type Op } from "@/shared/jira-ops";

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
  if (path.includes("?fields=status"))
    return {
      fields: {
        status: { id: moved.has(path.split("/")[5]!.split("?")[0]!) ? "3" : "1" },
        project: { id: "10" },
        issuetype: { id: path.includes("K-3") ? "7" : "3" },
      },
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
  const { opsFor } = await import("@/shared/jira-ops");
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
  const issue = { key: "K-1", boards: [1], status: "1", labels: [] } as any;
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
  expect((await applyOps("K-NEW9", create)).error).toBe(
    "Jira didn't answer. The change will be sent again shortly.",
  );
  expect((await applyOps("K-1", comment)).error).toBe(
    "Jira didn't answer. The change will be sent again shortly.",
  );
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

test("a cleared priority never reaches Jira for a saved issue, which refuses it (R3 G10)", async () => {
  answer = jiraAnswers;
  calls.length = 0;
  const result = await applyOps("K-60", [{ op: "fields", fields: { priority: null } }]);
  expect(result.error).toContain("priority");
  expect(calls.filter((c) => c.startsWith("PUT"))).toEqual([]);
  // A replayed create whose priority was cleared since keeps Jira's, and still sends the other edits.
  ledger.intend("K-NEW6@t", { summary: "S", priority: { name: "High" }, project: { key: "K" }, issuetype: { name: "Task" } });
  ledger.remember("K-NEW6@t", "K-16");
  const bodies: Record<string, unknown> = {};
  answer = (path, init) => {
    if (init?.method === "PUT") bodies[path] = JSON.parse(String(init.body));
    if (path.startsWith("/rest/api/3/issue/K-16?fields="))
      return { fields: { summary: "S", priority: { name: "High" } } };
    return jiraAnswers(path, init);
  };
  await applyOps("K-NEW6", [
    { op: "create", fields: { summary: "Edited", project: "K", priority: null }, client: "K-NEW6@t" },
  ]);
  expect(bodies["/rest/api/3/issue/K-16"]).toEqual({ fields: { summary: "Edited" } });
});

test("BJ-352: a refused write whose read of Jira's copy fails names the issue for the tab to read again, as a slow read does", async () => {
  answer = jiraAnswers;
  refreshing = () => turn(() => Promise.reject(new Error("Jira rate limit")));
  try {
    const result = await applyOps("K-61", [{ op: "fields", fields: { priority: null } }]);
    expect(result.error).toContain("priority");
    expect(result).not.toHaveProperty("issue");
    expect(result.unsettled).toEqual(["K-61"]);
  } finally {
    refreshing = () => turn(() => undefined);
  }
});

test.failing("a status change answers once Jira has the transition, which goes alone from a status Jira listed transitions for before", async () => {
  const { JiraError } = await import("./jira");
  places = Object.fromEntries(
    ["K-30", "K-31", "K-32", "K-33", "K-34"].map((key) => [key, { project: "10", type: "7", status: "1" }]),
  );
  let refused = false;
  answer = (path, init) => {
    if (path === "/rest/api/3/issue/K-33/transitions" && init?.method === "POST" && !refused) {
      refused = true;
      throw Object.assign(new JiraError("POST", path, 400, "{}"), { status: 400, reason: "not valid" });
    }
    return jiraAnswers(path, init);
  };
  let reads = 0;
  refreshing = () => (reads++, new Promise(() => {}));
  const status = (key: string, to = "3") => applyOps(key, [{ op: "status", status: to }], 1);
  try {
    // The first change from a status reads where Jira has the issue and its transitions from there; the answer doesn't
    // wait for Jira's copy, which the tab reads again.
    calls.length = 0;
    expect(await status("K-30")).toEqual({ key: "K-30", created: {}, others: [], unsettled: ["K-30"] });
    expect(calls).toEqual([
      "GET /rest/api/3/issue/K-30?fields=status,project,issuetype",
      "GET /rest/api/3/issue/K-30/transitions",
      "POST /rest/api/3/issue/K-30/transitions",
    ]);
    expect(reads).toBe(0);
    // Another issue in that workflow and status: the transition alone, as Jira's own page sends it.
    calls.length = 0;
    expect((await status("K-31")).unsettled).toEqual(["K-31"]);
    expect(calls).toEqual(["POST /rest/api/3/issue/K-31/transitions"]);
    // A resend (an earlier send's answer was lost) reads first: Jira has it there already, so nothing is sent.
    calls.length = 0;
    await applyOps("K-31", [{ op: "status", status: "3" }], 1, true, true);
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    // Jira refuses a transition it listed before (its workflow changed): the change reads the transitions again and goes.
    calls.length = 0;
    expect((await status("K-33")).error).toBe(undefined);
    expect(calls).toEqual([
      "POST /rest/api/3/issue/K-33/transitions",
      "GET /rest/api/3/issue/K-33?fields=status,project,issuetype",
      "GET /rest/api/3/issue/K-33/transitions",
      "POST /rest/api/3/issue/K-33/transitions",
    ]);
    // A change Jira has no transition for is refused, and waits for Jira's copy to roll back to.
    refreshing = () => turn(() => ({ issue: { key: "K-34", status: "1" }, full: null }));
    const refusal = await applyOps("K-34", [{ op: "status", status: "9" }], 1);
    expect(refusal.error).toContain("no transition");
    expect(refusal.issue).toEqual({ key: "K-34", status: "1" });
  } finally {
    places = {};
    refreshing = () => turn(() => undefined);
  }
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
  expect(await uploadAttachment("K-2", file, "f21")).toMatchObject({ id: "902", found: false });
  // f21 was sent while f20's was in flight, so Jira may list its file first.
  attachments.find((a) => a.id === "902").created = "2026-11-10T10:30:00.000Z";
  attachments.find((a) => a.id === "901").created = "2026-11-10T10:31:00.000Z";
  // f20's replay: not 800 (there before it), not 902 (f21's): 901, marked found.
  expect(await uploadAttachment("K-2", file, "f20")).toEqual({ id: "901", found: true });
  expect(ledger.made("upload:f20")).toMatchObject({ key: "901", found: true });
  expect(attachments.map((a) => a.id)).toEqual(["800", "901", "902"]);
});

test("an upload answers with Jira's attachment and the issue's id from the read before the send: no read after it (BJ-233)", async () => {
  const { uploadAttachment } = await import("./jira-writes");
  answer = (path) => {
    if (path === "/rest/api/3/issue/K-3/attachments")
      return [{ id: 950, filename: "c.txt", mimeType: "text/plain", size: 4 }];
    if (path === "/rest/api/3/issue/K-3?fields=attachment") return { id: "10042", fields: { attachment: [] } };
    return {};
  };
  calls.length = 0;
  expect(await uploadAttachment("K-3", new File(["abcd"], "c.txt"), "f30")).toEqual({
    id: "950",
    found: false,
    attachment: { id: 950, filename: "c.txt", mimeType: "text/plain", size: 4 },
    issueId: "10042",
  });
  expect(calls).toEqual(["GET /rest/api/3/issue/K-3?fields=attachment", "POST /rest/api/3/issue/K-3/attachments"]);
  // A replay of an upload Jira already has names neither: the route reads the issue for them.
  calls.length = 0;
  answer = (path) =>
    path === "/rest/api/3/issue/K-3?fields=attachment" ? { id: "10042", fields: { attachment: [{ id: 950 }] } } : {};
  expect(await uploadAttachment("K-3", new File(["abcd"], "c.txt"), "f30")).toEqual({ id: "950", found: false });
});

test("an upload Jira may have taken (no answer in time, a server error, a cut connection) answers retry; one Jira refused says why", async () => {
  const { uploadAttachment, uploadFailure } = await import("./jira-writes");
  const { JiraError } = await import("./jira");
  const jiraSays = (status: number, reason: string) =>
    Object.assign(new JiraError("POST", "/rest/api/3/issue/K-5/attachments", status, ""), { status, reason });
  const failed = async (error: unknown, client: string) => {
    answer = (path) => {
      if (path === "/rest/api/3/issue/K-5/attachments") throw error;
      return { id: "10050", fields: { attachment: [] } };
    };
    return uploadFailure(await uploadAttachment("K-5", new File(["abcd"], "e.txt"), client).catch((e) => e));
  };
  const retry = { error: "Jira didn't answer.", retry: true } as const;
  expect(await failed(new Error("Jira POST /rest/api/3/issue/K-5/attachments didn't answer within 120s."), "f50")).toEqual(retry);
  expect(await failed(jiraSays(502, "Bad gateway"), "f51")).toEqual(retry);
  expect(await failed(new TypeError("socket closed"), "f52")).toEqual(retry);
  expect(await failed(jiraSays(413, "The file is too large for Jira."), "f53")).toEqual({
    error: "The file is too large for Jira.",
  });
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
    expect((await applyOps("K-NEW20", create("K-NEW20@t"))).error).toBe(
      "Jira didn't answer. The change will be sent again shortly.",
    );
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
  // Jira's changed description and priority stay; the summary edit and the clear (Jira still has acc-1) go. The
  // description edit comes back as a conflict, to be kept beside Jira's (BJ-20).
  expect((await applyOps("K-NEW30", ops())).error).toContain(DESCRIPTION_CONFLICT);
  expect(puts).toEqual([{ fields: { summary: "Mine", assignee: null } }]);
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

test("sync review 3-1: a create or comment whose answer is lost, or whose reconciling read fails, is sent again, not refused", async () => {
  const { JiraError } = await import("./jira");
  const gateway = (path: string) =>
    Object.assign(new JiraError("POST", path, 502, "Bad gateway"), {
      status: 502,
      reason: "Bad gateway",
    });
  let issues = 0,
    comments = 0,
    searchDown = false;
  answer = (path, init) => {
    if (path === "/rest/api/3/issue" && init?.method === "POST") {
      issues++;
      throw gateway(path); // Jira made it; the gateway lost the answer.
    }
    if (path === "/rest/api/3/issue/K-5/comment" && init?.method === "POST") {
      comments++;
      throw new TypeError("socket reset");
    }
    if (path === "/rest/api/3/search/jql") {
      if (searchDown) throw gateway(path);
      return { issues: [{ key: "K-70", properties: { "better-jira": { client: "K-NEW50@t" } } }] };
    }
    if (path.startsWith("/rest/api/3/issue/K-5/comment?"))
      return {
        comments: [{ id: "55", properties: [{ key: "better-jira", value: { client: "c50" } }] }],
        total: 1,
      };
    return jiraAnswers(path, init);
  };
  const create: Op[] = [
    { op: "create", fields: { summary: "S", project: "K" }, client: "K-NEW50@t" },
  ];
  const comment: Op[] = [{ op: "comment", ref: "local-50", body: doc("x"), client: "c50" }];
  for (const [key, ops] of [
    ["K-NEW50", create],
    ["K-5", comment],
  ] as const) {
    const lost = await applyOps(key, [...ops]);
    expect([lost.retry, lost.created]).toEqual([true, {}]);
  }
  // A failing search while reconciling is no refusal either.
  searchDown = true;
  expect((await applyOps("K-NEW50", create)).retry).toBe(true);
  searchDown = false;
  // The same job resent: reconciled, never posted again.
  expect((await applyOps("K-NEW50", create)).created).toEqual({ "K-NEW50": "K-70" });
  expect((await applyOps("K-5", comment)).created).toEqual({ "local-50": "55" });
  expect([issues, comments]).toEqual([1, 1]);
});

test("sync review 3-3: a replay sends labels and fix versions added since, and clears made since", async () => {
  // Sent without labels or fix versions (empty), with an assignee and a due date.
  ledger.intend("K-NEW31@t", {
    summary: "S",
    assignee: { accountId: "acc-1" },
    duedate: "2026-12-01",
    project: { key: "K" },
    issuetype: { name: "Task" },
  });
  ledger.remember("K-NEW31@t", "K-31");
  const puts: unknown[] = [];
  answer = (path, init) => {
    if (init?.method === "PUT" && path === "/rest/api/3/issue/K-31")
      return void puts.push(JSON.parse(String(init.body)));
    // Jira spells no labels or fix versions [].
    if (path.startsWith("/rest/api/3/issue/K-31?fields="))
      return {
        fields: {
          summary: "S",
          labels: [],
          fixVersions: [],
          assignee: { accountId: "acc-1" },
          duedate: "2026-12-01",
        },
      };
    return jiraAnswers(path, init);
  };
  // Here since: a label and a fix version added, the assignee and due date cleared.
  await applyOps("K-NEW31", [
    {
      op: "create",
      fields: {
        summary: "S",
        labels: ["x"],
        milestones: ["10"],
        assignee: null,
        due: null,
        project: "K",
      },
      client: "K-NEW31@t",
    },
  ]);
  expect(puts).toEqual([
    { fields: { labels: ["x"], fixVersions: [{ id: "10" }], assignee: null, duedate: null } },
  ]);
});

test("sync review 3-4: a replay compares descriptions by structure: Jira's image stays, a formatting edit goes", async () => {
  const image = {
    ...doc("Old"),
    content: [
      ...doc("Old").content,
      { type: "mediaSingle", content: [{ type: "media", attrs: { id: "m1", type: "file" } }] },
    ],
  };
  const bold = {
    ...doc(""),
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Old", marks: [{ type: "strong" }] }] },
    ],
  };
  const replay = async (client: string, key: string, jiraHas: unknown, mine: any) => {
    ledger.intend(client, {
      summary: "S",
      description: doc("Old"),
      project: { key: "K" },
      issuetype: { name: "Task" },
    });
    ledger.remember(client, key);
    const puts: unknown[] = [];
    answer = (path, init) => {
      if (init?.method === "PUT" && path === `/rest/api/3/issue/${key}`)
        return void puts.push(JSON.parse(String(init.body)));
      // Jira adds ids of its own to what it stores.
      if (path.startsWith(`/rest/api/3/issue/${key}?fields=`))
        return { fields: { description: jiraHas } };
      return jiraAnswers(path, init);
    };
    await applyOps(client.split("@")[0]!, [
      { op: "create", fields: { summary: "S", description: mine, project: "K" }, client },
    ]);
    return puts;
  };
  // Someone added an image in Jira; the text alone still reads "Old": the edit here must not remove it.
  expect(await replay("K-NEW32@t", "K-32", image, doc("Mine"))).toEqual([]);
  // A formatting-only edit here, with Jira's copy unchanged but for its own ids: sent.
  const stored = {
    ...doc("Old"),
    content: [{ ...doc("Old").content[0], attrs: { localId: "abc" } }],
  };
  expect(await replay("K-NEW33@t", "K-33", stored, bold)).toEqual([
    { fields: { description: bold } },
  ]);
});

test("BJ-20: a replayed create whose description Jira rewrote past recognising keeps the edit and reports the conflict", async () => {
  ledger.intend("K-NEW34@t", {
    summary: "S",
    description: doc("Old"),
    project: { key: "K" },
    issuetype: { name: "Task" },
  });
  ledger.remember("K-NEW34@t", "K-34");
  // Jira stores "Old" split into two text nodes: the same words, a shape the replay can't match to what it sent.
  const rewritten = {
    ...doc(""),
    content: [{ type: "paragraph", content: [{ type: "text", text: "Ol" }, { type: "text", text: "d" }] }],
  };
  const puts: unknown[] = [];
  answer = (path, init) => {
    if (init?.method === "PUT" && path === "/rest/api/3/issue/K-34")
      return void puts.push(JSON.parse(String(init.body)));
    if (path.startsWith("/rest/api/3/issue/K-34?fields=")) return { fields: { summary: "S", description: rewritten } };
    return jiraAnswers(path, init);
  };
  const result = await applyOps("K-NEW34", [
    { op: "create", fields: { summary: "Mine", description: doc("Mine"), project: "K" }, client: "K-NEW34@t" },
  ]);
  // The other edits go; the description isn't written over Jira's, and the answer says so instead of dropping it.
  expect(puts).toEqual([{ fields: { summary: "Mine" } }]);
  expect(result.created).toEqual({ "K-NEW34": "K-34" });
  expect(result.error).toContain(DESCRIPTION_CONFLICT);
});

test("BJ-15: removing a Jira link kind Linear lacks deletes that type's link from this issue's end, never a Relates link", async () => {
  const issuelinks = [
    { id: "501", type: { name: "Relates" }, inwardIssue: { key: "K-2" } },
    { id: "502", type: { name: "Problem/Incident" }, outwardIssue: { key: "K-2" } },
    { id: "503", type: { name: "Problem/Incident" }, inwardIssue: { key: "K-2" } },
  ];
  answer = (path) =>
    path === "/rest/api/3/issueLinkType"
      ? {
          issueLinkTypes: [
            { name: "Relates", inward: "relates to", outward: "relates to" },
            { name: "Problem/Incident", inward: "is caused by", outward: "causes" },
          ],
        }
      : path.endsWith("?fields=issuelinks")
        ? { fields: { issuelinks } }
        : {};
  calls.length = 0;
  // K-1 "is caused by" K-2: Jira lists K-2 as the link's inward issue on K-1.
  await applyOps("K-1", [{ op: "link", target: "K-2", kind: "inward:Problem/Incident", remove: true }]);
  expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /rest/api/3/issueLink/503"]);
  calls.length = 0;
  await applyOps("K-1", [{ op: "link", target: "K-2", kind: "outward:Problem/Incident", remove: true }]);
  expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /rest/api/3/issueLink/502"]);
  // A site without that link type refuses it rather than touching another type's link.
  calls.length = 0;
  const result = await applyOps("K-1", [{ op: "link", target: "K-2", kind: "inward:Cloners", remove: true }]);
  expect(result.error).toContain("no link type");
  expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual([]);
});

test("#2: a description with an issue chip saves whichever build made its base; only another text conflicts", async () => {
  const chip = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "see " },
          { type: "inlineCard", attrs: { url: "https://site.atlassian.net/browse/K-1" } },
        ],
      },
    ],
  };
  let puts = 0;
  answer = (path, init) => {
    if (init?.method === "PUT") return void puts++;
    if (path.endsWith("?fields=description")) return { fields: { description: chip } };
    return {};
  };
  const edit = (descriptionBase: string) =>
    applyOps("K-50", [{ op: "fields", fields: { description: doc("mine"), descriptionBase } }]);
  // This build's base (the chip's URL), the chip text BJ-199 builds sent, and the older URL-only form all match Jira's text.
  for (const base of ["see https://site.atlassian.net/browse/K-1", "see K-1", "see  https://site.atlassian.net/browse/K-1 "])
    expect((await edit(base)).error).toBe(undefined);
  expect(puts).toBe(3);
  // Someone else's edit still conflicts.
  expect((await edit("see K-2")).error).toContain(DESCRIPTION_CONFLICT);
  expect(puts).toBe(3);
});

test("R3-palette-shortcuts-D7: a write Jira has answers within the settle wait, naming the issue its slow copy read leaves unsettled", async () => {
  answer = () => ({});
  let read: ((copy: any) => void) | undefined;
  refreshing = () => new Promise((resolve) => (read = resolve));
  jest.useFakeTimers();
  try {
    let written: Awaited<ReturnType<typeof applyOps>> | undefined;
    const write = applyOps("K-7", [{ op: "fields", fields: { priority: "High" } }], 1).then((w) => (written = w));
    // Jira's own calls take their (fake) turns until the write reads Jira's copy.
    for (let i = 0; i < 1000; i++) {
      if (read) break;
      jest.advanceTimersByTime(5);
      await Promise.resolve();
    }
    jest.advanceTimersByTime(SETTLE_WAIT);
    await write;
    expect(written).toEqual({ key: "K-7", created: {}, others: [], unsettled: ["K-7"] });
    // The read the tab sends again (no ops) waits for Jira's copy.
    const reread = applyOps("K-7", [], 1).then((w) => (written = w));
    jest.advanceTimersByTime(SETTLE_WAIT * 2);
    read!({ issue: { key: "K-7" }, full: null });
    await reread;
    expect(written!.issue).toEqual({ key: "K-7" });
  } finally {
    jest.useRealTimers();
    refreshing = () => turn(() => undefined);
  }
});

test("BJ-270: a title past Jira's 255 characters is refused before any write, in Linear's wording, for an edit and a create", async () => {
  answer = jiraAnswers;
  calls.length = 0;
  const long = "x".repeat(256);
  const edit = await applyOps("K-61", [{ op: "fields", fields: { summary: long } }]);
  expect(edit.error).toBe("Title cannot be longer than 255 characters.");
  const create = await applyOps("K-NEW61", [{ op: "create", fields: { summary: long, project: "K" } }]);
  expect(create.error).toBe("Title cannot be longer than 255 characters.");
  expect(calls.filter((c) => !c.startsWith("GET"))).toEqual([]);
  // At the limit it goes.
  const fits = await applyOps("K-61", [{ op: "fields", fields: { summary: "x".repeat(255) } }]);
  expect(fits.error).toBeUndefined();
});

test("Ship should-fix: a create with no type, or under an epic, takes the project's own standard type, never a Task it lacks", async () => {
  const created: any[] = [];
  answer = (path, init) => {
    if (path.includes("/issue/createmeta/STORY/issuetypes"))
      return { issueTypes: [{ name: "Epic", hierarchyLevel: 1 }, { name: "Story", hierarchyLevel: 0 }, { name: "Sub-task", hierarchyLevel: -1, subtask: true }] };
    if (path.endsWith("?fields=issuetype")) return { fields: { issuetype: { name: "Epic", hierarchyLevel: 1 } } };
    if (path === "/rest/api/3/issue" && init?.method === "POST") {
      created.push(JSON.parse(String(init.body)).fields.issuetype);
      return { key: `STORY-${created.length}` };
    }
    return jiraAnswers(path, init);
  };
  await applyOps("STORY-NEW1", [{ op: "create", fields: { summary: "No type", project: "STORY" } }]);
  await applyOps("STORY-NEW2", [{ op: "create", fields: { summary: "In an epic", project: "STORY", parent: "STORY-9" } }]);
  expect(created).toEqual([{ name: "Story" }, { name: "Story" }]);
});

test("BJ-341: the board a tab sends places only a new issue; an edit to an issue no board holds leaves it on none", async () => {
  answer = jiraAnswers;
  const boards: unknown[] = [];
  refreshing = (_key, board) => (boards.push(board), turn(() => undefined));
  await applyOps("OTHER-1", [{ op: "fields", fields: { summary: "Renamed" } }], 3);
  await applyOps("K-NEW9", [{ op: "create", fields: { summary: "S", project: "K" }, client: "K-NEW9@t" }], 3);
  expect(boards).toEqual([undefined, 3]);
  refreshing = () => turn(() => undefined);
});

test("every issue is an issue: a sub-task type named under an epic takes the project's default, whatever Jira calls sub-tasks", async () => {
  const sent: any[] = [];
  calls.length = 0;
  answer = (path, init) => {
    if (path.includes("/createmeta/"))
      return {
        issueTypes: [
          { name: "Bug", hierarchyLevel: 0 },
          { name: "Task", hierarchyLevel: 0 },
          { name: "Sub-task", hierarchyLevel: -1, subtask: true },
        ],
      };
    if (path.endsWith("?fields=issuetype")) return { fields: { issuetype: { name: "Epic", hierarchyLevel: 1 } } };
    if (path === "/rest/api/3/issue" && init?.method === "POST") {
      sent.push(JSON.parse(String(init.body)).fields.issuetype.name);
      return { key: `K-${200 + sent.length}` };
    }
    return {};
  };
  await applyOps("K-TYPE1", [
    { op: "create", fields: { summary: "S", project: "K", type: "Sub-task", parent: "K-9" }, client: "K-TYPE1@t" },
  ]);
  await applyOps("K-TYPE2", [
    { op: "create", fields: { summary: "S", project: "K", type: "Bug", parent: "K-9" }, client: "K-TYPE2@t" },
  ]);
  expect(sent).toEqual(["Task", "Bug"]);
});

test("deleting an issue names the sub-issues Jira deleted with it, so the tab drops them too", async () => {
  calls.length = 0;
  answer = (path) => (path.endsWith("?fields=subtasks") ? { fields: { subtasks: [{ key: "K-81" }, { key: "K-82" }] } } : {});
  // Jira has neither the issue nor its sub-issues once the delete lands.
  refreshing = () => turn(() => null);
  const result = await applyOps("K-80", [{ op: "delete" }]);
  expect(calls).toContain("DELETE /rest/api/3/issue/K-80?deleteSubtasks=true");
  expect(result).toMatchObject({ issue: null, others: [], gone: ["K-81", "K-82"] });
  expect(result.unsettled).toBe(undefined);
  refreshing = () => turn(() => undefined);
});
