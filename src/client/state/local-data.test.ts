import { type Issue, type Full } from "@/shared/issue-model";
import { textToAdf } from "@/shared/document";
import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
  emptyLocalState,
  LocalDatabase,
  localDataName,
  mergeChanges,
  parseLocalState,
  type LocalState,
} from "./local-data";


const issue: Issue = {
  key: "TEST-NEW1",
  boards: [1],
  summary: "Persistent local issue",
  status: "todo",
  assignee: null,
  labels: ["local"],
  comments: 1,
  updated: "2026-11-06T10:00:00Z",
  resolved: null,
};
const full: Full = {
  key: issue.key,
  fields: {
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Rich text", marks: [{ type: "strong" }] }],
        },
      ],
    },
    comment: {
      total: 1,
      comments: [
        {
          id: "local-2",
          body: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: "Local comment" }] }],
          },
        },
      ],
    },
  },
};
test("local files, rich descriptions, comments and undo/redo survive a database close/reopen", async () => {
  const factory = new IDBFactory();
  let db = await LocalDatabase.open("account-one", factory);
  const file = await db.addFile(
    new File(["durable file content"], "fixture.txt", { type: "text/plain" }),
  );
  const mediaEdits = {
    fixture: {
      crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 },
      comments: [
        { id: "review", text: "Keep this crop", author: "Me", at: "2026-11-07T00:00:00Z" },
      ],
    },
  };
  const savedIssue = { ...issue, attachments: [file], mediaEdits };
  const state: LocalState = {
    version: 1,
    sequence: 2,
    changes: [
      {
        key: issue.key,
        issue: savedIssue,
        full,
        issueFields: ["summary", "attachments"],
        fullFields: ["description", "comment"],
        created: true,
      },
    ],
    undo: [
      { keys: [issue.key], label: "create", before: [{}], after: [{ issue: savedIssue, full }] },
    ],
    redo: [],
  };
  await db.save(state);
  const oldURL = file.url;
  db.close();
  db = await LocalDatabase.open("account-one", factory);
  const loaded = await db.load();
  expect(loaded.recovered).toBe(false);
  expect(loaded.state.sequence).toBe(2);
  expect(loaded.state.changes[0]?.full).toEqual(full);
  expect(loaded.state.undo[0]?.after[0]?.full).toEqual(full);
  expect(loaded.state.changes[0]?.issue?.mediaEdits).toEqual(mediaEdits);
  expect(loaded.state.undo[0]?.after[0]?.issue?.mediaEdits).toEqual(mediaEdits);
  const url = loaded.state.changes[0]!.issue!.attachments![0]!.url!;
  expect(url).not.toBe(oldURL);
  expect(await (await fetch(url)).text()).toBe("durable file content");
  expect(loaded.state.undo[0]?.after[0]?.issue?.attachments?.[0]?.url).toBe(url);
  db.close();
  const other = await LocalDatabase.open("another-account", factory);
  expect((await other.load()).state.changes).toEqual([]);
  other.close();
});
test("corrupt records are isolated and unknown schema versions cannot overwrite stored data", () => {
  const state = emptyLocalState();
  expect(
    parseLocalState({
      ...state,
      changes: [
        { key: "bad", issue: { reactions: {} }, fullFields: [], issueFields: [], created: false },
      ],
    }),
  ).toMatchObject({ recovered: true, readOnly: false, state: { changes: [] } });
  expect(parseLocalState({ version: 99, changes: [issue] })).toMatchObject({
    recovered: true,
    readOnly: true,
  });
  expect(parseLocalState(undefined)).toEqual({ state, recovered: false, readOnly: false });
});
test("a drop's rank anchor survives a reload, so a replayed drop still names the card it was dropped beside", () => {
  const dropped = {
    key: issue.key,
    issue: { ...issue, rank: "c", rankAnchor: { before: "TEST-2" } },
    issueFields: ["rank", "rankAnchor"],
    fullFields: [],
    created: false,
  };
  expect(parseLocalState({ ...emptyLocalState(), changes: [dropped] }).state.changes).toEqual([dropped]);
  const malformed = { ...dropped, issue: { ...dropped.issue, rankAnchor: { before: 2 } } };
  expect(parseLocalState({ ...emptyLocalState(), changes: [malformed] }).state.changes).toEqual([]);
});

