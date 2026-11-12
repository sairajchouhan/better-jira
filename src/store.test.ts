import { latestNotification, NOTIFICATION_ID } from "./app-notifications";
import { toasts } from "./toast-queue";
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
// Tests after load() navigate; give them a browser with a history stack, sessionStorage and window events.
const page = { entries: ["http://localhost:3000/"], index: 0 };
const windowListeners = new Map<string, () => void>();
const session = new Map<string, string>();
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: {
    get href() {
      return page.entries[page.index]!;
    },
    get pathname() {
      return new URL(page.entries[page.index]!).pathname;
    },
    origin: "http://localhost:3000",
  },
});
Object.defineProperty(globalThis, "history", {
  configurable: true,
  value: {
    state: null,
    pushState: (_s: unknown, _t: string, url: URL) => {
      page.entries.splice(page.index + 1);
      page.entries.push(String(url));
      page.index++;
    },
    replaceState: (_s: unknown, _t: string, url: URL) => {
      page.entries[page.index] = String(url);
    },
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { addEventListener: (name: string, listener: () => void) => windowListeners.set(name, listener) },
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => session.set(key, value),
    removeItem: (key: string) => session.delete(key),
  },
});
/** The browser's Back (-1) or Forward (+1) button. */
const travel = (step: number) => {
  page.index += step;
  windowListeners.get("popstate")!();
};
/** Opens an address as a fresh tab history, through the same restore a reload or link uses. */
const visit = (url: string) => {
  page.entries = [new URL(url, "http://localhost:3000").href];
  page.index = 0;
  windowListeners.get("popstate")!();
};
const address = () => {
  const url = new URL(location.href);
  return url.pathname + url.search;
};

