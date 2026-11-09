import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { emptyLocalState, LocalDatabase, parseLocalState, type LocalState } from "./local-data";
import type { Issue, Full } from "./store";

const issue: Issue = {
  key: "TEST-NEW1",
  board: 1,
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
  await one.save(
    { ...emptyLocalState(), sequence: 7, changes: [change("A-1", "one"), change("A-2", "one")] },
    new Set(["A-1", "A-2"]),
  );
  expect(
    await two.save(
      { ...emptyLocalState(), sequence: 5, changes: [change("A-1", "base"), change("B-1", "two")] },
      new Set(["B-1"]),
    ),
  ).toBe(7);
  // Tab one drops A-2 (Jira took it) and saves again: tab two's B-1 survives.
  await one.save({ ...emptyLocalState(), changes: [change("A-1", "one")] }, new Set(["A-2"]));
  const summaries = (await one.load()).state.changes.map((c) => `${c.key}:${c.issue?.summary}`);
  expect(summaries.sort()).toEqual(["A-1:one", "B-1:two"]);
  one.close();
  two.close();
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
  await one.save({ ...emptyLocalState(), changes: [create] }, new Set(["A-NEW1"]));
  // Tab two loads while the create is pending, and keeps it in memory.
  await two.load();
  // Jira takes the create: tab one renames it to A-7 and drops A-NEW1.
  await one.save({ ...emptyLocalState(), changes: [] }, new Set(["A-NEW1"]));
  // Tab two saves its own edits twice, still holding A-NEW1; a closed tab one would have it created again on the next load.
  const theirs = { ...emptyLocalState(), changes: [create, change("B-1", "two")] };
  await two.save(theirs, new Set(["B-1"]));
  await two.save(theirs, new Set(["B-1"]));
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
  const { resourceMediaIds } = await import("./issue-resource");
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
  const dirty = new Set(["KAN-1"]);
  await one.save({ ...emptyLocalState(), changes: [change({ c1: ["💯"] })] }, dirty);
  await one.load();
  await two.load();
  // Tab two adds 🔥 to c2; tab one, still on its own copy, adds 🚀 to c2 and removes its 💯 from c1.
  await two.save({ ...emptyLocalState(), changes: [change({ c1: ["💯"], c2: ["🔥"] })] }, dirty);
  await one.save({ ...emptyLocalState(), changes: [change({ c2: ["🚀"] })] }, dirty);
  // Tab two saves again with only what it knew: its own copy must not bring back 💯 or drop 🚀.
  await two.save(
    { ...emptyLocalState(), changes: [change({ c1: ["💯"], c2: ["🔥", "👀"] })] },
    dirty,
  );
  const [saved] = (await one.load()).state.changes;
  expect(saved?.issue?.commentStates).toEqual({ c2: { reactions: ["🔥", "🚀", "👀"] } });
  one.close();
  two.close();
});
