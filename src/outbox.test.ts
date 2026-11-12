import { expect, test } from "bun:test";
import { createOutbox, type Answer, type OutboxPorts } from "./outbox";
import { DESCRIPTION_CONFLICT, type Side } from "./jira-ops";
import type { LocalChange } from "./local-data";
import type { Issue } from "./store";

const issue = (key: string, extra: Partial<Issue> = {}): Issue => ({
  key,
  board: 1,
  summary: key,
  status: "todo",
  priority: "Low",
  assignee: null,
  labels: [],
  comments: 0,
  updated: "",
  resolved: null,
  ...extra,
});
const edit = (base: Issue, patch: Partial<Issue>): [string, Side, Side] => [
  base.key,
  { issue: base },
  { issue: { ...base, ...patch } },
];

/** The outbox over fakes: a server that records each write, a clock that moves only when told, and tabs as given. */
function harness({
  reply = () => ({}),
  prepare = async (_key, ops) => ops,
  tabs = {},
}: {
  reply?: (key: string, body: any) => object | Response | Promise<object | Response>;
  prepare?: OutboxPorts["prepare"];
  tabs?: Partial<OutboxPorts["tabs"]>;
} = {}) {
  let now = 0,
    ids = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sent: { key: string; at: number; ops: any[]; settle?: boolean; resend?: boolean }[] = [],
    answers: Answer[] = [],
    log: string[] = [];
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const outbox = createOutbox(
    {
      post: async (key, body: any) => {
        sent.push({ key, at: now, ...body });
        const answer = await reply(key, body);
        return answer instanceof Response
          ? answer
          : Response.json({ key, created: {}, others: [], ...answer });
      },
      prepare,
      clock: {
        now: () => now,
        setTimeout: (fn, ms) => (timers.set(++ids, { at: now + Math.max(0, ms), fn }), ids),
        clearTimeout: (id) => void timers.delete(id as number),
      },
      tabs: {
        id: "this-tab",
        stored: async () => undefined,
        save: async () => {},
        claim: async () => ({ claimed: new Set(), changes: [] }),
        ...tabs,
      },
    },
    {
      pending: (count) => log.push(`pending ${count}`),
      status: (text) => log.push(`status ${text}`),
      retrying: (key, text, shown) => log.push(`retrying ${key} ${text}${shown ? " (shown)" : ""}`),
      uploadsOnly: (key) => log.push(`uploadsOnly ${key}`),
      answered: (answer) => answers.push(answer),
      moved: (from, to) => log.push(`moved ${from} → ${to}`),
      discarded: (key) => log.push(`discarded ${key}`),
      takeOver: (change) => takeOver(change),
    },
  );
  let takeOver = (_change: LocalChange) => {};
  const issues = new Map<string, Issue>();
  return {
    outbox,
    sent,
    answers,
    log,
    issues,
    onTakeOver: (fn: (change: LocalChange) => void) => (takeOver = fn),
    send(...changes: [string, Side, Side][]) {
      const idle = outbox.queue(changes, issues);
      outbox.flush();
      return idle;
    },
    /** Moves the clock on by `ms`, firing each timer that falls due on the way, in order. */
    async advance(ms: number) {
      const end = now + ms;
      await settle();
      for (;;) {
        const due = [...timers]
          .filter(([, t]) => t.at <= end)
          .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}
/** A promise and its resolver: holds a reply until the test lets it go. */
const gate = () => {
  let open!: () => void;
  return { held: new Promise<void>((resolve) => (open = resolve)), open: () => open() };
};

test("a write Jira can't settle yet backs off 5 s, 10 s, 20 s… behind other issues' writes, keeps its issue's order, and shows after 4 tries", async () => {
  let jiraDown = true;
  const h = harness({
    reply: (key) =>
      key === "RT-1" && jiraDown
        ? Response.json({ error: "Jira didn't answer.", retry: true }, { status: 503 })
        : {},
  });
  const a = issue("RT-1"),
    b = issue("RT-2");
  h.send(edit(a, { priority: "High" }));
  await h.advance(0);
  h.send(edit({ ...a, priority: "High" }, { priority: "Highest" }), edit(b, { priority: "High" }));
  await h.advance(0);
  // RT-2 isn't held up by RT-1; RT-1's second write stays behind its first.
  expect(h.sent.map((s) => [s.key, s.at])).toEqual([
    ["RT-1", 0],
    ["RT-2", 0],
  ]);
  await h.advance(35_000);
  expect(h.sent.map((s) => [s.key, s.at])).toEqual([
    ["RT-1", 0],
    ["RT-2", 0],
    ["RT-1", 5_000],
    ["RT-1", 15_000],
    ["RT-1", 35_000],
  ]);
  // The resends say so; a later write for the issue re-reads it, so Jira's copy isn't awaited twice.
  expect(h.sent.at(-1)).toMatchObject({ resend: true, settle: false });
  expect(h.log.filter((l) => l.startsWith("retrying"))).toEqual([
    "retrying RT-1 Jira didn't answer.",
    "retrying RT-1 Jira didn't answer.",
    "retrying RT-1 Jira didn't answer.",
    "retrying RT-1 Jira didn't answer. (shown)",
  ]);
  expect(h.outbox.pending()).toBe(2);
  jiraDown = false;
  await h.advance(39_999);
  expect(h.sent).toHaveLength(5);
  await h.advance(1);
  expect(h.sent.slice(-2).map((s) => [s.key, s.at, s.ops])).toEqual([
    ["RT-1", 75_000, [{ op: "fields", fields: { priority: "High" } }]],
    ["RT-1", 75_000, [{ op: "fields", fields: { priority: "Highest" } }]],
  ]);
  expect(h.outbox.pending()).toBe(0);
  expect(h.answers.map((a) => a.key)).toEqual(["RT-2", "RT-1", "RT-1"]);
});

test("the backoff tops out at a minute", async () => {
  const h = harness({ reply: () => new Response("{}", { status: 503 }) });
  h.send(edit(issue("RT-3"), { priority: "High" }));
  await h.advance(5_000 + 10_000 + 20_000 + 40_000 + 60_000 + 60_000);
  expect(h.sent.map((s) => s.at)).toEqual([0, 5_000, 15_000, 35_000, 75_000, 135_000, 195_000]);
  expect(h.log.at(-1)).toBe(
    "retrying RT-3 Jira didn't answer. The change will be sent again shortly. (shown)",
  );
});

test("an unreachable server gets the same write again every 5 s until it answers", async () => {
  let down = 2;
  const h = harness({
    reply: () => {
      if (down-- > 0) throw new TypeError("fetch failed");
      return {};
    },
  });
  h.send(edit(issue("UN-1"), { summary: "Renamed" }));
  await h.advance(9_999);
  expect(h.sent.map((s) => s.at)).toEqual([0, 5_000]);
  await h.advance(1);
  expect(h.sent.map((s) => [s.at, s.ops, s.resend])).toEqual([
    [0, [{ op: "fields", fields: { summary: "Renamed" } }], undefined],
    [5_000, [{ op: "fields", fields: { summary: "Renamed" } }], undefined],
    [10_000, [{ op: "fields", fields: { summary: "Renamed" } }], undefined],
  ]);
  expect(h.log.filter((l) => l.startsWith("status"))).toEqual([
    "status Can't reach the better-jira server. Retrying the Jira write…",
    "status Can't reach the better-jira server. Retrying the Jira write…",
  ]);
  expect(h.answers.map((a) => a.key)).toEqual(["UN-1"]);
});

test("one change: creates go first and deletes last, and edits don't re-send what Jira does for a deleted issue itself", async () => {
  const h = harness();
  const gone = issue("OR-9"),
    child = issue("OR-2", { parent: "OR-9" }),
    made = issue("OR-NEW1");
  h.issues.set(gone.key, gone).set(child.key, child);
  h.send(
    edit(child, { parent: undefined, priority: "High" }),
    [gone.key, { issue: gone }, {}],
    [made.key, {}, { issue: made }],
  );
  await h.advance(0);
  expect(h.sent.map((s) => [s.key, s.ops[0].op])).toEqual([
    ["OR-NEW1", "create"],
    ["OR-2", "fields"],
    ["OR-9", "delete"],
  ]);
  // Jira detaches a deleted issue's children itself: only the priority goes.
  expect(h.sent[1]!.ops).toEqual([{ op: "fields", fields: { priority: "High" } }]);
});

test("edits queued behind an issue's write merge into one; a change that queued nothing comes back to settle", async () => {
  const first = gate();
  const h = harness({ reply: async (key) => (key === "MG-1" && h.sent.length === 1 ? (await first.held, {}) : {}) });
  const a = issue("MG-1");
  h.send(edit(a, { priority: "High" }));
  await h.advance(0);
  h.send(edit({ ...a, priority: "High" }, { priority: "Highest" }));
  h.send(edit({ ...a, priority: "Highest" }, { summary: "Merged" }));
  expect(h.send(edit(issue("MG-2"), {}))).toEqual(["MG-2"]);
  expect(h.outbox.pending()).toBe(2);
  first.open();
  await h.advance(0);
  expect(h.sent.map((s) => s.ops)).toEqual([
    [{ op: "fields", fields: { priority: "High" } }],
    [{ op: "fields", fields: { priority: "Highest", summary: "Merged" } }],
  ]);
});

test("rapid status changes wait 400 ms after the last and reach Jira as one transition", async () => {
  const h = harness();
  const a = issue("ST-1");
  h.send(edit(a, { status: "done" }));
  await h.advance(300);
  h.send(edit({ ...a, status: "done" }, { status: "doing" }));
  await h.advance(399);
  expect(h.sent).toEqual([]);
  await h.advance(1);
  expect(h.sent.map((s) => [s.at, s.ops])).toEqual([[700, [{ op: "status", status: "doing" }]]]);
});

test("a comment delete waits out the 8 s undo window, and undoing it inside the window sends nothing", async () => {
  const h = harness();
  const comment = { id: "10001", body: "Hi", created: "2026-01-01" };
  const full = (comments: object[]) => ({
    key: "CD-1",
    fields: { comment: { comments, total: comments.length } },
  });
  const a = issue("CD-1"),
    remove = (): [string, Side, Side] => [
      "CD-1",
      { issue: a, full: full([comment]) },
      { issue: a, full: full([]) },
    ],
    restore = (): [string, Side, Side] => [
      "CD-1",
      { issue: a, full: full([]) },
      { issue: a, full: full([comment]) },
    ];
  h.send(remove());
  expect(h.outbox.holdsDelete("10001")).toBe(true);
  expect(h.outbox.unsent()).toBe(true);
  await h.advance(7_999);
  expect(h.sent).toEqual([]);
  await h.advance(1);
  expect(h.sent.map((s) => [s.at, s.ops])).toEqual([[8_000, [{ op: "comment.delete", id: "10001" }]]]);
  // Undone inside the window: the delete never goes, and the re-add isn't sent either.
  h.send(remove());
  await h.advance(5_000);
  h.send(restore());
  await h.advance(10_000);
  expect(h.sent).toHaveLength(1);
  expect(h.outbox.unsent()).toBe(false);
});

test("an issue created here takes Jira's key: writes queued under its app key follow it, and edits naming it wait for its create", async () => {
  const held = gate(),
    creating = gate();
  const h = harness({
    reply: async (key, body) => {
      if (key === "BL-1") await held.held;
      if (body.ops[0]?.op !== "create") return {};
      await creating.held;
      return { created: { [key]: "KAN-50" } };
    },
  });
  const blocker = issue("BL-1"),
    other = issue("OT-1"),
    made = issue("KAN-NEW3");
  h.issues.set(made.key, made);
  h.send(edit(blocker, { priority: "High" }));
  await h.advance(0);
  h.send(edit(other, { priority: "High" }));
  h.send([made.key, {}, { issue: made }]);
  // Names the queued create: it must not fold into OT-1's waiting job, which goes before the create.
  h.send(edit({ ...other, priority: "High" }, { parent: "KAN-NEW3" }));
  held.open();
  await h.advance(0);
  // Edited while Jira creates it: the write waits under the app key, and goes to the Jira key.
  h.send(edit(made, { priority: "Highest" }));
  creating.open();
  await h.advance(0);
  expect(h.sent.map((s) => [s.key, s.ops])).toEqual([
    ["BL-1", [{ op: "fields", fields: { priority: "High" } }]],
    ["OT-1", [{ op: "fields", fields: { priority: "High" } }]],
    ["KAN-NEW3", [expect.objectContaining({ op: "create" })]],
    ["OT-1", [{ op: "fields", fields: { parent: "KAN-50" } }]],
    ["KAN-50", [{ op: "fields", fields: { priority: "Highest" } }]],
  ]);
  expect([h.outbox.currentKey("KAN-NEW3"), h.outbox.firstKey("KAN-50")]).toEqual([
    "KAN-50",
    "KAN-NEW3",
  ]);
  expect(h.outbox.keys()).toEqual({ "KAN-NEW3": "KAN-50" });
  expect(h.answers[2]).toMatchObject({ key: "KAN-NEW3", refused: false });
});

test("a refused write comes back with Jira's copy, and the description edits queued after it are dropped with it", async () => {
  const held = gate();
  const doc = (text: string) => ({
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const h = harness({
    reply: async () => {
      if (h.sent.length === 1) {
        await held.held;
        return { error: "Someone else changed the description.", issue: issue("RF-1") };
      }
      return {};
    },
  });
  const a = issue("RF-1"),
    side = (text: string, summary = "RF-1") => ({
      issue: { ...a, summary },
      full: { key: "RF-1", fields: { description: doc(text) } },
    });
  h.send(["RF-1", side("one"), side("two")]);
  await h.advance(0);
  h.send(["RF-1", side("two"), side("three", "Renamed")]);
  held.open();
  await h.advance(0);
  expect(h.answers[0]).toMatchObject({
    key: "RF-1",
    describes: true,
    result: { error: "Someone else changed the description.", issue: { priority: "Low" } },
  });
  expect(h.sent[1]!.ops).toEqual([{ op: "fields", fields: { summary: "Renamed" } }]);
});

test("a failed upload rolls the write back to Jira's copy without sending it; files uploaded early leave nothing to send", async () => {
  const h = harness({
    prepare: async (key, ops) => {
      if (key === "UP-1") throw new Error("The file is too large for Jira.");
      return ops.filter((op) => op.op !== "attachment.add");
    },
    reply: (key) => ({ issue: issue(key) }),
  });
  const file = { id: "f1", name: "a.png", url: "", type: "image/png", size: 1 };
  h.send(edit(issue("UP-1"), { attachments: [file], priority: "High" }));
  await h.advance(0);
  // Only an empty write, to read Jira's copy to roll back to.
  expect(h.sent.map((s) => [s.key, s.ops])).toEqual([["UP-1", []]]);
  expect(h.answers[0]).toMatchObject({
    result: { error: "The file is too large for Jira.", issue: { priority: "Low" } },
  });
  h.send(edit(issue("UP-2"), { attachments: [file] }));
  await h.advance(0);
  expect(h.sent).toHaveLength(1);
  expect(h.log.slice(-2)).toEqual(["uploadsOnly UP-2", "pending 0"]);
});

test("a create Jira refuses takes its follow-up uploads with it", async () => {
  const h = harness({ reply: () => ({ error: "Summary is required." }) });
  const made = issue("KAN-NEW4", {
    attachments: [{ id: "f1", name: "a.png", url: "", type: "image/png", size: 1 }],
  });
  h.send([made.key, {}, { issue: made }]);
  await h.advance(0);
  expect(h.sent.map((s) => s.ops.map((op) => op.op))).toEqual([["create"]]);
  expect(h.answers[0]).toMatchObject({ refused: true });
  expect(h.outbox.pending()).toBe(0);
});

test("Restore drops an issue's queued writes, and the one being retried stops", async () => {
  const h = harness({ reply: () => new Response("{}", { status: 503 }) });
  const a = issue("RS-1");
  h.send(edit(a, { priority: "High" }));
  await h.advance(0);
  h.send(edit({ ...a, priority: "High" }, { priority: "Highest" }));
  h.outbox.cancel("RS-1");
  expect(h.outbox.has("RS-1")).toBe(true);
  await h.advance(60_000);
  expect(h.sent).toHaveLength(1);
  expect(h.outbox.has("RS-1")).toBe(false);
});

test("tab hand-off: a write naming an issue another open tab is creating waits for that tab's Jira key", async () => {
  let keys: Record<string, string> = {};
  const h = harness({
    tabs: {
      stored: async () => ({ keys, created: new Set(["KAN-NEW7"]) }),
      exclusive: async (fn) => fn(new Set(["other-tab"])),
    },
  });
  h.outbox.own("KAN-NEW7", "other-tab", true);
  h.outbox.own("TH-1", "other-tab", false);
  expect(h.outbox.tab("TH-1")).toBe("other-tab");
  // Edited here: this tab sends it now. The issue the other tab is creating stays that tab's.
  h.outbox.touch("TH-1", "KAN-NEW7");
  expect([h.outbox.tab("TH-1"), h.outbox.tab("KAN-NEW7")]).toEqual(["this-tab", "other-tab"]);
  h.send(edit(issue("TH-1"), { parent: "KAN-NEW7" }), edit(issue("TH-2"), { priority: "High" }));
  await h.advance(2_500);
  expect(h.sent.map((s) => s.key)).toEqual(["TH-2"]);
  expect(h.outbox.unsent()).toBe(false);
  expect(h.log).toContain("status Waiting for another tab to create KAN-NEW7 in Jira…");
  keys = { "KAN-NEW7": "KAN-60" };
  await h.advance(1_000);
  expect(h.log).toContain("moved KAN-NEW7 → KAN-60");
  expect(h.sent.map((s) => [s.key, s.ops])).toEqual([
    ["TH-2", [{ op: "fields", fields: { priority: "High" } }]],
    ["TH-1", [{ op: "fields", fields: { parent: "KAN-60" } }]],
  ]);
});

test("tab hand-off: when the creating tab has closed, this tab claims the create and sends it first", async () => {
  const made = issue("KAN-NEW8", { summary: "Saved by the closed tab" });
  const claims: Set<string>[] = [];
  const h = harness({
    tabs: {
      stored: async () => ({ keys: {}, created: new Set([made.key]) }),
      exclusive: async (fn) => fn(new Set(["this-tab"])),
      claim: async (_live, only) => (
        claims.push(only!),
        {
          claimed: new Set([made.key]),
          changes: [
            {
              key: made.key,
              issue: made,
              issueFields: [],
              fullFields: [],
              created: true,
              tab: "closed-tab",
            },
          ],
        }
      ),
    },
    reply: (key, body) => (body.ops[0]?.op === "create" ? { created: { [key]: "KAN-61" } } : {}),
  });
  h.onTakeOver((change) => h.send([change.key, {}, { issue: change.issue! }]));
  h.outbox.own(made.key, "closed-tab", true);
  h.send(edit(issue("TC-1"), { parent: made.key }));
  await h.advance(0);
  expect(claims).toEqual([new Set([made.key])]);
  expect(h.outbox.tab(made.key)).toBe("this-tab");
  expect(h.sent.map((s) => [s.key, s.ops[0]])).toEqual([
    [made.key, expect.objectContaining({ op: "create", fields: expect.objectContaining({ summary: "Saved by the closed tab" }) })],
    ["TC-1", { op: "fields", fields: { parent: "KAN-61" } }],
  ]);
});

test("tab hand-off: an issue its tab discarded takes this tab's edits of it along", async () => {
  const h = harness({
    tabs: { stored: async () => ({ keys: {}, created: new Set() }), exclusive: async (fn) => fn(new Set()) },
  });
  h.outbox.own("KAN-NEW9", "other-tab", true);
  h.send(edit(issue("KAN-NEW9"), { priority: "High" }));
  await h.advance(0);
  expect(h.log).toContain("discarded KAN-NEW9");
  expect([h.sent, h.outbox.pending()]).toEqual([[], 0]);
});

test("BJ-20: a replayed create whose description edit met a changed Jira copy answers as a refused description", async () => {
  const made = issue("KAN-NEW10");
  const h = harness({
    reply: (key) => ({ created: { [key]: "KAN-62" }, error: `Jira didn't take the edits made to KAN-62 since it was created: ${DESCRIPTION_CONFLICT}` }),
  });
  h.send([made.key, {}, { issue: made }]);
  await h.advance(0);
  // The store then keeps the edit beside Jira's text (descriptionRejected) instead of taking Jira's.
  expect(h.answers.map((a) => [a.key, a.refused, a.describes])).toEqual([[made.key, false, true]]);
});

test("BJ-19: a create queued after jobs that name it goes first, so they get its Jira key", async () => {
  const made = issue("KAN-NEW11");
  const h = harness({
    reply: (key, body) => (body.ops[0]?.op === "create" ? { created: { [key]: "KAN-63" } } : {}),
  });
  // Another tab was creating it; this tab's edit naming it waits. The tab closes and this one takes the create over.
  h.outbox.own(made.key, "closed-tab", true);
  h.send(edit(issue("TO-1"), { parent: made.key }));
  h.outbox.release(made.key);
  h.send([made.key, {}, { issue: made }]);
  await h.advance(0);
  expect(h.sent.map((s) => [s.key, s.ops[0]?.op === "create" ? "create" : s.ops[0]])).toEqual([
    [made.key, "create"],
    ["TO-1", { op: "fields", fields: { parent: "KAN-63" } }],
  ]);
});