test("R1-D21/D22: two tabs keep saving; each keeps the other's changes to issues it didn't edit", async () => {
  const factory = new IDBFactory(),
    one = await LocalDatabase.open("same", factory),
    two = await LocalDatabase.open("same", factory);
  const change = (key: string, summary: string) => ({
    key,
    issue: { ...issue, key, summary },
    issueFields: ["summary"],
    fullFields: [],
    created: true,
  });
  await one.save({ ...emptyLocalState(), changes: [change("A-1", "base")] });
  await one.load();
  await two.load();
  // Tab one edits A-1 and adds A-2; tab two, still on the old revision, adds B-1.
  await one.save({
    ...emptyLocalState(),
    sequence: 7,
    changes: [change("A-1", "one"), change("A-2", "one")],
  });
  expect(
    await two.save({
      ...emptyLocalState(),
      sequence: 5,
      changes: [change("A-1", "base"), change("B-1", "two")],
    }),
  ).toBe(7);
  // Tab one drops A-2 (Jira took it) and saves again: tab two's B-1 survives.
  await one.save({ ...emptyLocalState(), changes: [change("A-1", "one")] });
  const summaries = (await one.load()).state.changes.map((c) => `${c.key}:${c.issue?.summary}`);
  expect(summaries.sort()).toEqual(["A-1:one", "B-1:two"]);
  one.close();
  two.close();
});
test("R2-issue-fields-D1: a tab's later saves keep another tab's reminders and activity rows, field by field", async () => {
  const factory = new IDBFactory(),
    one = await LocalDatabase.open("merge", factory),
    two = await LocalDatabase.open("merge", factory);
  const row = (id: string) => ({
    id,
    field: "priority",
    at: "2026-11-08T00:00:00Z",
    actor: { id: "me", name: "Me" },
  });
  const change = (key: string, fields: Partial<Issue>): any => ({
    key,
    issue: { ...issue, key, ...fields },
    issueFields: Object.keys(fields),
    fullFields: [],
    created: false,
  });
  await one.load();
  await two.load();
  // Tab two: a reminder on B-1, and a priority edit with an Activity row on A-1.
  await two.save({
    ...emptyLocalState(),
    changes: [
      change("B-1", { reminder: { at: "2026-11-09T00:00:00Z" } }),
      change("A-1", { priority: "Low", activity: [row("two")] } as any),
    ],
  });
  // Tab one, which never saw those: edits A-1's priority with its own Activity row, then saves twice.
  const mine = change("A-1", { priority: "High", activity: [row("one")] } as any);
  await one.save({ ...emptyLocalState(), changes: [mine] });
  await one.save({ ...emptyLocalState(), changes: [mine] });
  const { changes } = (await two.load()).state;
  const b = changes.find((c) => c.key === "B-1"),
    a = changes.find((c) => c.key === "A-1");
  expect(b?.issue?.reminder?.at).toBe("2026-11-09T00:00:00Z");
  expect(a?.issue?.priority).toBe("High");
  expect(a?.issue?.activity?.map((r) => r.id).sort()).toEqual(["one", "two"]);
  one.close();
  two.close();
});
test("a refused description this tab cleared stays cleared after a reload, though no other field changed", async () => {
  const database = await LocalDatabase.open("refused", new IDBFactory());
  const change = (refused?: Pick<Full, "descriptionRejected" | "descriptionError">) => ({
    key: "A-1",
    issue: { ...issue, key: "A-1", descriptionHistory: [] },
    full: { key: "A-1", fields: { description: textToAdf("Theirs") }, ...refused },
    issueFields: ["descriptionHistory"],
    fullFields: [],
    created: false,
  });
  await database.load();
  // Jira refused "Mine"; then Keep mine (or Use Jira's version) dropped the refused version and nothing else.
  await database.save({
    ...emptyLocalState(),
    changes: [change({ descriptionRejected: textToAdf("Mine"), descriptionError: "Someone changed it" })],
  });
  await database.save({ ...emptyLocalState(), changes: [change()] });
  const [saved] = (await database.load()).state.changes;
  expect(saved?.full?.descriptionRejected).toBeUndefined();
  expect(saved?.full?.descriptionError).toBeUndefined();
  database.close();
});
test("R2-create-D1: a tab never writes back a create another tab already sent and dropped", async () => {
  const factory = new IDBFactory(),
    one = await LocalDatabase.open("resurrect", factory),
    two = await LocalDatabase.open("resurrect", factory);
  const change = (key: string, tab: string) => ({
    key,
    issue: { ...issue, key },
    issueFields: ["summary"],
    fullFields: [],
    created: true,
    tab,
  });
  const create = change("A-NEW1", "one");
  await one.load();
  await one.save({ ...emptyLocalState(), changes: [create] });
  await two.load();
  await one.save({ ...emptyLocalState(), changes: [] });
  const theirs = { ...emptyLocalState(), changes: [create, change("B-1", "two")] };
  await two.save(theirs);
  await two.save(theirs);
  expect((await one.load()).state.changes.map((c) => c.key)).toEqual(["B-1"]);
  one.close();
  two.close();
});
test("R1-D6/D7: only changes of closed tabs are claimed, and only once", async () => {
  const factory = new IDBFactory(),
    db = await LocalDatabase.open("claims", factory);
  const change = (key: string, tab?: string) => ({
    key,
    issue: { ...issue, key },
    issueFields: ["summary"],
    fullFields: [],
    created: true,
    ...(tab ? { tab } : {}),
  });
  await db.save({
    ...emptyLocalState(),
    changes: [change("A-1", "alive"), change("A-2", "closed"), change("A-3")],
  });
  expect([...(await db.claim("me", new Set(["alive"])))]).toEqual(["A-2", "A-3"]);
  expect([...(await db.claim("other", new Set(["alive", "me"])))]).toEqual([]);
  db.close();
});
test("corrupt raw data is backed up and an unknown schema remains protected", async () => {
  const factory = new IDBFactory(),
    name = "better-jira:local:v1:corrupt",
    db = await LocalDatabase.open("corrupt", factory);
  db.close();
  const raw = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
  });
  const put = (value: unknown) =>
    new Promise<void>((resolve, reject) => {
      const tx = raw.transaction("state", "readwrite");
      tx.objectStore("state").put(value, "workspace");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  await put({ ...emptyLocalState(), changes: [{ key: "bad", issue: {} }] });
  let current = await LocalDatabase.open("corrupt", factory);
  expect((await current.load()).recovered).toBe(true);
  expect(await current.recoveryCopies()).toHaveLength(1);
  current.close();
  await put({ version: 99, privateData: "keep me" });
  current = await LocalDatabase.open("corrupt", factory);
  expect((await current.load()).readOnly).toBe(true);
  await expect(current.save(emptyLocalState())).rejects.toThrow("unsupported version");
  expect(
    (await current.recoveryCopies()).some(
      (copy: any) => copy.version === 99 && copy.privateData === "keep me",
    ),
  ).toBe(true);
  current.close();
  raw.close();
});

