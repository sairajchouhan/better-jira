import { beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderWithFakeDocument } from "@/client/test/fake-document";
import { normalizeDocument } from "@/shared/document";
import {
  SAVE_WAIT,
  draftEligible,
  localDraftKey,
  localDraftWriter,
  readLocalDraft,
  resumeDraft,
  writeLocalDraft,
  type ComposerLocalDraft,
} from "./composer-local-draft";

const data = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
} as Storage;
beforeEach(() => {
  for (const ns of ["a", "b", "render"]) localStorage.removeItem(localDraftKey(ns));
});

const doc = (text: string) => normalizeDocument(text);
const draft = (over: Partial<ComposerLocalDraft> = {}): ComposerLocalDraft => ({
  fields: { board: 1, status: "doing", priority: "High", assignee: { id: "u1", name: "Uma" } as never, due: "2030-01-02", type: "Bug", parent: "EP-1" },
  title: "Fix the login",
  description: doc("Steps to reproduce"),
  labels: ["auth"],
  attachments: [],
  more: true,
  ...over,
});

test("C5 key: one draft per account, like Linear's `CreateIssue_<userId>__DRAFT__`", () => {
  expect(localDraftKey("a")).not.toBe(localDraftKey("b"));
  writeLocalDraft("a", draft());
  expect(readLocalDraft("a")?.title).toBe("Fix the login");
  expect(readLocalDraft("b")).toBeUndefined();
});

test("C5 save: the whole composer round-trips (title, description, every property, Create more); transient opener data does not", () => {
  writeLocalDraft("a", draft({ fields: { ...draft().fields, submission: "s1", fromSelection: "sel", suggestedEpics: ["EP-9"], copy: true, labels: ["x"] } }));
  const back = readLocalDraft("a")!;
  expect(back.fields).toEqual({ ...draft().fields, labels: ["x"] });
  expect(back.description).toEqual(doc("Steps to reproduce"));
  expect(back.labels).toEqual(["auth"]);
  expect(back.more).toBe(true);
});

test("C5 eligibility: Linear's `eligibleForDraft`: 3+ title chars, 3+ description chars, or any title with any description", () => {
  expect(draftEligible("ab", doc(""))).toBe(false);
  expect(draftEligible("abc", doc(""))).toBe(true);
  expect(draftEligible("", doc("abc"))).toBe(true);
  expect(draftEligible("a", doc("b"))).toBe(true);
  expect(draftEligible("  ", doc(" "))).toBe(false);
  // Properties alone are no draft, and an emptied composer removes the one it had kept.
  writeLocalDraft("a", draft());
  writeLocalDraft("a", draft({ title: "ab", description: doc("") }));
  expect(localStorage.getItem(localDraftKey("a"))).toBeNull();
});

test("C5 restore: the kept draft comes back over the opener's fields, field by field (Linear's `applyDraftValues` → `mergeInto`)", () => {
  const start = resumeDraft({ board: 1, status: "todo", assignee: null, related: { key: "K-1", kind: "related" } }, draft(), [1, 2]);
  expect(start.title).toBe("Fix the login");
  expect(start.more).toBe(true);
  expect(start.fields.status).toBe("doing");
  expect(start.fields.assignee).toEqual({ id: "u1", name: "Uma" } as never);
  // What the draft never held stays as the opener set it.
  expect(start.fields.related).toEqual({ key: "K-1", kind: "related" });
  // A plain open with nothing kept opens as given.
  expect(resumeDraft({ board: 2 }, undefined, [1, 2])).toEqual({ fields: { board: 2 }, title: "", description: doc(""), labels: [], attachments: [], more: false });
});

test("C5 restore: an opener that brings its own content (a copy, a refused create, a selection or comment) opens as given", () => {
  for (const initial of [{ title: "Copy (copy)", copy: true }, { title: "Refused" }, { descriptionDoc: doc("from a comment") }]) {
    const start = resumeDraft(initial, draft(), [1]);
    expect(start.title).toBe(initial.title ?? "");
    expect(start.fields.priority).toBeUndefined();
  }
});

test("C5 restore: a draft whose board is gone keeps its board-free properties and drops that board's status, people and epic", () => {
  const start = resumeDraft({ board: 2 }, draft(), [2]);
  expect(start.fields.board).toBe(2);
  expect(start.fields.status).toBeUndefined();
  expect(start.fields.assignee).toBeUndefined();
  expect(start.fields.priority).toBe("High");
  expect(start.fields.due).toBe("2030-01-02");
});

