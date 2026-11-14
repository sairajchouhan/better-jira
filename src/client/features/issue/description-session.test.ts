import { expect, test } from "bun:test";
import { normalizeDocument, type AdfDocument } from "@/shared/document";
import { descriptionNotice, descriptionSession } from "./description-session";
import { DESCRIPTION_CONFLICT } from "@/shared/jira-ops";

const doc = (text: string, media?: string): AdfDocument =>
  normalizeDocument({
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
      ...(media
        ? [
            {
              type: "mediaSingle",
              content: [{ type: "media", attrs: { id: media, type: "file", collection: "" } }],
            },
          ]
        : []),
    ],
  });
const json = (value: AdfDocument) => JSON.stringify(normalizeDocument(value));
const DRAFT = "better-jira:description-draft:ns:BJ-1";

/** A store holding descriptions by key, a fake clock and a Map as localStorage. */
function harness({
  key = "BJ-1",
  stored = doc("jira"),
  storage = new Map<string, string>(),
  moved = new Map<string, string>(),
  refused = false,
  loaded = true,
}: {
  key?: string;
  stored?: AdfDocument;
  storage?: Map<string, string>;
  moved?: Map<string, string>;
  refused?: boolean;
  /** False: the session is made while the issue's details are still loading, as an issue opened from the board is. */
  loaded?: boolean;
} = {}) {
  let now = 0,
    persisted: () => void = () => {};
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const clock = {
    setTimeout: (fn: (...args: any[]) => void, ms: number) => {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (timer: any) => void timers.delete(timer),
  };
  const descriptions = new Map<string, AdfDocument>([[moved.get(key) ?? key, stored]]);
  const writes: [string, AdfDocument][] = [],
    discards: [string, AdfDocument | undefined][] = [];
  const session = descriptionSession(
    { key, namespace: "ns", stored: loaded ? json(stored) : "" },
    {
      storage: {
        getItem: (name) => storage.get(name) ?? null,
        setItem: (name, value) => void storage.set(name, value),
        removeItem: (name) => void storage.delete(name),
      },
      read: (k) => descriptions.get(k),
      refused: () => refused,
      write: (k, value) => {
        writes.push([k, value]);
        descriptions.set(k, normalizeDocument(value));
      },
      discard: (k, unsaved) => void discards.push([k, unsaved]),
      // Resolves when the test says the local write finished.
      persist: () => new Promise<void>((resolve) => (persisted = resolve)),
      currentKey: (k) => moved.get(k) ?? k,
      clock,
    },
  );
  return {
    session,
    storage,
    writes,
    discards,
    descriptions,
    /** The store's description JSON, as the component passes it to `observe`. */
    stored: (k = key) => json(descriptions.get(moved.get(k) ?? k)!),
    setJira: (value: AdfDocument) => descriptions.set(moved.get(key) ?? key, value),
    advance(ms: number) {
      now += ms;
      for (const [timer, { at, fn }] of timers)
        if (at <= now) {
          timers.delete(timer);
          fn();
        }
    },
    async persisted() {
      persisted();
      await Promise.resolve();
    },
  };
}

test("typing saves 600ms after it stops, each keystroke restarting the wait", async () => {
  const h = harness();
  h.session.edit(doc("a"));
  h.advance(500);
  h.session.edit(doc("ab"));
  h.advance(500);
  expect(h.writes).toEqual([]);
  // The draft holds the typing with the text it started from.
  expect(JSON.parse(h.storage.get(DRAFT)!)).toEqual({ doc: doc("ab"), base: json(doc("jira")) });
  h.advance(100);
  expect(h.writes).toEqual([["BJ-1", doc("ab")]]);
  // The draft goes once the local write finished and nothing new was typed.
  expect(h.storage.has(DRAFT)).toBe(true);
  await h.persisted();
  expect(h.storage.has(DRAFT)).toBe(false);
});

test("a file landing in the description saves at once, as Linear syncs each change; typing around it still waits (BJ-233)", () => {
  const h = harness({ stored: doc("jira", "m-1") });
  // Typing beside a file that was already there waits for the pause.
  h.session.edit(doc("jira!", "m-1"));
  expect(h.writes).toEqual([]);
  // A pasted file replaces it: saved without the wait.
  h.session.edit(doc("jira!", "m-2"));
  expect(h.writes).toEqual([["BJ-1", doc("jira!", "m-2")]]);
  h.session.edit(doc("jira!!", "m-2"));
  h.advance(500);
  expect(h.writes.length).toBe(1);
  h.advance(100);
  expect(h.writes.at(-1)).toEqual(["BJ-1", doc("jira!!", "m-2")]);
  // Deleting a file is typing: it waits.
  h.session.edit(doc("jira!!"));
  expect(h.writes.length).toBe(2);
});

test("flush saves at once, and a draft typed again before the write finished stays", async () => {
  const h = harness();
  h.session.edit(doc("a"));
  h.session.flush();
  expect(h.writes).toEqual([["BJ-1", doc("a")]]);
  h.session.edit(doc("ab"));
  await h.persisted();
  expect(JSON.parse(h.storage.get(DRAFT)!).doc).toEqual(doc("ab"));
  // Nothing typed: flushing writes nothing.
  h.advance(600);
  h.session.flush();
  expect(h.writes.length).toBe(2);
});

test("a draft left by a reload is saved when the issue loads", () => {
  const storage = new Map<string, string>();
  harness({ storage }).session.edit(doc("typed"));
  const h = harness({ storage });
  h.session.recover(h.stored());
  expect(h.writes).toEqual([["BJ-1", doc("typed")]]);
  expect(h.session.getSnapshot()).toEqual({ revision: 1, draft: undefined, conflict: false });
});

test("both older draft shapes are still read: the bare document and one without a base", () => {
  for (const saved of [doc("typed"), { doc: doc("typed") }]) {
    const h = harness({ storage: new Map([[DRAFT, JSON.stringify(saved)]]) });
    h.session.recover(h.stored());
    expect(h.writes).toEqual([["BJ-1", doc("typed")]]);
  }
});

test("a draft matching Jira's text is dropped; a broken one is ignored", () => {
  const same = harness({ storage: new Map([[DRAFT, JSON.stringify({ doc: doc("jira") })]]) });
  same.session.recover(same.stored());
  expect(same.storage.has(DRAFT)).toBe(false);
  expect(same.session.getSnapshot().revision).toBe(0);
  const broken = harness({ storage: new Map([[DRAFT, "{"]]) });
  broken.session.recover(broken.stored());
  expect(broken.writes).toEqual([]);
});

test("a reloaded draft whose base Jira changed since asks first", () => {
  const storage = new Map([[DRAFT, JSON.stringify({ doc: doc("typed"), base: json(doc("old")) })]]);
  const h = harness({ storage });
  h.session.recover(h.stored());
  expect(h.writes).toEqual([]);
  expect(h.session.getSnapshot()).toEqual({ revision: 1, draft: doc("typed"), conflict: true });
  expect(h.session.held()).toBe(true);
});

test("a reloaded draft Jira refused stays held without a conflict of its own", () => {
  const storage = new Map([[DRAFT, JSON.stringify(doc("typed"))]]);
  const h = harness({ storage, refused: true });
  h.session.recover(h.stored());
  expect(h.writes).toEqual([]);
  expect(h.session.getSnapshot()).toEqual({ revision: 1, draft: doc("typed"), conflict: false });
});

test("Jira's text changing under unsaved typing holds the save until a version is picked", () => {
  const h = harness();
  h.session.edit(doc("mine"));
  h.setJira(doc("theirs"));
  expect(h.session.observe(h.stored(), true)).toBe(false);
  expect(h.session.getSnapshot().conflict).toBe(true);
  h.advance(600);
  expect(h.writes).toEqual([]);
  // Observing again while the conflict is open changes nothing.
  h.session.observe(h.stored(), false);
  expect(h.session.getSnapshot().revision).toBe(0);
  h.session.resolve(true);
  expect(h.writes).toEqual([["BJ-1", doc("mine")]]);
  expect(h.session.getSnapshot()).toEqual({ revision: 0, draft: undefined, conflict: false });
  expect(h.session.held()).toBe(false);
});

test("taking Jira's version drops the typing into history and shows Jira's text", () => {
  const h = harness();
  h.session.edit(doc("mine"));
  h.setJira(doc("theirs"));
  h.session.observe(h.stored(), true);
  h.session.resolve(false);
  expect(h.writes).toEqual([]);
  expect(h.discards).toEqual([["BJ-1", doc("mine")]]);
  expect(h.storage.has(DRAFT)).toBe(false);
  expect(h.session.getSnapshot()).toEqual({ revision: 1, draft: undefined, conflict: false });
  // Jira's text is now what the editor shows: observing it changes nothing.
  h.session.observe(h.stored(), false);
  expect(h.session.getSnapshot().revision).toBe(1);
});

test("with nothing unsaved, Jira's text replaces the editor; a focused one gets focus back", () => {
  const h = harness();
  h.setJira(doc("theirs"));
  expect(h.session.observe(h.stored(), false)).toBe(false);
  expect(h.session.getSnapshot()).toEqual({ revision: 1, draft: undefined, conflict: false });
  h.setJira(doc("again"));
  expect(h.session.observe(h.stored(), true)).toBe(true);
  expect(h.session.getSnapshot().revision).toBe(2);
});

test("BJ-193: an issue that loads after its session opened keeps the editor it mounted with", () => {
  const h = harness({ loaded: false });
  h.session.recover(h.stored());
  expect(h.session.observe(h.stored(), false)).toBe(false);
  expect(h.session.getSnapshot()).toEqual({ revision: 0, draft: undefined, conflict: false });
  // Jira's text changing later still replaces it.
  h.setJira(doc("theirs"));
  h.session.observe(h.stored(), false);
  expect(h.session.getSnapshot().revision).toBe(1);
});

test("BJ-193: typing in an editor that opened before the load saves against the loaded text", async () => {
  const h = harness({ loaded: false });
  h.session.observe(h.stored(), false);
  h.session.edit(doc("mine"));
  h.advance(600);
  expect(h.writes).toEqual([["BJ-1", doc("mine")]]);
  expect(h.session.getSnapshot().revision).toBe(0);
});

test("a media id swap after the editor's own save waits for blur", () => {
  const h = harness({ stored: doc("text", "local-1") });
  h.setJira(doc("text", "jira-uuid"));
  h.session.observe(h.stored(), true);
  expect(h.session.getSnapshot().revision).toBe(0);
  h.session.observe(h.stored(), false);
  expect(h.session.getSnapshot().revision).toBe(1);
});

test("a restore from Jira replaces the editor even when its text matched", () => {
  const h = harness();
  h.session.restored();
  expect(h.session.getSnapshot().revision).toBe(0);
  h.session.observe(h.stored(), false);
  expect(h.session.getSnapshot().revision).toBe(1);
});

test("after the issue moves to Jira's key, saves go there and the draft keeps the first key", async () => {
  const moved = new Map<string, string>();
  const h = harness({ key: "BJ-1", moved });
  h.session.edit(doc("before"));
  h.advance(600);
  moved.set("BJ-1", "JIRA-9");
  h.descriptions.set("JIRA-9", h.descriptions.get("BJ-1")!);
  h.session.edit(doc("after"));
  expect(h.storage.has(DRAFT)).toBe(true);
  h.advance(600);
  expect(h.writes.map(([key]) => key)).toEqual(["BJ-1", "JIRA-9"]);
  h.session.lateMedia((current) => current as AdfDocument);
  expect(h.writes.at(-1)![0]).toBe("JIRA-9");
});

test("media that finished uploading after the editor closed joins the description as it is now", () => {
  const h = harness({ stored: doc("text") });
  h.setJira(doc("edited elsewhere"));
  h.session.lateMedia((current) => {
    const value = normalizeDocument(current);
    return { ...value, content: [...value.content!, ...doc("", "uploaded").content!.slice(1)] };
  });
  expect(h.writes).toEqual([["BJ-1", doc("edited elsewhere", "uploaded")]]);
});

test("without a clock port, the 600ms save runs on real timers", async () => {
  const writes: unknown[] = [];
  const session = descriptionSession(
    { key: "BJ-1", namespace: "ns", stored: json(doc("jira")) },
    {
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      read: () => undefined,
      refused: () => false,
      write: (_, value) => void writes.push(value),
      discard: () => {},
      persist: async () => {},
      currentKey: (k) => k,
    },
  );
  session.edit(doc("typed"));
  await Bun.sleep(650);
  expect(writes).toEqual([doc("typed")]);
});

test("QA-3 description D3: a refused description shows its bar and holds saves even when its reason is wrapped or gone", () => {
  const conflictBar = "Someone changed this description in Jira. Your version isn't saved.";
  // A refused version whose reason was lost is never shown as saved.
  expect(descriptionNotice(false, true, undefined)).toEqual({ held: true, message: conflictBar });
  // A created issue's catch-up wraps the conflict in its own sentence.
  expect(
    descriptionNotice(false, true, `Jira didn't take the edits made to K-34 since it was created: ${DESCRIPTION_CONFLICT}`),
  ).toEqual({ held: true, message: conflictBar });
  expect(descriptionNotice(false, true, DESCRIPTION_CONFLICT)).toEqual({ held: true, message: conflictBar });
  // Any other refusal shows Jira's reason and doesn't hold saves; nothing refused shows nothing.
  expect(descriptionNotice(false, true, "description: Too long.")).toEqual({
    held: false,
    message: "Jira didn't save this description (Too long). Edit it to try again, or use Jira's version.",
  });
  expect(descriptionNotice(false, false, undefined)).toEqual({ held: false, message: undefined });
  expect(descriptionNotice(true, false, undefined).held).toBe(true);
});