test("R2-palette-shortcuts-D2: a recovered record is copied once and its cleaned state saved at load", async () => {
  const factory = new IDBFactory(),
    db = await LocalDatabase.open("once", factory);
  await db.save({ ...emptyLocalState(), undo: "corrupt" as any });
  db.close();
  for (const recovered of [true, false, false]) {
    const current = await LocalDatabase.open("once", factory);
    expect((await current.load()).recovered).toBe(recovered);
    expect(await current.recoveryCopies()).toHaveLength(1);
    current.close();
  }
  const raw = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open("better-jira:local:v1:once");
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve) => {
    const tx = raw.transaction("state", "readwrite");
    tx.objectStore("state").put({ version: 99 }, "workspace");
    tx.oncomplete = () => resolve();
  });
  raw.close();
  await Bun.sleep(2); // recovery copies are keyed by time
  for (let i = 0; i < 2; i++) {
    const current = await LocalDatabase.open("once", factory);
    expect((await current.load()).readOnly).toBe(true);
    expect(await current.recoveryCopies()).toHaveLength(2);
    current.close();
  }
});

test("active local files keep their metadata but their blob URLs cannot render HTML or SVG", async () => {
  const factory = new IDBFactory();
  let db = await LocalDatabase.open("safe-files", factory);
  for (const type of ["text/html", "image/svg+xml"]) {
    const payload = '<script>document.title="EXECUTED"</script>';
    const original = new File([payload], type === "text/html" ? "active.html" : "active.svg", {
      type,
    });
    const file = await db.addFile(original);
    expect(file.type).toBe(original.type);
    expect(await (await fetch(file.url)).text()).toBe(payload);
    expect((await fetch(file.url)).headers.get("content-type")).toBe("application/octet-stream");
    db.close();
    db = await LocalDatabase.open("safe-files", factory);
    expect((await fetch((await db.fileURL(file.id))!)).headers.get("content-type")).toBe(
      "application/octet-stream",
    );
  }
  db.close();
});

