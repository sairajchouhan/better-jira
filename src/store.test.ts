import { expect, test } from "bun:test";
import type { Board } from "./store";
import { IDBFactory } from "fake-indexeddb";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});
Object.defineProperty(globalThis, "requestAnimationFrame", {
  configurable: true,
  value: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
});
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
// Tests after load() navigate; give them a minimal browser location.
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: { href: "http://localhost:3000/", origin: "http://localhost:3000" },
});
Object.defineProperty(globalThis, "history", {
  configurable: true,
  value: {
    pushState: (_s: unknown, _t: string, url: URL) => {
      (globalThis as any).location.href = String(url);
    },
    replaceState: (_s: unknown, _t: string, url: URL) => {
      (globalThis as any).location.href = String(url);
    },
  },
});

test("personal issue edits, comments, creation and deletion undo without losing issue details", async () => {
  const { actions, get, set, navigate, undoEdit, redoEdit, ME } = await import("./store");
  Object.assign(ME, { id: "me", name: "Me" });
  const board: Board = {
    id: 1,
    name: "Personal",
    columns: [
      { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
      { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
    ],
  };
  set({ boards: [board], issues: new Map(), full: new Map() });
  navigate({ board: 1 });
  const key = actions.create("Personal test", {
    status: "done",
    description: "Description",
    assignee: ME,
    priority: "High",
    labels: ["test"],
    due: "2026-12-01",
  })!;
  expect(get().issues.get(key)).toMatchObject({
    status: "done",
    priority: "High",
    labels: ["test"],
    assignee: ME,
    due: "2026-12-01",
  });
  expect(get().issues.get(key)?.resolved).toBeString();
  expect(get().full.get(key)?.fields.description.content[0].content[0].text).toBe("Description");
  actions.status(key, "todo");
  expect(get().issues.get(key)?.resolved).toBeNull();
  undoEdit();
  expect(get().issues.get(key)?.status).toBe("done");
  redoEdit();
  expect(get().issues.get(key)?.status).toBe("todo");
  actions.comment(key, "A local comment");
  expect(get().full.get(key)?.fields.comment.total).toBe(1);
  undoEdit();
  expect(get().full.get(key)?.fields.comment.total).toBe(0);
  expect(get().issues.get(key)?.comments).toBe(0);
  redoEdit();
  expect(get().full.get(key)?.fields.comment.total).toBe(1);
  actions.remove(key);
  expect(get().issues.has(key)).toBe(false);
  undoEdit();
  expect(get().issues.get(key)?.summary).toBe("Personal test");
  expect(get().full.get(key)?.fields.comment.total).toBe(1);
  // Make a copy opens the composer prefilled; the copy exists only once it is saved.
  const count = get().issues.size;
  actions.duplicate(key);
  expect(get().issues.size).toBe(count);
  expect(get().overlay).toBe("create");
  expect(get().draft).toMatchObject({
    title: "Personal test (copy)",
    copy: true,
    labels: ["test"],
  });
  const copy = actions.create(get().draft.title!, get().draft)!;
  expect(get().issues.get(copy)?.summary).toBe("Personal test (copy)");
  expect(get().issues.get(copy)).not.toHaveProperty("copy");
  expect(get().issues.get(copy)?.labels).toEqual(["test"]);
  expect(get().full.get(copy)?.fields.comment.total).toBe(0);
  undoEdit();
  expect(get().issues.has(copy)).toBe(false);
  actions.patch(key, { priority: "Low" });
  expect(get().redoCount).toBe(0);
  const target = actions.create("Related target")!;
  actions.relate(key, target, "blocked");
  expect(get().issues.get(key)?.relations).toEqual([{ key: target, kind: "blocked" }]);
  expect(get().issues.get(target)?.relations).toEqual([{ key, kind: "blocking" }]);
  undoEdit();
  expect(get().issues.get(key)?.relations).toBeUndefined();
  expect(get().issues.get(target)?.relations).toBeUndefined();
  redoEdit();
  actions.relate(key, target, "blocked", true);
  expect(get().issues.get(key)?.relations).toEqual([]);
  expect(get().issues.get(target)?.relations).toEqual([]);
  actions.patch(target, { parent: key });
  actions.relate(key, target, "related");
  // Marking an existing relation again changes nothing and logs nothing.
  const logged = get().issues.get(key)?.activity?.length;
  actions.relate(key, target, "related");
  expect(get().issues.get(key)?.relations).toEqual([{ key: target, kind: "related" }]);
  expect(get().issues.get(key)?.activity?.length).toBe(logged);
  actions.remove(key);
  expect(get().issues.get(target)?.parent).toBeUndefined();
  expect(get().issues.get(target)?.relations).toEqual([]);
  undoEdit();
  expect(get().issues.get(target)?.parent).toBe(key);
  expect(get().issues.get(target)?.relations).toEqual([{ key, kind: "related" }]);
  actions.patch(target, { parent: undefined });
  const beforeDrop = get().issues.get(target)!;
  actions.drop(target, 1, [
    { by: "status", id: "Done" },
    { by: "assignee", id: ME.id },
  ]);
  expect(get().issues.get(target)).toMatchObject({ status: "done", assignee: ME });
  undoEdit();
  expect(get().issues.get(target)?.status).toBe(beforeDrop.status);
  expect(get().issues.get(target)?.assignee).toBe(beforeDrop.assignee);
  actions.drop(target, 1, [
    { by: "priority", id: "High" },
    { by: "label", id: "ui" },
    { by: "label", id: "ui" },
  ]);
  expect(get().issues.get(target)?.priority).toBe("High");
  expect(get().issues.get(target)?.labels).toEqual(["ui"]);
  actions.drop(target, 1, [{ by: "parent", id: key }]);
  actions.drop(key, 1, [{ by: "parent", id: target }]);
  expect(get().issues.get(key)?.parent).toBeUndefined();
  actions.drop(target, 2, [{ by: "status", id: "Done" }]);
  expect(get().issues.get(target)?.status).toBe(beforeDrop.status);
});

test("failed issue details expose an error and can be retried", async () => {
  const { get, set, loadFull } = await import("./store");
  const key = "REMOTE-1",
    template = [...get().issues.values()][0]!;
  const full = new Map(get().full);
  full.delete(key);
  set({ full, issues: new Map(get().issues).set(key, { ...template, key }) });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = Object.assign(
      async () => new Response("unavailable", { status: 503 }),
      original,
    );
    await loadFull(key);
    expect(get().fullErrors.get(key)).toBe("Could not load issue details");
    expect(get().full.has(key)).toBe(false);
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({ key, fields: { description: null, comment: { comments: [], total: 0 } } }),
      original,
    );
    await loadFull(key);
    expect(get().full.has(key)).toBe(true);
    expect(get().fullErrors.get(key)).toBe("");
  } finally {
    globalThis.fetch = original;
  }
});

