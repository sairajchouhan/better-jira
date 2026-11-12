import { expect, test } from "bun:test";
import { createActor, fromPromise, SimulatedClock, waitFor } from "xstate";
import { appMachine, autosaveMachine, storageMachine, uiMachine } from "./machines";

const doc = (text: string) => ({
  type: "doc" as const,
  version: 1 as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const gate = () => {
  let open!: () => void, fail!: (e: Error) => void;
  const promise = new Promise<void>((r, j) => {
    open = r;
    fail = j;
  });
  return { promise, open, fail };
};

test("ui: Escape closes the issue, then clears the search, then drops the selection", () => {
  const ui = createActor(uiMachine, { input: { board: 1, view: "side" } }).start();
  ui.send({ type: "navigate", selected: "A-1", panel: true });
  ui.send({ type: "query.set", query: "bug" });
  ui.send({ type: "escape" });
  expect(ui.getSnapshot().context).toMatchObject({ panel: false, query: "bug", selected: "A-1" });
  ui.send({ type: "escape" });
  expect(ui.getSnapshot().context).toMatchObject({ query: "", selected: "A-1" });
  ui.send({ type: "escape" });
  expect(ui.getSnapshot().context.selected).toBeNull();
});

test("ui: the toolbar closes under an overlay, over an issue page and on a board switch", () => {
  const ui = createActor(uiMachine, { input: { board: 1, view: "page" } }).start();
  const toolbar = () => ui.getSnapshot().context.toolbar;
  ui.send({ type: "toolbar.open", toolbar: "filter" });
  ui.send({ type: "overlay.open", overlay: "palette" });
  expect(toolbar()).toBeNull();
  expect(ui.getSnapshot().matches({ toolbar: "closed" })).toBe(true);
  ui.send({ type: "overlay.close" });
  ui.send({ type: "toolbar.open", toolbar: "display" });
  ui.send({ type: "navigate", selected: "A-1", panel: true });
  expect(toolbar()).toBeNull();
  ui.send({ type: "navigate", panel: false });
  ui.send({ type: "toolbar.open", toolbar: "filter" });
  ui.send({ type: "query.set", query: "x" });
  ui.send({ type: "navigate", board: 2, view: "side" });
  expect(ui.getSnapshot().context).toMatchObject({
    board: 2,
    view: "side",
    toolbar: null,
    query: "",
  });
  ui.send({ type: "toolbar.open", toolbar: "filter" });
  ui.send({ type: "navigate", board: 2 });
  expect(toolbar()).toBe("filter");
});

test("ui: toggles open and close the same palette or toolbar menu", () => {
  const ui = createActor(uiMachine, { input: { board: 1, view: "side" } }).start();
  ui.send({ type: "palette.toggle" });
  expect(ui.getSnapshot().context.overlay).toBe("palette");
  ui.send({ type: "palette.toggle" });
  expect(ui.getSnapshot().context.overlay).toBeNull();
  ui.send({ type: "overlay.open", overlay: "status" });
  ui.send({ type: "palette.toggle" });
  expect(ui.getSnapshot().context.overlay).toBe("palette");
  ui.send({ type: "overlay.close" });
  ui.send({ type: "toolbar.toggle", toolbar: "filter" });
  ui.send({ type: "toolbar.toggle", toolbar: "display" });
  expect(ui.getSnapshot().context.toolbar).toBe("display");
  ui.send({ type: "toolbar.toggle", toolbar: "display" });
  expect(ui.getSnapshot().context.toolbar).toBeNull();
});

test("ui: a created-issue toast takes the key Jira assigns, keeping its timer", () => {
  const clock = new SimulatedClock();
  const ui = createActor(uiMachine, { input: { board: 1, view: "side" }, clock }).start();
  ui.send({ type: "toast.show", text: "Created A-NEW2", key: "A-NEW2" });
  ui.send({ type: "toast.rekey", from: "A-NEW21", to: "A-40" });
  expect(ui.getSnapshot().context.toast).toEqual({ text: "Created A-NEW2", key: "A-NEW2" });
  clock.increment(4000);
  ui.send({ type: "toast.rekey", from: "A-NEW2", to: "A-37" });
  expect(ui.getSnapshot().context.toast).toEqual({ text: "Created A-37", key: "A-37" });
  clock.increment(1000);
  expect(ui.getSnapshot().context.toast).toBeNull();
});

test("ui: a toast hides after five seconds, and a new toast restarts the timer", () => {
  const clock = new SimulatedClock();
  const ui = createActor(uiMachine, { input: { board: 1, view: "side" }, clock }).start();
  ui.send({ type: "toast.show", text: "Created A-1", key: "A-1" });
  clock.increment(4000);
  ui.send({ type: "toast.show", text: "Created A-2", key: "A-2" });
  clock.increment(4000);
  expect(ui.getSnapshot().context.toast).toEqual({ text: "Created A-2", key: "A-2" });
  clock.increment(1000);
  expect(ui.getSnapshot().context.toast).toBeNull();
});

test("app: a failed load shows its error and a retry loads again", async () => {
  let attempts = 0;
  const app = createActor(
    appMachine.provide({
      actors: {
        load: fromPromise(async () => {
          if (!attempts++) throw new Error("Mirror offline");
        }),
      },
    }),
  ).start();
  app.send({ type: "load" });
  await waitFor(app, (s) => s.matches("failed"));
  expect(app.getSnapshot().context.error).toBe("Mirror offline");
  app.send({ type: "load" });
  expect(app.getSnapshot().context.error).toBe("");
  await waitFor(app, (s) => s.matches("ready"));
  app.send({ type: "load" });
  expect(app.getSnapshot().matches("ready")).toBe(true);
});

test("storage: edits during a save trigger one more save; a failure keeps edits unsaved until the next change", async () => {
  const saves: ReturnType<typeof gate>[] = [];
  const storage = createActor(
    storageMachine.provide({
      actors: {
        save: fromPromise(() => {
          const g = gate();
          saves.push(g);
          return g.promise;
        }),
      },
    }),
  ).start();
  storage.send({ type: "change" });
  expect(storage.getSnapshot().matches("loading")).toBe(true);
  storage.send({ type: "opened", recovered: true, message: "Recovered" });
  storage.send({ type: "change" });
  storage.send({ type: "change" });
  storage.send({ type: "change" });
  saves[0]!.open();
  await waitFor(storage, () => saves.length === 2);
  saves[1]!.open();
  await waitFor(storage, (s) => s.matches("saved"));
  expect(saves).toHaveLength(2);
  expect(storage.getSnapshot().context.message).toBe("Recovered");
  storage.send({ type: "change" });
  saves[2]!.fail(new Error("Disk full"));
  await waitFor(storage, (s) => s.matches("failed"));
  expect(storage.getSnapshot().context).toMatchObject({
    message: "Disk full",
    recovered: undefined,
  });
  storage.send({ type: "change" });
  expect(storage.getSnapshot().matches("saving")).toBe(true);
  storage.send({ type: "blocked", message: "Read only" });
  storage.send({ type: "change" });
  expect(storage.getSnapshot().matches("blocked")).toBe(true);
});

test("autosave: keeps every draft, commits 600ms after the last change, and flushes at once", () => {
  const clock = new SimulatedClock(),
    drafts: unknown[] = [],
    commits: unknown[] = [];
  const autosave = createActor(
    autosaveMachine.provide({
      actions: { keepDraft: (_, d) => void drafts.push(d), commit: (_, d) => void commits.push(d) },
    }),
    { clock },
  ).start();
  autosave.send({ type: "change", doc: doc("a") });
  clock.increment(500);
  autosave.send({ type: "change", doc: doc("ab") });
  clock.increment(500);
  expect(commits).toEqual([]);
  clock.increment(100);
  expect(commits).toEqual([doc("ab")]);
  expect(drafts).toHaveLength(2);
  autosave.send({ type: "change", doc: doc("abc") });
  autosave.send({ type: "flush" });
  autosave.send({ type: "flush" });
  expect(commits).toEqual([doc("ab"), doc("abc")]);
});

test("sync D4: a load that can't reach the server retries by itself, backing off, and says so", async () => {
  const clock = new SimulatedClock();
  let attempts = 0;
  const app = createActor(
    appMachine.provide({
      actors: {
        load: fromPromise(async () => {
          if (attempts++ < 2) throw new TypeError("Failed to fetch");
        }),
      },
    }),
    { clock },
  ).start();
  app.send({ type: "load" });
  await waitFor(app, (s) => s.matches("failed"));
  expect(app.getSnapshot().context.error).toBe("Can't reach the better-jira server.");
  clock.increment(999);
  expect(attempts).toBe(1);
  clock.increment(1);
  await waitFor(app, (s) => s.matches("failed") && attempts === 2);
  // The next wait is twice as long.
  clock.increment(1999);
  expect(attempts).toBe(2);
  clock.increment(1);
  await waitFor(app, (s) => s.matches("ready"));
});

test("relation kind travels with the overlay event and defaults on the next opening", () => {
  const actor = createActor(uiMachine, { input: { board: 1, view: "side" } }).start();
  actor.send({ type: "overlay.open", overlay: "relations", kind: "blocked", target: "A-1" });
  expect(actor.getSnapshot().context).toMatchObject({ relation: "blocked", target: "A-1" });
  actor.send({ type: "overlay.close" });
  actor.send({ type: "overlay.open", overlay: "relations" });
  expect(actor.getSnapshot().context.relation).toBe("related");
  actor.stop();
});