test("resource documents and named links survive durable storage and invalid schemes are rejected", async () => {
  const resources: NonNullable<Issue["resources"]> = [
    {
      id: "doc",
      kind: "document",
      title: "Investigation",
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Rich notes", marks: [{ type: "strong" }] }],
          },
        ],
      },
      updated: "2026-11-07T00:00:00Z",
    },
    {
      id: "url",
      kind: "link",
      title: "Design",
      url: "https://example.com/design",
      updated: "2026-11-07T00:00:00Z",
    },
  ];
  const state: LocalState = {
    ...emptyLocalState(),
    changes: [
      {
        key: issue.key,
        issue: { ...issue, resources },
        issueFields: ["resources"],
        fullFields: [],
        created: false,
      },
    ],
  };
  const factory = new IDBFactory();
  let db = await LocalDatabase.open("resources", factory);
  await db.load();
  await db.save(state);
  db.close();
  db = await LocalDatabase.open("resources", factory);
  expect((await db.load()).state.changes[0]?.issue?.resources).toEqual(resources);
  db.close();
  const invalid = {
    ...state,
    changes: [
      {
        ...state.changes[0]!,
        issue: { ...issue, resources: [{ ...resources[1], url: "javascript:alert(1)" }] },
      },
    ],
  };
  expect(parseLocalState(invalid).recovered).toBe(true);
  expect(parseLocalState(invalid).state.changes).toEqual([]);
  const reminded = (reminder: unknown) =>
    parseLocalState({
      ...state,
      changes: [
        {
          ...state.changes[0]!,
          issue: { ...issue, resources: [{ ...resources[0]!, reminder } as never] },
        },
      ],
    }).recovered;
  expect(reminded({ at: "2026-11-09T09:00:00.000Z" })).toBe(false);
  expect(reminded({ at: "soon" })).toBe(true);
  expect(reminded({ at: "2026-11-09T09:00:00.000Z", delivered: "yes" })).toBe(true);
});