test("browser history restores issue selection without pushing another navigation", async () => {
  const { get, navigate, load } = await import("./store");
  const issues = [...get().issues.values()],
    boards = get().boards;
  const [first, second] = issues;
  const keys = ["location", "history", "window"] as const;
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const originalFetch = globalThis.fetch;
  const page = { href: "http://localhost:3000/?board=1" },
    entries = [page.href];
  let index = 0;
  let popstate: (() => void) | undefined;
  try {
    Object.defineProperty(globalThis, "location", { configurable: true, value: page });
    Object.defineProperty(globalThis, "history", {
      configurable: true,
      value: {
        pushState: (_state: unknown, _title: string, url: URL) => {
          entries.splice(index + 1);
          entries.push(String(url));
          index++;
          page.href = String(url);
        },
        replaceState: (_state: unknown, _title: string, url: URL) => {
          entries[index] = String(url);
          page.href = String(url);
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: (name: string, listener: () => void) => {
          if (name === "popstate") popstate = listener;
        },
      },
    });
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) =>
        Response.json(
          String(input) === "/api/client"
            ? { site: "https://example.atlassian.net", user: { id: "me", name: "Me" } }
            : String(input) === "/api/boards"
              ? boards
              : String(input) === "/api/issues"
                ? issues
                : { entries: {}, progress: { total: 0, pending: 0, completed: 0, errors: 0 } },
        ),
      originalFetch,
    );
    await load();
    navigate({ selected: first!.key, panel: true, view: "page" });
    navigate({ selected: second!.key });
    expect(entries).toHaveLength(3);
    page.href = entries[--index]!;
    popstate!();
    expect(get().selected).toBe(first!.key);
    expect(get().panel).toBe(true);
    expect(get().view).toBe("page");
    expect(entries).toHaveLength(3);
    page.href = entries[++index]!;
    popstate!();
    expect(get().selected).toBe(second!.key);
    navigate({ panel: false });
    expect(new URL(page.href).searchParams.has("issue")).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => {
      const descriptor = descriptors[i];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

test("I7: local comments can be rich, edited and deleted, each step undoable; other authors remain read-only", async () => {
  const { actions, get, set, navigate, undoEdit, ME } = await import("./store");
  const board: Board = {
    id: 7,
    name: "Comments",
    columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }],
  };
  set({ boards: [...get().boards, board] });
  navigate({ board: 7 });
  const key = actions.create("Commented")!;
  const doc = (text: string) => ({
    type: "doc" as const,
    version: 1 as const,
    content: [
      { type: "paragraph", content: [{ type: "text", text, marks: [{ type: "strong" }] }] },
    ],
  });
  expect(actions.comment(key, doc("  "))).toBe(false);
  expect(actions.comment(key, doc("First"))).toBe(true);
  const id = get().full.get(key)!.fields.comment.comments[0].id;
  const { visibleComments } = await import("./comment-thread");
  const comments = () =>
    visibleComments(
      get().full.get(key)!.fields.comment.comments,
      get().issues.get(key)?.commentStates,
    );
  expect(get().full.get(key)!.fields.comment.comments[0].body.content[0].content[0].marks).toEqual([
    { type: "strong" },
  ]);
  actions.editComment(key, id, doc("Edited"));
  expect(comments()[0]!.body.content![0]!.content![0]!.text).toBe("Edited");
  undoEdit();
  expect(comments()[0]!.body.content![0]!.content![0]!.text).toBe("First");
  actions.deleteComment(key, id);
  expect(comments()).toHaveLength(0);
  expect(get().issues.get(key)!.comments).toBe(0);
  undoEdit();
  expect(comments().map((c) => c.id)).toEqual([id]);
  const full = get().full.get(key)!;
  set({
    full: new Map(get().full).set(key, {
      ...full,
      fields: {
        ...full.fields,
        comment: {
          comments: [...full.fields.comment.comments, { id: "10001", body: doc("Jira") }],
          total: 2,
        },
      },
    }),
  });
  actions.editComment(key, "10001", doc("Changed"));
  actions.deleteComment(key, "10001");
  expect(get().full.get(key)!.fields.comment.comments.at(-1).body.content[0].content[0].text).toBe(
    "Jira",
  );
  expect(get().issues.get(key)?.commentStates?.["10001"]).toBeUndefined();
  expect(comments().some((c) => c.id === "10001")).toBe(true);
  expect(comments().find((c) => c.id === "10001")?.body).toEqual(doc("Jira"));
  expect(actions.comment(key, doc("Reply"), id)).toBe(true);
  const replyId = get().full.get(key)!.fields.comment.comments.at(-1).id;
  // Jira threads are one level deep: a reply to a reply joins the root's thread.
  expect(actions.comment(key, doc("Reply to a reply"), replyId)).toBe(true);
  expect(get().full.get(key)!.fields.comment.comments.at(-1).parentId).toBe(id);
  actions.deleteComment(key, id);
  expect(actions.comment(key, doc("Reply to deleted root"), id)).toBe(false);
  void ME;
});

test("R4: autosaved description edits within a minute make one history entry", async () => {
  const { actions, get } = await import("./store");
  const key = actions.create("Described")!;
  for (const text of ["one", "two", "three"]) actions.description(key, text);
  expect(get().issues.get(key)!.description).toBe("three");
  expect(get().issues.get(key)!.descriptionHistory?.length).toBe(1);
});

test("restoring a description keeps the version it replaces, without duplicating the newest entry", async () => {
  const { actions, get } = await import("./store");
  const key = actions.create("Restored")!,
    texts = () =>
      get()
        .issues.get(key)!
        .descriptionHistory!.map((e) => e.text);
  actions.description(key, "one");
  actions.description(key, "two");
  expect(texts()).toEqual([""]);
  actions.description(key, "one", true);
  expect(texts()).toEqual(["", "two"]);
  expect(get().issues.get(key)!.description).toBe("one");
  actions.description(key, "two", true);
  expect(texts()).toEqual(["", "two", "one"]);
  actions.description(key, "one", true);
  expect(texts()).toEqual(["", "two", "one", "two"]);
  actions.description(key, "three");
  actions.description(key, "three-b", true);
  expect(texts()).toEqual(["", "two", "one", "two", "three"]);
  // Edited back to the newest saved version: restoring away from it adds no duplicate.
  actions.description(key, "three");
  actions.description(key, "one", true);
  expect(texts()).toEqual(["", "two", "one", "two", "three"]);
});

test("undoing a reschedule cannot deliver an older reminder again", async () => {
  const { actions, get, undoEdit } = await import("./store");
  const key = actions.create("Reminder history")!,
    now = Date.now;
  try {
    const first = new Date(now() + 3600000).toISOString(),
      second = new Date(now() + 7200000).toISOString();
    actions.remind(key, first);
    actions.remind(key, second);
    Date.now = () => Date.parse(second) + 1;
    actions.deliverReminder(key);
    undoEdit();
    expect(get().issues.get(key)?.reminder).toEqual({ at: first, delivered: true });
  } finally {
    Date.now = now;
  }
});

test("document version checkpoints and personal settings undo independently", async () => {
  const { actions, get, ME, undoEdit, redoEdit } = await import("./store");
  const key = actions.create("Document versions")!,
    body = (text: string) => ({
      type: "doc" as const,
      version: 1 as const,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
  actions.resource(key, {
    id: "document-version-test",
    kind: "document",
    title: "First title",
    body: body("First body"),
    updated: "2000-01-01T00:00:00Z",
    owner: ME,
    editedBy: ME,
  });
  actions.editResource(
    key,
    "document-version-test",
    { title: "Second title", body: body("Second body") },
    "session",
  );
  const read = () => get().issues.get(key)!.resources![0]!;
  expect(read().history).toEqual([
    { title: "First title", body: body("First body"), at: "2000-01-01T00:00:00Z", author: ME },
  ]);
  actions.editResource(
    key,
    "document-version-test",
    { body: body("Second body continued") },
    "session",
  );
  expect(read().history).toHaveLength(1);
  const updated = read().updated;
  actions.documentProperties(key, "document-version-test", {
    owner: { id: "alex", name: "Alex" },
    showAuthors: true,
    subscribers: [ME],
    icon: { name: "calendar", color: "#2d9cdb" },
  });
  expect(read()).toMatchObject({ owner: { name: "Alex" }, showAuthors: true, updated });
  undoEdit();
  expect(read().owner).toEqual(ME);
  expect(read().title).toBe("Second title");
  redoEdit();
  expect(read().owner?.name).toBe("Alex");
});

test("restoring a document version keeps the replaced version even inside the one-minute window, without duplicates", async () => {
  const { actions, get, ME } = await import("./store");
  const key = actions.create("Document restore")!,
    body = (text: string) => ({
      type: "doc" as const,
      version: 1 as const,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
  actions.resource(key, {
    id: "document-restore-test",
    kind: "document",
    title: "Doc",
    body: body("v1"),
    updated: "2000-01-01T00:00:00Z",
    owner: ME,
    editedBy: ME,
  });
  const read = () => get().issues.get(key)!.resources![0]!,
    texts = () => read().history!.map((v) => JSON.stringify(v.body).match(/"text":"([^"]*)"/)?.[1]);
  actions.editResource(key, "document-restore-test", { body: body("v1 v2") }, "session");
  expect(texts()).toEqual(["v1"]);
  actions.editResource(
    key,
    "document-restore-test",
    { title: "Doc", body: body("v1") },
    undefined,
    true,
  );
  expect(texts()).toEqual(["v1", "v1 v2"]);
  expect(JSON.stringify(read().body)).toContain('"v1"');
  actions.editResource(
    key,
    "document-restore-test",
    { title: "Doc", body: body("v1 v2") },
    undefined,
    true,
  );
  expect(texts()).toEqual(["v1", "v1 v2", "v1"]);
  actions.editResource(
    key,
    "document-restore-test",
    { title: "Doc", body: body("v1") },
    undefined,
    true,
  );
  expect(texts()).toEqual(["v1", "v1 v2", "v1", "v1 v2"]);
});

test("a restore never adds a version identical to the newest saved one", async () => {
  const { actions, get, ME } = await import("./store");
  const key = actions.create("Document restore dedupe")!,
    body = (text: string) => ({
      type: "doc" as const,
      version: 1 as const,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
  actions.resource(key, {
    id: "document-dedupe-test",
    kind: "document",
    title: "Doc",
    body: body("v1"),
    updated: "2000-01-01T00:00:00Z",
    owner: ME,
    editedBy: ME,
  });
  const read = () => get().issues.get(key)!.resources![0]!;
  actions.editResource(key, "document-dedupe-test", { body: body("draft") }, "s");
  actions.editResource(key, "document-dedupe-test", { body: body("v1") }, "s");
  expect(read().history).toHaveLength(1);
  actions.editResource(
    key,
    "document-dedupe-test",
    { title: "Doc", body: body("other") },
    undefined,
    true,
  );
  expect(read().history).toHaveLength(1);
});

test("image crops and comment counts undo and redo without changing the description", async () => {
  const { actions, get, undoEdit, redoEdit } = await import("./store");
  const { commentCount } = await import("./media-edits");
  const key = actions.create("Image edits", { description: "Original description" })!;
  const original = get().full.get(key)?.fields.description;
  const crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  actions.mediaEdit(key, "media-id", { crop });
  const comments = [
    { id: "review", text: "Image review", author: "Me", at: "2026-11-07T00:00:00Z" },
  ];
  actions.mediaEdit(key, "media-id", { crop, comments });
  expect(commentCount(get().issues.get(key)!)).toBe(1);
  undoEdit();
  expect(get().issues.get(key)?.mediaEdits?.["media-id"]).toEqual({ crop });
  expect(get().issues.get(key)?.comments).toBe(0);
  undoEdit();
  expect(get().issues.get(key)?.mediaEdits).toBeUndefined();
  redoEdit();
  redoEdit();
  expect(get().issues.get(key)?.mediaEdits?.["media-id"]).toEqual({ crop, comments });
  expect(commentCount(get().issues.get(key)!)).toBe(1);
  expect(get().issues.get(key)?.comments).toBe(0);
  expect(get().full.get(key)?.fields.description).toEqual(original);
});

test("B5: creating stays on the board with a toast, Create more toasts too, and undoing the create closes it", async () => {
  const { actions, get, navigate, ui, undoEdit } = await import("./store");
  navigate({ panel: false, selected: null });
  ui.send({ type: "toast.dismiss" });
  const key = actions.create("Toasted")!;
  expect(get().panel).toBe(false);
  expect(get().selected).toBe(key);
  expect(get().toast).toEqual({ text: `Created ${key}`, key });
  ui.send({ type: "toast.dismiss" });
  const more = actions.create("Created with more", {}, true)!;
  expect(get().toast).toEqual({ text: `Created ${more}`, key: more });
  undoEdit();
  expect(get().issues.has(more)).toBe(false);
  expect(get().toast).toBeNull();
});
test("deleting a sub-issue keeps its open parent; with Jira writes it asks in the app first", async () => {
  const { actions, get, navigate, set } = await import("./store");
  const parent = actions.create("Parent")!,
    child = actions.create("Child", { parent })!;
  navigate({ selected: parent, panel: true });
  const realFetch = globalThis.fetch;
  // The confirmed delete is sent; answer it here so no real request is left in flight for later tests.
  globalThis.fetch = (async () =>
    Response.json({ created: {}, others: [], issue: null })) as unknown as typeof fetch;
  set({ writable: true });
  try {
    const before = get().issues;
    actions.remove(parent);
    expect(get().deleting).toBe(parent);
    expect(get().issues).toBe(before);
    expect(get().pendingWrites).toBe(0);
    set({ deleting: null }); // Escape/cancel only clears the request.
    expect(get().issues.has(parent)).toBe(true);
    actions.remove(child);
    expect(get().deleting).toBe(child);
    expect(get().issues.has(child)).toBe(true);
    set({ deleting: null });
    actions.remove(child, true);
    for (let i = 0; i < 50 && get().pendingWrites; i++) await Bun.sleep(10);
  } finally {
    set({ writable: false });
    globalThis.fetch = realFetch;
  }
  expect(get().issues.has(child)).toBe(false);
  expect(get().selected).toBe(parent);
  expect(get().panel).toBe(true);
});
test("deleting a document keeps attachments that another document still shows", async () => {
  const { actions, get, set, ME } = await import("./store");
  const key = actions.create("Shared media")!,
    media = (id: string) => ({
      type: "doc" as const,
      version: 1 as const,
      content: [{ type: "mediaSingle", content: [{ type: "media", attrs: { id, type: "file" } }] }],
    });
  set({
    issues: new Map(get().issues).set(key, {
      ...get().issues.get(key)!,
      attachments: [
        { id: "shared", name: "shared.png", type: "image/png", size: 1, url: "" },
        { id: "own", name: "own.png", type: "image/png", size: 1, url: "" },
      ],
    }),
  });
  actions.resource(key, {
    id: "original",
    kind: "document",
    title: "Original",
    body: { ...media("shared"), content: [...media("shared").content, ...media("own").content] },
    updated: "2000-01-01T00:00:00Z",
    owner: ME,
  });
  actions.resource(key, {
    id: "copy",
    kind: "document",
    title: "Copy",
    body: media("shared"),
    updated: "2000-01-01T00:00:00Z",
    owner: ME,
  });
  actions.removeResource(key, "original");
  expect(
    get()
      .issues.get(key)!
      .attachments!.map((a) => a.id),
  ).toEqual(["shared"]);
});

test("the property poll comes back in 3s while Jira syncs, 30s once settled and 10s after a failure", async () => {
  const { pollDelay } = await import("./store");
  expect([pollDelay(false, 5), pollDelay(false, 0), pollDelay(true, 5)]).toEqual([
    3000, 30000, 10000,
  ]);
});

test("Jira's remote links become link resources: a writable site takes Jira's set, a read-only one only adds", async () => {
  const { withJiraLinks } = await import("./store");
  const doc = { id: "d", kind: "document" as const, title: "Doc", updated: "" },
    link = (url: string, title: string) => ({
      id: url,
      kind: "link" as const,
      url,
      title,
      updated: "",
    });
  const local = [doc, link("https://a", "A"), link("https://gone", "Gone")],
    jira = [
      { url: "https://a", title: "A2" },
      { url: "https://new", title: "New" },
    ];
  const shown = (r: any[] | undefined) => r!.map((x) => `${x.kind}:${x.url ?? x.id}:${x.title}`);
  expect(shown(withJiraLinks(local, jira, true))).toEqual([
    "document:d:Doc",
    "link:https://a:A2",
    "link:https://new:New",
  ]);
  expect(shown(withJiraLinks(local, jira, false))).toEqual([
    "document:d:Doc",
    "link:https://a:A2",
    "link:https://gone:Gone",
    "link:https://new:New",
  ]);
  expect(withJiraLinks(local, undefined, true)).toBe(local);
});

test("R1-D71: adding a URL the issue already has reports it instead of adding it again", async () => {
  const { actions, get, set } = await import("./store");
  const issue = {
    key: "D71-1",
    board: 1,
    summary: "Links",
    status: "todo",
    assignee: null,
    labels: [],
    comments: 0,
    updated: "",
    resolved: null,
  };
  set({ issues: new Map(get().issues).set(issue.key, issue) });
  const link = { kind: "link" as const, title: "A", url: "https://a.test/", updated: "" };
  expect(actions.resource(issue.key, { ...link, id: "1" })).toBe(true);
  expect(actions.resource(issue.key, { ...link, id: "2" })).toBe(false);
  expect(
    get()
      .issues.get(issue.key)!
      .resources!.map((r) => r.id),
  ).toEqual(["1"]);
});

test("R1-D101: deleting an issue sends no link removals for the issues it was linked to", async () => {
  const { actions, get, set } = await import("./store");
  const sent: { key: string; ops: any[] }[] = [],
    realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = decodeURIComponent(String(input).match(/\/api\/issues\/([^/]+)\/ops$/)?.[1] ?? "");
    const { ops } = JSON.parse(String(init?.body));
    sent.push({ key, ops });
    return Response.json({
      key,
      created: {},
      others: [],
      issue: ops[0]?.op === "delete" ? null : get().issues.get(key),
    });
  }) as typeof fetch;
  try {
    const issue = (key: string, related: string) => ({
      key,
      board: 1,
      summary: key,
      status: "todo",
      assignee: null,
      labels: [],
      comments: 0,
      updated: "",
      resolved: null,
      relations: [{ key: related, kind: "related" }],
    });
    set({
      writable: true,
      issues: new Map(get().issues)
        .set("DEL-1", issue("DEL-1", "DEL-2"))
        .set("DEL-2", issue("DEL-2", "DEL-1")),
    });
    actions.remove("DEL-1", true);
    for (let i = 0; i < 50 && get().pendingWrites; i++) await Bun.sleep(10);
    expect(sent).toEqual([{ key: "DEL-1", ops: [{ op: "delete" }] }]);
  } finally {
    set({ writable: false });
    globalThis.fetch = realFetch;
  }
});

test("R2-palette-shortcuts-D3: a timed action that posts its own message, such as a refused edit, keeps it", async () => {
  const { timed, get, set } = await import("./store");
  // After the frame and timeout `timed` posts in: equal-delay timers run in order, so this never races it under load.
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
  // An earlier test's timed message lands first, not mid-test.
  await frame();
  timed("edit KAN-1", () => set({ perf: "Local editing is paused until saved data is available" }));
  await frame();
  expect(get().perf).toBe("Local editing is paused until saved data is available");
  timed("edit KAN-1", () => {});
  await frame();
  expect(get().perf).toStartWith("edit KAN-1 · ");
});

test("sync review 4: learning a new issue's Jira key keeps the edits made on both its keys", async () => {
  const { actions, get, set, learnKeys } = await import("./store");
  const key = actions.create("Mine")!;
  // The poll brought the issue under its Jira key before this tab learnt the move, and the user edited that copy.
  set({
    issues: new Map(get().issues).set("TEST-77", {
      ...get().issues.get(key)!,
      key: "TEST-77",
      summary: "Jira's",
      priority: "Normal",
    }),
  });
  actions.patch("TEST-77", { priority: "Highest" });
  learnKeys({ [key]: "TEST-77" });
  expect(get().issues.has(key)).toBe(false);
  expect(get().issues.get("TEST-77")).toMatchObject({ summary: "Mine", priority: "Highest" });
});

test("sync review 7: an undo made while Restore reads Jira's version is not discarded by the Restore", async () => {
  const { actions, get, set, undoEdit } = await import("./store");
  const issue = { ...[...get().issues.values()][0]!, key: "TEST-91", priority: "Low" };
  set({ issues: new Map(get().issues).set("TEST-91", issue) });
  actions.patch("TEST-91", { priority: "High" });
  actions.patch("TEST-91", { priority: "Highest" });
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    await answered;
    return Response.json(
      String(input).endsWith("/api/issues") ? [issue] : { key: "TEST-91", fields: {} },
    );
  }) as any;
  try {
    const restoring = actions.restoreJira("TEST-91");
    await Bun.sleep(5);
    undoEdit();
    answer();
    await restoring;
    expect(get().issues.get("TEST-91")?.priority).toBe("High");
    expect(get().toast?.text).toBe("Didn't restore TEST-91");
  } finally {
    globalThis.fetch = previous;
  }
});

test("sync review 2: a tab never mints a new-issue number another tab of the browser has", async () => {
  const { actions, get } = await import("./store");
  const { LocalDatabase } = await import("./local-data");
  expect(get().namespace).toBeTruthy();
  // Another tab of this browser takes numbers from the same saved data while this one creates issues.
  const other = await LocalDatabase.open(get().namespace);
  const theirs = new Set<number>(),
    mine: number[] = [];
  try {
    for (let i = 0; i < 60; i++) {
      if (i % 20 === 0) {
        const first = await other.reserve(50);
        for (let n = first; n < first + 50; n++) theirs.add(n);
      }
      mine.push(Number(actions.create(`N${i}`)!.match(/-NEW(\d+)$/)![1]));
      await Bun.sleep(1);
    }
  } finally {
    other.close();
  }
  expect(new Set(mine).size).toBe(60);
  expect(mine.filter((n) => theirs.has(n))).toEqual([]);
});

test("sync review 3-2: a write Jira can't settle yet backs off behind other issues' writes, keeps its issue's order, and shows after a few tries", async () => {
  const { setSystemTime } = await import("bun:test");
  const { actions, get, set } = await import("./store");
  const sent: { key: string; ops: any[]; resend?: boolean }[] = [],
    realFetch = globalThis.fetch;
  let jiraDown = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = decodeURIComponent(String(input).match(/\/api\/issues\/([^/]+)\/ops$/)?.[1] ?? "");
    const { ops, resend } = JSON.parse(String(init?.body));
    sent.push({ key, ops, ...(resend ? { resend } : {}) });
    if (key === "RT-1" && jiraDown)
      return Response.json({ error: "Jira didn't answer.", retry: true }, { status: 503 });
    return Response.json({ key, created: {}, others: [], issue: get().issues.get(key) });
  }) as typeof fetch;
  const issue = (key: string) => ({
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
  });
  let now = Date.now();
  const later = async (ms: number) => {
    setSystemTime((now += ms));
    await Bun.sleep(1100);
  };
  try {
    set({
      writable: true,
      issues: new Map(get().issues).set("RT-1", issue("RT-1")).set("RT-2", issue("RT-2")),
    });
    setSystemTime(now);
    actions.patch("RT-1", { priority: "High" });
    await Bun.sleep(50);
    actions.patch("RT-1", { priority: "Highest" });
    actions.patch("RT-2", { priority: "High" });
    await Bun.sleep(300);
    // RT-2 isn't held up by RT-1; RT-1's second write stays behind its first.
    expect(sent.map((s) => s.key)).toEqual(["RT-1", "RT-2"]);
    for (let i = 0; i < 3; i++) await later(61_000);
    expect(sent.map((s) => s.key)).toEqual(["RT-1", "RT-2", "RT-1", "RT-1", "RT-1"]);
    // The resends say so, and after a few the error shows, with the write still kept.
    expect(sent.at(-1)!.resend).toBe(true);
    expect(get().writeError).toMatchObject({ key: "RT-1", retrying: true });
    expect(get().pendingWrites).toBe(2);
    jiraDown = false;
    await later(61_000);
    await Bun.sleep(300);
    expect(sent.slice(-2).map((s) => [s.key, s.ops])).toEqual([
      ["RT-1", [{ op: "fields", fields: { priority: "High" } }]],
      ["RT-1", [{ op: "fields", fields: { priority: "Highest" } }]],
    ]);
    expect([get().pendingWrites, get().writeError]).toEqual([0, null]);
  } finally {
    setSystemTime();
    set({ writable: false });
    globalThis.fetch = realFetch;
  }
}, 20_000);