test("C5 debounce: a change is written SAVE_WAIT after the last one; flush (reload, close) writes at once; clear drops it", async () => {
  const writer = localDraftWriter("a");
  writer.save(draft({ title: "First" }));
  writer.save(draft({ title: "Second" }));
  expect(readLocalDraft("a")).toBeUndefined();
  await Bun.sleep(SAVE_WAIT + 50);
  expect(readLocalDraft("a")?.title).toBe("Second");
  writer.save(draft({ title: "Third" }));
  writer.flush();
  expect(readLocalDraft("a")?.title).toBe("Third");
  // Created, saved to drafts or discarded: the kept draft goes, and a write still pending never brings it back.
  writer.save(draft({ title: "Fourth" }));
  writer.clear();
  writer.flush();
  await Bun.sleep(SAVE_WAIT + 50);
  expect(readLocalDraft("a")).toBeUndefined();
});

test("C5 composer: opening it after a reload shows the kept title and properties; a copy shows only itself", async () => {
  const { set } = await import("@/client/state/store");
  const { ui } = await import("@/client/features/navigation/app-navigation");
  const { CreateIssue } = await import("./personal-controls");
  set({
    namespace: "render",
    boards: [{ id: 1, name: "B", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }, { id: "doing", name: "Doing", category: "indeterminate" }] }] }],
  } as never);
  writeLocalDraft("render", draft({ fields: { board: 1, status: "doing", priority: "High", due: "2030-01-02" } }));
  const render = () => renderWithFakeDocument(() => renderToStaticMarkup(<CreateIssue />));
  ui.send({ type: "overlay.open", overlay: "create", draft: { board: 1, status: "todo" } });
  const html = render();
  expect(html).toContain('value="Fix the login"');
  expect(html).toContain("Status: Doing");
  expect(html).toContain("Priority: High");
  expect(html).toContain("Labels: auth");
  ui.send({ type: "overlay.close" });
  ui.send({ type: "overlay.open", overlay: "create", draft: { board: 1, title: "Other (copy)", copy: true } });
  const copy = render();
  expect(copy).toContain('value="Other (copy)"');
  expect(copy).not.toContain("Priority: High");
  ui.send({ type: "overlay.close" });
});

test("BJ-274: the saved draft being finished stays linked through a reload, so creating the issue takes it off the list", () => {
  writeLocalDraft("a", draft({ saved: "d-1" }));
  const back = readLocalDraft("a")!;
  expect(back.saved).toBe("d-1");
  expect(resumeDraft({ board: 1 }, back, [1]).saved).toBe("d-1");
  // An opener with its own content isn't that saved draft.
  expect(resumeDraft({ board: 1, title: "Other (copy)", copy: true }, back, [1]).saved).toBeUndefined();
  writeLocalDraft("a", draft());
  expect(readLocalDraft("a")!.saved).toBeUndefined();
});

test("BJ-273: while a draft is kept, the sidebar New issue shows Linear's dot and says Resume editing, and ⌘K New issue reads Resume editing", async () => {
  const { set } = await import("@/client/state/store");
  const { NewIssueItem } = await import("@/client/features/navigation/app-chrome");
  const { shortcuts } = await import("@/client/features/navigation/shortcuts");
  const { hasLocalDraft } = await import("./composer-local-draft");
  set({ namespace: "render" } as never);
  const sidebar = () => renderWithFakeDocument(() => renderToStaticMarkup(<NewIssueItem />));
  const detail = () => shortcuts.find((s) => s.id === "new")!.detail?.();
  expect(hasLocalDraft("render")).toBe(false);
  expect(sidebar()).not.toContain("data-draft-dot");
  expect(detail()).toBeUndefined();
  writeLocalDraft("render", draft());
  expect(hasLocalDraft("render")).toBe(true);
  expect(sidebar()).toContain("data-draft-dot");
  expect(sidebar()).toContain("Resume editing");
  expect(detail()).toBe("Resume editing");
  writeLocalDraft("render", undefined);
  expect(sidebar()).not.toContain("data-draft-dot");
  expect(detail()).toBeUndefined();
});