test("document metadata and version media survive storage while malformed settings are isolated", async () => {
  const owner = { id: "me", name: "Me" },
    body = { type: "doc" as const, version: 1 as const, content: [] };
  const resource = {
    id: "history",
    kind: "document" as const,
    title: "Versioned",
    updated: "2026-11-08T00:00:00Z",
    body,
    owner,
    editedBy: owner,
    subscribers: [owner],
    showAuthors: true,
    icon: { name: "emoji:📝", color: "#2d9cdb" },
    history: [
      {
        title: "Old title",
        at: "2026-11-07T00:00:00Z",
        author: owner,
        body: {
          ...body,
          content: [
            {
              type: "mediaSingle",
              content: [{ type: "media", attrs: { id: "historical-file", type: "file" } }],
            },
          ],
        },
      },
    ],
  };
  const state: LocalState = {
    ...emptyLocalState(),
    changes: [
      {
        key: issue.key,
        issue: { ...issue, resources: [resource] },
        issueFields: ["resources"],
        fullFields: [],
        created: false,
      },
    ],
  };
  const db = await LocalDatabase.open("document-history", new IDBFactory());
  await db.load();
  await db.save(state);
  expect((await db.load()).state.changes[0]?.issue?.resources).toEqual([resource]);
  db.close();
  const { resourceMediaIds } = await import("@/shared/issue-resource");
  expect([...resourceMediaIds(resource)]).toEqual(["historical-file"]);
  for (const invalid of [
    { showAuthors: "yes" },
    { owner: { name: "No id" } },
    { subscribers: [null] },
    { icon: { name: "file", color: "url(javascript:bad)" } },
    { history: [{ body: "bad" }] },
  ]) {
    const corrupt = {
      ...state,
      changes: [
        { ...state.changes[0]!, issue: { ...issue, resources: [{ ...resource, ...invalid }] } },
      ],
    };
    expect(parseLocalState(corrupt).recovered).toBe(true);
    expect(parseLocalState(corrupt).state.changes).toHaveLength(0);
  }
});
test("thread overrides, reply parents and reminder delivery persist with undo snapshots", async () => {
  const factory = new IDBFactory();
  let db = await LocalDatabase.open("thread-state", factory);
  const savedIssue = {
    ...issue,
    commentStates: {
      "jira-1": {
        resolved: true,
        subscribed: false,
        reactions: ["💙"],
        body: full.fields.description,
      },
    },
    reminder: { at: "2026-11-10T10:00:00Z", delivered: true },
  };
  const reply = {
    id: "local-3",
    parentId: "jira-1",
    body: full.fields.description,
    created: "2026-11-07T10:00:00Z",
  };
  const savedFull = {
    ...full,
    fields: { ...full.fields, comment: { total: 1, comments: [reply] } },
  };
  const state: LocalState = {
    ...emptyLocalState(),
    changes: [
      {
        key: issue.key,
        issue: savedIssue,
        full: savedFull,
        issueFields: ["commentStates", "reminder"],
        fullFields: ["comment"],
        created: false,
      },
    ],
    undo: [
      {
        keys: [issue.key],
        label: "thread",
        before: [{ issue }],
        after: [{ issue: savedIssue, full: savedFull }],
      },
    ],
  };
  await db.save(state);
  db.close();
  db = await LocalDatabase.open("thread-state", factory);
  const loaded = await db.load();
  expect(loaded.recovered).toBe(false);
  expect(loaded.state.changes[0]?.issue?.commentStates).toEqual(savedIssue.commentStates);
  expect(loaded.state.changes[0]?.full?.fields.comment.comments[0].parentId).toBe("jira-1");
  expect(loaded.state.undo[0]?.after[0]?.issue?.reminder).toEqual(savedIssue.reminder);
  db.close();
});
test("R2-comments-D2: reactions made in two tabs on the same issue both survive, and only removals made here remove", async () => {
  const factory = new IDBFactory(),
    one = await LocalDatabase.open("tabs", factory),
    two = await LocalDatabase.open("tabs", factory);
  const change = (reactions: Record<string, string[]>) => ({
    key: "KAN-1",
    issue: {
      ...issue,
      key: "KAN-1",
      commentStates: Object.fromEntries(
        Object.entries(reactions).map(([id, list]) => [id, { reactions: list }]),
      ),
    },
    issueFields: ["commentStates"],
    fullFields: [],
    created: false,
  });
  await one.save({ ...emptyLocalState(), changes: [change({ c1: ["💯"] })] });
  await one.load();
  await two.load();
  // Tab two adds 🔥 to c2; tab one, still on its own copy, adds 🚀 to c2 and removes its 💯 from c1.
  await two.save({ ...emptyLocalState(), changes: [change({ c1: ["💯"], c2: ["🔥"] })] });
  await one.save({ ...emptyLocalState(), changes: [change({ c2: ["🚀"] })] });
  // Tab two saves again with only what it knew: its own copy must not bring back 💯 or drop 🚀.
  await two.save({ ...emptyLocalState(), changes: [change({ c1: ["💯"], c2: ["🔥", "👀"] })] });
  const [saved] = (await one.load()).state.changes;
  expect(saved?.issue?.commentStates).toEqual({ c2: { reactions: ["🔥", "🚀", "👀"] } });
  one.close();
  two.close();
});