test("personal issue edits, comments, creation and deletion undo without losing issue details", async () => {
  const { actions, get, set, undoEdit, redoEdit, ME } = await import("./store");
  const { navigate } = await import("./app-navigation");
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
  const { get, load } = await import("./store");
  const { navigate } = await import("./app-navigation");
  const issues = [...get().issues.values()],
    boards = get().boards;
  const [first, second] = issues;
  const originalFetch = globalThis.fetch;
  page.entries = ["http://localhost:3000/?board=1"];
  page.index = 0;
  try {
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) =>
        Response.json(
          String(input) === "/api/client"
            ? { site: "https://example.atlassian.net", user: { id: "me", name: "Me" } }
            : String(input) === "/api/boards"
              ? boards
              : String(input).startsWith("/api/views") ? [] : String(input) === "/api/issues"
                ? issues
                : { entries: {}, progress: { total: 0, pending: 0, completed: 0, errors: 0 } },
        ),
      originalFetch,
    );
    await load();
    navigate({ selected: first!.key, panel: true, view: "page" });
    navigate({ selected: second!.key });
    expect(page.entries).toHaveLength(3);
    travel(-1);
    expect(get().selected).toBe(first!.key);
    expect(get().panel).toBe(true);
    expect(get().view).toBe("page");
    expect(page.entries).toHaveLength(3);
    travel(1);
    expect(get().selected).toBe(second!.key);
    navigate({ panel: false });
    expect(new URL(location.href).searchParams.has("issue")).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("I7: local comments can be rich, edited and deleted, each step undoable; other authors remain read-only", async () => {
  const { actions, get, set, undoEdit, ME } = await import("./store");
  const { navigate } = await import("./app-navigation");
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
  const { actions, get, undoEdit } = await import("./store");
  const { navigate } = await import("./app-navigation");
  navigate({ panel: false, selected: null });
  toasts.dismiss(NOTIFICATION_ID);
  const key = actions.create("Toasted")!;
  expect(get().panel).toBe(false);
  expect(get().selected).toBe(key);
  expect(latestNotification()).toEqual({ text: `Created ${key}`, key });
  expect(toasts.find(NOTIFICATION_ID)).toBeDefined();
  expect(toasts.has(NOTIFICATION_ID)).toBe(true);
  toasts.dismiss(NOTIFICATION_ID);
  const more = actions.create("Created with more", {}, true)!;
  expect(latestNotification()).toEqual({ text: `Created ${more}`, key: more });
  undoEdit();
  expect(get().issues.has(more)).toBe(false);
  expect(latestNotification()).toBeUndefined();
});
test("deleting a sub-issue keeps its open parent; with Jira writes it asks in the app first", async () => {
  const { actions, get, set } = await import("./store");
  const { navigate } = await import("./app-navigation");
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
    expect(latestNotification()?.text).toBe("Didn't restore TEST-91");
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

/** A stand-in for the server's write route: records each request; `reply` shapes (or holds) Jira's answer. */
async function fakeJiraWrites(
  reply: (key: string, body: any) => Promise<object> | object = () => ({}),
) {
  const { get } = await import("./store");
  const sent: { key: string; ops: any[]; settle?: boolean }[] = [],
    realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = decodeURIComponent(String(input).match(/\/api\/issues\/([^/]+)\/ops$/)?.[1] ?? "");
    const body = JSON.parse(String(init?.body));
    sent.push({ key, ops: body.ops, ...("settle" in body ? { settle: body.settle } : {}) });
    return Response.json({
      key,
      created: {},
      others: [],
      issue: get().issues.get(key),
      ...(await reply(key, body)),
    });
  }) as typeof fetch;
  const settled = async () => {
    for (let i = 0; i < 200 && get().pendingWrites; i++) await Bun.sleep(10);
  };
  return { sent, settled, restore: () => void (globalThis.fetch = realFetch) };
}
const writableIssue = (key: string, extra: object = {}) => ({
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

test("outbox: an issue's edits queued behind its write in flight merge into one write, sent after it; other issues go in order", async () => {
  const { actions, get, set } = await import("./store");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const jira = await fakeJiraWrites(async (key, body) => {
    if (key === "OQ-1" && body.ops[0]?.fields?.priority === "High") await gate;
    return {};
  });
  try {
    set({
      writable: true,
      issues: new Map(get().issues).set("OQ-1", writableIssue("OQ-1")).set("OQ-2", writableIssue("OQ-2")),
    });
    actions.patch("OQ-1", { priority: "High" });
    await Bun.sleep(5);
    actions.patch("OQ-1", { priority: "Highest" });
    actions.patch("OQ-1", { labels: ["one"] });
    actions.patch("OQ-2", { priority: "High" });
    expect(get().pendingWrites).toBe(3);
    release();
    await jira.settled();
    expect(jira.sent).toEqual([
      { key: "OQ-1", ops: [{ op: "fields", fields: { priority: "High" } }] },
      { key: "OQ-1", ops: [{
        op: "fields",
        fields: { priority: "Highest", labelEdits: { add: ["one"], remove: [] } },
      },] },
      { key: "OQ-2", ops: [{ op: "fields", fields: { priority: "High" } }] },
    ]);
    expect(get().writeError).toBeNull();
  } finally {
    set({ writable: false });
    jira.restore();
  }
});

test("outbox: rapid status changes reach Jira as one transition", async () => {
  const { actions, get, set } = await import("./store");
  const jira = await fakeJiraWrites();
  try {
    set({
      writable: true,
      boards: get().boards.some((b) => b.id === 1)
        ? get().boards
        : [
            ...get().boards,
            {
              id: 1,
              name: "Personal",
              columns: [
                { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
                { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
              ],
            },
          ],
      issues: new Map(get().issues).set("OS-1", writableIssue("OS-1")),
    });
    actions.status("OS-1", "done");
    await Bun.sleep(100);
    actions.status("OS-1", "todo");
    await Bun.sleep(100);
    actions.status("OS-1", "done");
    // The hold restarts with each change (the exact timing is in outbox.test.ts).
    await Bun.sleep(250);
    expect(jira.sent).toEqual([]);
    await jira.settled();
    expect(jira.sent.map((s) => s.ops)).toEqual([[{ op: "status", status: "done" }]]);
  } finally {
    set({ writable: false });
    jira.restore();
  }
});

test("outbox: a write Jira refuses rolls the issue back to Jira's copy and says why", async () => {
  const { actions, get, set } = await import("./store");
  const jira = await fakeJiraWrites((key) => ({
    error: "Priority is locked.",
    issue: writableIssue(key),
  }));
  try {
    set({ writable: true, issues: new Map(get().issues).set("RB-1", writableIssue("RB-1")) });
    actions.patch("RB-1", { priority: "High" });
    expect(get().issues.get("RB-1")?.priority).toBe("High");
    await jira.settled();
    expect(get().issues.get("RB-1")?.priority).toBe("Low");
    expect(get().writeError).toEqual({ key: "RB-1", text: "Priority is locked." });
    expect(latestNotification()).toMatchObject({
      text: "Jira did not save the change to RB-1",
      detail: "Priority is locked.",
    });
  } finally {
    set({ writable: false, writeError: null });
    jira.restore();
  }
});

test("outbox: an issue created here takes Jira's key, and writes queued under its app key follow it there", async () => {
  const { actions, get, set, currentKey, firstKey } = await import("./store");
  const { navigate } = await import("./app-navigation");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const jira = await fakeJiraWrites(async (key, body) => {
    if (body.ops[0]?.op !== "create") return {};
    await gate;
    return { key: "MADE-7", created: { [key]: "MADE-7" }, issue: { ...get().issues.get(key)!, key: "MADE-7" } };
  });
  try {
    set({ writable: true });
    navigate({ board: 1 });
    const key = actions.create("Made here")!;
    await Bun.sleep(5);
    actions.patch(key, { priority: "Highest" });
    release();
    await jira.settled();
    expect(jira.sent.map((s) => [s.key, s.ops[0].op])).toEqual([
      [key, "create"],
      ["MADE-7", "fields"],
    ]);
    expect(jira.sent[1]!.ops).toEqual([{ op: "fields", fields: { priority: "Highest" } }]);
    expect(get().issues.has(key)).toBe(false);
    expect(get().issues.get("MADE-7")).toMatchObject({ summary: "Made here", priority: "Highest" });
    expect([currentKey(key), firstKey("MADE-7")]).toEqual(["MADE-7", key]);
  } finally {
    set({ writable: false });
    jira.restore();
  }
});

test("opening saved views and changing their overlay never writes board preferences", async () => {
  const { get, set } = await import("./store");
  const { openSavedView, navigate } = await import("./app-navigation");
  const { setRule, viewSettings, effectiveSettings } = await import("./view-settings");
  const { defaultPreferences } = await import("./view-model");
  const p = defaultPreferences();
  const view = {id:"identity-test",board:1,kind:"custom" as const,name:"Identity",description:"",icon:"filter",color:"gray",filters:{...p.filters,children:[{id:"saved",field:"status" as const,op:"is" as const,values:["todo"]}]},display:{...p.display,openIn:"page" as const},scope:p.scope,mine:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  set({preferences:{1:p}, savedViews:[view]});
  const before = JSON.stringify(get().preferences);
  openSavedView(view);
  expect(get().activeViewId).toBe(view.id);
  expect(viewSettings(1).filters.children).toHaveLength(0);
  expect(effectiveSettings(1).filters.children).toHaveLength(1);
  setRule(1,{id:"temp",field:"labels",op:"is",values:["urgent"]});
  expect(JSON.stringify(get().preferences)).toBe(before);
  expect(effectiveSettings(1).filters.children).toHaveLength(2);
  const second = {...view,id:"second-identity",display:{...view.display,layout:"list" as const}};
  set({savedViews:[view,second]});
  openSavedView(second);
  expect(get().activeViewId).toBe(second.id);
  expect(get().overlayFilters.children).toHaveLength(0);
  expect(JSON.stringify(get().preferences)).toBe(before);
  navigate({board:1});
  expect(get().activeViewId).toBeNull();
  expect(JSON.stringify(get().preferences)).toBe(before);
});

const viewFixture = async (patch: Record<string, unknown> = {}) => {
  const { defaultPreferences } = await import("./view-model");
  const p = defaultPreferences();
  const at = new Date().toISOString();
  return {id:"v-source",board:1,kind:"custom" as const,name:"Source",description:"",icon:"filter",color:"gray",filters:{...p.filters,children:[{id:"saved",field:"status" as const,op:"is" as const,values:["todo"]}]},display:p.display,scope:p.scope,mine:false,createdAt:at,updatedAt:at,...patch};
};
const withFetch = async (respond: (url: string, init?: RequestInit) => unknown, run: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => Response.json(respond(String(input), init)), original);
  try { await run(); } finally { globalThis.fetch = original; }
};

test("BJ-128: Save to this view refuses an overlay the saved base excludes", async () => {
  const { get, set } = await import("./store");
  const { openSavedView, setOverlay } = await import("./app-navigation");
  const { saveOverlayToView } = await import("./saved-views");
  const view = await viewFixture();
  set({ savedViews: [view] });
  openSavedView(view);
  setOverlay({ id: "overlay", join: "and", children: [{ id: "o", field: "status", op: "is", values: ["progress"] }] });
  let writes = 0;
  await withFetch(() => (writes++, view), async () => {
    await expect(saveOverlayToView()).rejects.toThrow("Cannot merge these filters into the view");
  });
  expect(writes).toBe(0);
  expect(get().savedViews[0]!.filters).toEqual(view.filters);
  expect(get().overlayFilters.children).toHaveLength(1);
});

test("BJ-132: a new custom view starts as a list with details open; a tab keeps the board layout", async () => {
  const { get, set } = await import("./store");
  const { navigate, openSavedView } = await import("./app-navigation");
  const { createViewDraft, createSavedView } = await import("./saved-views");
  const { setDisplay } = await import("./view-settings");
  navigate({ board: 1 });
  setDisplay(1, { layout: "board" });
  set({ details: false });
  expect(createViewDraft("tab").display.layout).toBe("board");
  const draft = createViewDraft("custom");
  expect(draft.display.layout).toBe("list");
  await withFetch((_url, init) => ({ ...JSON.parse(String(init?.body)), id: "fresh", createdAt: "", updatedAt: "" }), async () => {
    await createSavedView({ ...draft, name: "Fresh" });
  });
  openSavedView("fresh");
  expect(get().details).toBe(true);
  navigate({ board: 1 });
  expect(get().details).toBe(false);
});

test("BJ-142: a custom view remembers its details panel; boards keep their own", async () => {
  const { get, set } = await import("./store");
  const { navigate, openSavedView } = await import("./app-navigation");
  const view = await viewFixture({ id: "details-view" });
  set({ savedViews: [view] });
  navigate({ board: 1 });
  set({ details: false });
  openSavedView(view);
  expect(get().details).toBe(false);
  set({ details: true });
  navigate({ board: 1 });
  expect(get().details).toBe(false);
  openSavedView(view);
  expect(get().details).toBe(true);
  set({ details: false });
  navigate({ board: 1 });
  set({ details: true });
  openSavedView(view);
  expect(get().details).toBe(false);
  navigate({ board: 1 });
  expect(get().details).toBe(true);
});

test("BJ-142: deleting the active view lands on the board's All issues", async () => {
  const { get, set } = await import("./store");
  const { navigate, openSavedView } = await import("./app-navigation");
  const { deleteSavedView } = await import("./saved-views");
  const { setScope, viewSettings } = await import("./view-settings");
  const view = await viewFixture({ id: "doomed", scope: "active" as const });
  set({ savedViews: [view] });
  navigate({ board: 1 });
  setScope(1, "backlog");
  openSavedView(view);
  await withFetch(() => ({}), () => deleteSavedView(view.id));
  expect(get().activeViewId).toBeNull();
  expect(get().savedViews).toHaveLength(0);
  expect(viewSettings(1).scope).toBe("all");
  expect(new URL(location.href).pathname).toBe("/");
});

test("BJ-133: Cancel on a duplicate draft returns to the source view", async () => {
  const { get, set } = await import("./store");
  const { openSavedView, beginViewEditor, discardViewEditor } = await import("./app-navigation");
  const { duplicateViewDraft } = await import("./saved-views");
  const view = await viewFixture();
  set({ savedViews: [view] });
  openSavedView(view);
  beginViewEditor(duplicateViewDraft(view.id));
  expect(get().activeViewId).toBeNull();
  discardViewEditor();
  expect(get().editorDraft).toBeNull();
  expect(get().activeViewId).toBe(view.id);
});

test("BJ-137: the view address is /view/<slug>-<id> and follows a rename", async () => {
  const { set } = await import("./store");
  const { openSavedView } = await import("./app-navigation");
  const { updateSavedView } = await import("./saved-views");
  const view = await viewFixture({ id: "8f1c", name: "My Triage!" });
  set({ savedViews: [view] });
  openSavedView(view);
  expect(new URL(location.href).pathname).toBe("/view/my-triage-8f1c");
  await withFetch(() => ({ ...view, name: "Bugs only" }), async () => {
    await updateSavedView(view.id, { name: "Bugs only" });
  });
  expect(new URL(location.href).pathname).toBe("/view/bugs-only-8f1c");
});

test("view settings: removing a rule on a saved view edits only its overlay", async () => {
  const { get, set } = await import("./store");
  const { navigate, openSavedView } = await import("./app-navigation");
  const { setRule, updateRule, viewSettings, effectiveSettings } = await import("./view-settings");
  const view = await viewFixture({ id: "overlay-remove" });
  set({ savedViews: [view] });
  navigate({ board: 1 });
  const before = JSON.stringify(get().preferences);
  openSavedView(view);
  setRule(1, { id: "a", field: "labels", op: "is", values: ["urgent"] });
  setRule(1, { id: "b", field: "priority", op: "is", values: ["High"] });
  updateRule(1, "a", null);
  expect(get().overlayFilters.children.map((c) => c.id)).toEqual(["b"]);
  expect(viewSettings(1).filters.children.map((c) => c.id)).toEqual(["b"]);
  expect(effectiveSettings(1).filters.children.map((c) => ("field" in c ? c.field : ""))).toEqual(["status", "priority"]);
  expect(get().savedViews[0]!.filters).toEqual(view.filters);
  expect(JSON.stringify(get().preferences)).toBe(before);
});

test("view settings: clear on a saved view keeps its base filter", async () => {
  const { get, set } = await import("./store");
  const { navigate, openSavedView } = await import("./app-navigation");
  const { clearFilters, setRule, effectiveSettings } = await import("./view-settings");
  const view = await viewFixture({ id: "overlay-clear" });
  set({ savedViews: [view] });
  navigate({ board: 1 });
  openSavedView(view);
  setRule(1, { id: "a", field: "labels", op: "is", values: ["urgent"] });
  clearFilters(1);
  expect(get().overlayFilters.children).toHaveLength(0);
  expect(get().savedViews[0]!.filters).toEqual(view.filters);
  expect(effectiveSettings(1).filters.children.map((c) => c.id)).toEqual(["saved"]);
});

test("view settings: an edit in the view editor goes to the draft", async () => {
  const { get, set } = await import("./store");
  const { navigate, beginViewEditor, discardViewEditor } = await import("./app-navigation");
  const { createViewDraft } = await import("./saved-views");
  const { setRule, setDisplay, setScope, clearFilters, viewSettings } = await import("./view-settings");
  navigate({ board: 1 });
  set({ savedViews: [] });
  const before = JSON.stringify(get().preferences);
  beginViewEditor(createViewDraft("custom", 1));
  setRule(1, { id: "a", field: "labels", op: "is", values: ["urgent"] });
  setDisplay(1, { layout: "board" });
  setScope(1, "backlog");
  expect(get().editorDraft!.filters.children.map((c) => c.id)).toEqual(["a"]);
  expect(get().editorDraft!.display.layout).toBe("board");
  expect(get().editorDraft!.scope).toBe("backlog");
  expect(viewSettings(1).filters.children.map((c) => c.id)).toEqual(["a"]);
  clearFilters(1);
  expect(get().editorDraft!.filters.children).toHaveLength(0);
  expect(JSON.stringify(get().preferences)).toBe(before);
  discardViewEditor();
});

// Characterization of screen navigation: what each step shows, which address it leaves and which history entries exist.
const navigationFixture = async () => {
  const store = await import("./store");
  const { defaultPreferences } = await import("./view-model");
  const columns = [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }];
  const template = [...store.get().issues.values()][0]!;
  const issues = new Map(store.get().issues);
  for (const [key, board] of [["NAV-1", 1], ["NAV-2", 1], ["NAV-3", 2]] as const)
    issues.set(key, { ...template, key, board, parent: undefined });
  store.set({
    boards: [{ id: 1, name: "Personal", columns }, { id: 2, name: "Second", columns }],
    issues,
    preferences: { 1: defaultPreferences(), 2: defaultPreferences() },
    savedViews: [],
  });
  visit("/?board=1");
  page.entries = [page.entries[0]!];
  session.clear();
  const trace = () => {
    const s = store.get();
    return {
      address: address(),
      entries: page.index + 1 + "/" + page.entries.length,
      board: s.board,
      view: s.view,
      selected: s.selected,
      panel: s.panel,
      document: s.document,
      inbox: s.inbox,
      mine: s.mine,
      viewsPage: s.viewsPage,
      activeViewId: s.activeViewId,
      overlayFilters: s.overlayFilters.children.length,
      draft: s.editorDraft ? `${s.editorDraft.name || "new"}:${s.editorDraft.display.openIn}` : null,
      boardOpenIn: `${s.preferences[1]?.display.openIn}/${s.preferences[2]?.display.openIn}`,
    };
  };
  return { ...store, ...(await import("./saved-views")), ...(await import("./app-navigation")), trace };
};
const savedView = async (patch: Record<string, unknown>) => {
  const v = await viewFixture(patch);
  return { ...v, display: { ...v.display, ...(patch.display as object) } };
};
const recordRequests = () => {
  const original = globalThis.fetch,
    requests: string[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${String(input)} ${init?.body ?? ""}`);
    return String(input).startsWith("/api/views/")
      ? Response.json({ ...JSON.parse(String(init?.body ?? "{}")), id: String(input).split("/").pop() })
      : Response.json({});
  }, original);
  return { requests, restore: () => (globalThis.fetch = original) };
};

test("navigation: back and forward restore each screen without adding entries", async () => {
  const { navigate, openSavedView, set, get, trace } = await navigationFixture();
  const view = await savedView({ id: "nav-view", name: "Nav view", board: 2 });
  set({ savedViews: [view] });
  const steps = [trace()];
  navigate({ selected: "NAV-1", panel: true });
  steps.push(trace());
  navigate({ board: 2, selected: null, panel: false });
  steps.push(trace());
  openSavedView(view);
  steps.push(trace());
  navigate({ inbox: true, selected: null, panel: false });
  steps.push(trace());
  travel(-1);
  steps.push(trace());
  travel(-1);
  steps.push(trace());
  travel(-1);
  steps.push(trace());
  travel(1);
  steps.push(trace());
  travel(1);
  steps.push(trace());
  expect(get().activeViewId).toBe(view.id);
  expect(steps).toMatchInlineSnapshot(`
    [
      {
        "activeViewId": null,
        "address": "/?board=1",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "1/1",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=side",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "3/3",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": "nav-view",
        "address": "/view/nav-view-nav-view?board=2",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "4/4",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2&inbox=1",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "5/5",
        "inbox": true,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": "nav-view",
        "address": "/view/nav-view-nav-view?board=2",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "4/5",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "3/5",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=side",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "2/5",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "3/5",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": "nav-view",
        "address": "/view/nav-view-nav-view?board=2",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "4/5",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
    ]
  `);
});

test("navigation: issues open beside the board or as a page, and the board remembers the choice", async () => {
  const { navigate, ui, trace } = await navigationFixture();
  const steps = [];
  navigate({ selected: "NAV-1", panel: true });
  steps.push(trace());
  navigate({ view: "page" });
  steps.push(trace());
  ui.send({ type: "escape" });
  await Promise.resolve();
  steps.push(trace());
  navigate({ selected: "NAV-2", panel: true, document: "doc-1" });
  steps.push(trace());
  navigate({ selected: "NAV-1" });
  steps.push(trace());
  navigate({ board: 2 });
  steps.push(trace());
  navigate({ view: "side" });
  steps.push(trace());
  travel(-1);
  steps.push(trace());
  expect(steps).toMatchInlineSnapshot(`
    [
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=side",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=page",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "3/3",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "4/4",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": "NAV-1",
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-2&view=page&document=doc-1",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": "doc-1",
        "draft": null,
        "entries": "5/5",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-2",
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=page",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "6/6",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2&issue=NAV-1&view=side",
        "board": 2,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "7/7",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2&issue=NAV-1&view=side",
        "board": 2,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "7/7",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=page",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "6/7",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "page",
        "viewsPage": false,
      },
    ]
  `);
});

test("navigation: a link's view opens that issue once and never becomes the board's preference", async () => {
  const { navigate, ui, trace } = await navigationFixture();
  const steps = [];
  visit("/?board=1&issue=NAV-1&view=page");
  steps.push(trace());
  navigate({ selected: "NAV-2" });
  steps.push(trace());
  ui.send({ type: "escape" });
  steps.push(trace());
  navigate({ selected: "NAV-1", panel: true });
  steps.push(trace());
  visit("/?board=2&issue=NAV-3&view=page");
  steps.push(trace());
  navigate({ view: "side" });
  steps.push(trace());
  navigate({ panel: false });
  await Promise.resolve();
  steps.push(trace());
  expect(steps).toMatchInlineSnapshot(`
    [
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=page",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "1/1",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-2&view=page",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-2",
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "3/3",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": "NAV-2",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&issue=NAV-1&view=side",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "4/4",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2&issue=NAV-3&view=page",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "1/1",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-3",
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2&issue=NAV-3&view=side",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-3",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2",
        "board": 2,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "3/3",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": "NAV-3",
        "view": "side",
        "viewsPage": false,
      },
    ]
  `);
});

test("navigation: changing how issues open inside a saved view saves it to that view, but restoring the view never does (BJ-155)", async () => {
  const { navigate, openSavedView, set, get, trace } = await navigationFixture();
  const view = await savedView({ id: "open-in", name: "Open in", display: { openIn: "page" } });
  set({ savedViews: [view] });
  const { requests, restore } = recordRequests();
  const steps = [];
  try {
    visit("/view/open-in-open-in?board=1");
    steps.push(trace());
    visit("/view/open-in?board=1&issue=NAV-1&view=side");
    steps.push(trace());
    navigate({ panel: false });
    await Promise.resolve();
    steps.push(trace());
    expect(requests).toEqual([]);
    openSavedView(view);
    navigate({ selected: "NAV-1", panel: true });
    steps.push(trace());
    navigate({ view: "side" });
    steps.push(trace());
    await Promise.resolve();
    expect(get().savedViews[0]!.display.openIn).toBe("side");
    navigate({ view: "side" });
    steps.push(trace());
    travel(-1);
    steps.push(trace());
    await Promise.resolve();
    expect(steps).toMatchInlineSnapshot(`
      [
        {
          "activeViewId": "open-in",
          "address": "/view/open-in-open-in?board=1",
          "board": 1,
          "boardOpenIn": "side/side",
          "document": null,
          "draft": null,
          "entries": "1/1",
          "inbox": false,
          "mine": false,
          "overlayFilters": 0,
          "panel": false,
          "selected": null,
          "view": "page",
          "viewsPage": false,
        },
        {
          "activeViewId": "open-in",
          "address": "/view/open-in-open-in?board=1&issue=NAV-1&view=side",
          "board": 1,
          "boardOpenIn": "side/side",
          "document": null,
          "draft": null,
          "entries": "1/1",
          "inbox": false,
          "mine": false,
          "overlayFilters": 0,
          "panel": true,
          "selected": "NAV-1",
          "view": "side",
          "viewsPage": false,
        },
        {
          "activeViewId": "open-in",
          "address": "/view/open-in-open-in?board=1",
          "board": 1,
          "boardOpenIn": "side/side",
          "document": null,
          "draft": null,
          "entries": "2/2",
          "inbox": false,
          "mine": false,
          "overlayFilters": 0,
          "panel": false,
          "selected": "NAV-1",
          "view": "page",
          "viewsPage": false,
        },
        {
          "activeViewId": "open-in",
          "address": "/view/open-in-open-in?board=1&issue=NAV-1&view=page",
          "board": 1,
          "boardOpenIn": "side/side",
          "document": null,
          "draft": null,
          "entries": "3/3",
          "inbox": false,
          "mine": false,
          "overlayFilters": 0,
          "panel": true,
          "selected": "NAV-1",
          "view": "page",
          "viewsPage": false,
        },
        {
          "activeViewId": "open-in",
          "address": "/view/open-in-open-in?board=1&issue=NAV-1&view=side",
          "board": 1,
          "boardOpenIn": "side/side",
          "document": null,
          "draft": null,
          "entries": "4/4",
          "inbox": false,
          "mine": false,
          "overlayFilters": 0,
          "panel": true,
          "selected": "NAV-1",
          "view": "side",
          "viewsPage": false,
        },
        {
          "activeViewId": "open-in",
          "address": "/view/open-in-open-in?board=1&issue=NAV-1&view=side",
          "board": 1,
          "boardOpenIn": "side/side",
          "document": null,
          "draft": null,
          "entries": "4/4",
          "inbox": false,
          "mine": false,
          "overlayFilters": 0,
          "panel": true,
          "selected": "NAV-1",
          "view": "side",
          "viewsPage": false,
        },
        {
          "activeViewId": "open-in",
          "address": "/view/open-in-open-in?board=1&issue=NAV-1&view=page",
          "board": 1,
          "boardOpenIn": "side/side",
          "document": null,
          "draft": null,
          "entries": "3/4",
          "inbox": false,
          "mine": false,
          "overlayFilters": 0,
          "panel": true,
          "selected": "NAV-1",
          "view": "page",
          "viewsPage": false,
        },
      ]
    `);
    expect(requests.map((r) => r.replace(/,"(?!openIn)[a-zA-Z]+":(\[[^\]]*\]|"[^"]*"|[^,}]*)/g, ""))).toMatchInlineSnapshot(`
      [
        "PUT /api/views/open-in {"display":{"openIn":"side"}}",
      ]
    `);
  } finally {
    restore();
  }
});

test("navigation: switching or leaving a view resets its filter overlay; closing a menu forgets its target", async () => {
  const { navigate, openSavedView, setOverlay, set, get, ui, trace } = await navigationFixture();
  const first = await savedView({ id: "first", name: "First" }),
    second = await savedView({ id: "second", name: "Second" });
  set({ savedViews: [first, second] });
  const filters = { id: "overlay", join: "and" as const, children: [{ id: "o", field: "labels" as const, op: "is" as const, values: ["urgent"] }] };
  const steps = [];
  openSavedView(first);
  setOverlay(filters);
  steps.push(trace());
  openSavedView(second);
  steps.push(trace());
  travel(-1);
  steps.push(trace());
  navigate({ board: 1 });
  steps.push(trace());
  openSavedView(first);
  setOverlay(filters);
  navigate({ inbox: true });
  steps.push(trace());
  expect(steps).toMatchInlineSnapshot(`
    [
      {
        "activeViewId": "first",
        "address": "/view/first-first?board=1&filter=eyJ2IjoxLCJmaWx0ZXJzIjp7ImlkIjoib3ZlcmxheSIsImpvaW4iOiJhbmQiLCJjaGlsZHJlbiI6W3siaWQiOiJvIiwiZmllbGQiOiJsYWJlbHMiLCJvcCI6ImlzIiwidmFsdWVzIjpbInVyZ2VudCJdfV19fQ",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "3/3",
        "inbox": false,
        "mine": false,
        "overlayFilters": 1,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": "second",
        "address": "/view/second-second?board=1",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "4/4",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": "first",
        "address": "/view/first-first?board=1&filter=eyJ2IjoxLCJmaWx0ZXJzIjp7ImlkIjoib3ZlcmxheSIsImpvaW4iOiJhbmQiLCJjaGlsZHJlbiI6W3siaWQiOiJvIiwiZmllbGQiOiJsYWJlbHMiLCJvcCI6ImlzIiwidmFsdWVzIjpbInVyZ2VudCJdfV19fQ",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "3/4",
        "inbox": false,
        "mine": false,
        "overlayFilters": 1,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "4/4",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=1&inbox=1",
        "board": 1,
        "boardOpenIn": "side/side",
        "document": null,
        "draft": null,
        "entries": "7/7",
        "inbox": true,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
    ]
  `);
  ui.send({ type: "overlay.open", overlay: "options", target: "NAV-2", point: { x: 4, y: 5 } });
  expect([get().target, get().issueOptionsPoint]).toEqual(["NAV-2", { x: 4, y: 5 }]);
  ui.send({ type: "overlay.open", overlay: "status" });
  expect(get().target).toBe("NAV-2");
  ui.send({ type: "overlay.close" });
  expect([get().target, get().issueOptionsPoint]).toEqual([null, null]);
});

test("navigation: the view editor keeps its draft in the address across reload, takes display changes, and returns on cancel", async () => {
  const { navigate, beginViewEditor, createViewDraft, editViewDraft, discardViewEditor, set, get, trace } = await navigationFixture();
  const { setDisplay: changeDisplay } = await import("./view-settings");
  const view = await savedView({ id: "edited", name: "Edited", board: 2 });
  set({ savedViews: [view] });
  const steps = [];
  navigate({ view: "page" });
  beginViewEditor(createViewDraft());
  steps.push(trace());
  changeDisplay(1, { layout: "board" });
  steps.push(trace());
  navigate({ selected: "NAV-1", panel: true });
  navigate({ view: "side" });
  steps.push(trace());
  navigate({ panel: false });
  await Promise.resolve();
  const saved = session.get(`view-editor:${get().namespace}:/view/new`);
  expect(JSON.parse(saved!).display.layout).toBe("board");
  visit("/view/new?board=1");
  steps.push(trace());
  expect(get().editorDraft?.display.layout).toBe("board");
  navigate({ board: 2, selected: null, panel: false });
  steps.push(trace());
  travel(-1);
  steps.push(trace());
  expect(get().editorDraft).not.toBeNull();
  beginViewEditor(editViewDraft(view.id));
  steps.push(trace());
  expect(session.has(`view-editor:${get().namespace}:/view/edited-edited/edit`)).toBe(true);
  discardViewEditor();
  steps.push(trace());
  expect(session.has(`view-editor:${get().namespace}:/view/edited-edited/edit`)).toBe(false);
  beginViewEditor(createViewDraft());
  navigate({ viewsPage: true, board: 1 });
  steps.push(trace());
  expect(steps).toMatchInlineSnapshot(`
    [
      {
        "activeViewId": null,
        "address": "/view/new?board=1",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": "new:page",
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/view/new?board=1",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": "new:page",
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "page",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/view/new?board=1&issue=NAV-1&view=side",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": "new:side",
        "entries": "4/4",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": true,
        "selected": "NAV-1",
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/view/new?board=1",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": "new:side",
        "entries": "1/1",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/?board=2",
        "board": 2,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/view/new?board=1",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": "new:side",
        "entries": "1/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/view/edited-edited/edit?board=2",
        "board": 2,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": "Edited:side",
        "entries": "2/2",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": "edited",
        "address": "/view/edited-edited?board=2",
        "board": 2,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "3/3",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "side",
        "viewsPage": false,
      },
      {
        "activeViewId": null,
        "address": "/views?board=1",
        "board": 1,
        "boardOpenIn": "page/side",
        "document": null,
        "draft": null,
        "entries": "5/5",
        "inbox": false,
        "mine": false,
        "overlayFilters": 0,
        "panel": false,
        "selected": null,
        "view": "page",
        "viewsPage": true,
      },
    ]
  `);
});

test("navigation: My issues pushes once and Back/Forward restore exact destinations across boards", async () => {
  const { navigate, get } = await navigationFixture();
  navigate({ mine: true, selected: null, panel: false });
  expect(address()).toBe("/my-issues");
  expect(page.entries).toHaveLength(2);
  navigate({ mine: true, selected: null, panel: false });
  expect(page.entries).toHaveLength(2);
  navigate({ board: 2, selected: null, panel: false });
  expect(address()).toBe("/?board=2");
  travel(-1);
  expect(address()).toBe("/my-issues");
  expect(get().mine).toBe(true);
  expect(page.entries).toHaveLength(3);
  travel(-1);
  expect(address()).toBe("/?board=1");
  expect(get().mine).toBe(false);
  travel(1);
  expect(address()).toBe("/my-issues");
  travel(1);
  expect(address()).toBe("/?board=2");
  expect(get().mine).toBe(false);
  navigate({ mine: true });
  navigate({ board: 2 });
  expect(get().mine).toBe(false);
});

test("My issues selects assigned issues across boards and keeps their visible order after restoring", async () => {
  const { navigate, get, set, ME } = await navigationFixture();
  const { visibleOrder } = await import("./view-model");
  const issues = new Map(get().issues);
  for (const key of ["NAV-1", "NAV-3"]) issues.set(key, { ...issues.get(key)!, assignee: ME });
  issues.set("NAV-2", { ...issues.get("NAV-2")!, assignee: null });
  set({ issues });
  navigate({ mine: true, selected: null, panel: false });
  const keys = () => visibleOrder(get(), ME.id).flat().map(i => i.key);
  expect(keys()).toContain("NAV-1");
  expect(keys()).toContain("NAV-3");
  expect(keys()).not.toContain("NAV-2");
  const before = keys();
  expect(visibleOrder(get(), ME.id)).toBe(visibleOrder(get(), ME.id));
  navigate({ board: 2 });
  travel(-1);
  expect(keys()).toEqual(before);
});