test("sync check 7: an edit another tab made on a new issue's app key moves to the Jira key, whenever either tab saves", async () => {
  const factory = new IDBFactory(),
    one = await LocalDatabase.open("move", factory),
    two = await LocalDatabase.open("move", factory);
  const change = (key: string, fields: Partial<Issue>, created: boolean): any => ({
    key,
    issue: { ...issue, key, ...fields },
    issueFields: Object.keys(fields),
    fullFields: [],
    created,
  });
  // Tab one creates A-NEW1; tab two opens it from a link.
  await one.load();
  await one.save({ ...emptyLocalState(), changes: [change("A-NEW1", {}, true)] });
  await two.load();
  // Tab one's create lands as A-5 and it saves the move; tab two, which hasn't seen that, edits the app key.
  await one.save({ ...emptyLocalState(), changes: [], keys: { "A-NEW1": "A-5" } });
  await two.save({
    ...emptyLocalState(),
    changes: [change("A-NEW1", { priority: "High" }, true)],
  });
  expect(two.moved).toEqual({ "A-NEW1": "A-5" });
  // Tab one saves again with nothing for the issue: tab two's edit stays, on the Jira key, as an edit (not a create).
  await one.save({ ...emptyLocalState(), changes: [], keys: { "A-NEW1": "A-5" } });
  const { changes } = (await one.load()).state;
  expect(changes.map((c) => [c.key, c.created, c.issueFields, c.issue?.priority])).toEqual([
    ["A-5", false, ["priority"], "High"],
  ]);
  one.close();
  two.close();
});

const edit = (key: string, fields: Partial<Issue>, created = false): any => ({
  key,
  issue: { ...issue, key, ...fields },
  issueFields: Object.keys(fields),
  fullFields: [],
  created,
});

test("sync review 4: a tab's edits on a new issue's app key and on its Jira key both survive the move", () => {
  // Before this tab learnt A-NEW1 → A-5, it edited the summary on A-NEW1 and the priority on A-5, which the poll showed.
  const mine = [edit("A-NEW1", { summary: "Mine" }, true), edit("A-5", { priority: "High" })];
  const [merged, ...rest] = mergeChanges(new Map(), mine, [], { "A-NEW1": "A-5" });
  expect(rest).toEqual([]);
  expect([merged!.key, merged!.created, merged!.issueFields.sort()]).toEqual([
    "A-5",
    false,
    ["priority", "summary"],
  ]);
  expect([merged!.issue?.summary, merged!.issue?.priority]).toEqual(["Mine", "High"]);
});

test("sync review 6: a field this tab stopped overriding (Jira took it) doesn't wipe another tab's newer edit of it", () => {
  // This tab's summary edit was saved; Jira took it, so the tab dropped it. Meanwhile another tab edited the summary.
  const base = new Map([["A-2", edit("A-2", { summary: "Sent" })]]);
  const merged = mergeChanges(base, [], [edit("A-2", { summary: "Theirs" })]);
  expect(merged.map((c) => [c.key, c.issueFields, c.issue?.summary])).toEqual([
    ["A-2", ["summary"], "Theirs"],
  ]);
});

test("changes saved while an issue had one board load with its boards, nothing dropped", () => {
  const { boards: _boards, ...rest } = issue;
  const old = { ...rest, board: 1 };
  const parsed = parseLocalState({
    ...emptyLocalState(),
    changes: [{ key: issue.key, issue: old, issueFields: ["board", "summary"], fullFields: [], created: true }],
    undo: [{ keys: [issue.key], label: "create", before: [{}], after: [{ issue: old, issueFields: ["board"] }] }],
  });
  expect(parsed.recovered).toBe(false);
  expect(parsed.state.changes[0]!.issue).toEqual({ ...rest, boards: [1] });
  expect(parsed.state.changes[0]!.issueFields).toEqual(["boards", "summary"]);
  expect(parsed.state.undo[0]!.after[0]!.issue).toEqual({ ...rest, boards: [1] });
});

test("Blocker 2: changes saved while local only are not in a writable load's saved data, so nothing of them is sent to Jira", async () => {
  const factory = new IDBFactory(),
    account = "https://example.atlassian.net/me";
  const played = { key: "TEST-5", issue: { ...issue, key: "TEST-5", status: "done" }, issueFields: ["status"], fullFields: [], created: false };
  const local = await LocalDatabase.open(localDataName(account, false), factory);
  await local.save({ ...emptyLocalState(), changes: [played] });
  // The same browser, now writable: its saved changes, the outbox `resumeSync` sends again, hold none of that play.
  expect((await (await LocalDatabase.open(localDataName(account, true), factory)).load()).state.changes).toEqual([]);
  // Writes made while writable keep their database, so ones still unsent when this fix landed are kept.
  expect(localDataName(account, true)).toBe(account);
  // Local only again: the play is still there.
  expect((await (await LocalDatabase.open(localDataName(account, false), factory)).load()).state.changes.map((c) => c.key)).toEqual(["TEST-5"]);
});
