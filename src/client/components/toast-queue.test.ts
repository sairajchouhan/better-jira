import { expect, jest, test } from "bun:test";
import { createToastQueue } from "./toast-queue";

const ids = (queue: ReturnType<typeof createToastQueue>) => queue.visible().map((t) => t.id);

test("shows the newest four, oldest first, and older ones wait", () => {
  const queue = createToastQueue();
  for (const id of ["a", "b", "c", "d", "e"]) queue.show(id, { id });
  expect(ids(queue)).toEqual(["b", "c", "d", "e"]);
  queue.dismiss("e");
  expect(ids(queue)).toEqual(["a", "b", "c", "d"]);
});

test("an id already queued is replaced in place", () => {
  const queue = createToastQueue();
  queue.show("first", { id: "a" });
  queue.show("other", { id: "b" });
  queue.show("second", { id: "a", duration: 8000 });
  expect(queue.visible()).toEqual([
    { id: "a", content: "second", duration: 8000, revision: 3 },
    { id: "b", content: "other", duration: 4000, revision: 2 },
  ]);
});

test("listeners hear changes; the snapshot is stable between them", () => {
  const queue = createToastQueue(),
    calls: number[] = [];
  const stop = queue.subscribe(() => calls.push(queue.visible().length));
  const id = queue.show("hi");
  const snapshot = queue.visible();
  expect(queue.visible()).toBe(snapshot);
  queue.dismiss("missing");
  queue.dismiss(id);
  queue.dismissAll();
  stop();
  queue.show("unheard");
  expect(calls).toEqual([1, 0]);
});

test("show starts a fresh presentation lifetime for the same id; update preserves it", () => {
  const queue = createToastQueue();
  queue.show("first view", { id: "view-created", duration: 8000 });
  const first = queue.find("view-created")!;
  queue.show("second view", { id: "view-created", duration: 8000 });
  const replacement = queue.find("view-created")!;
  expect(replacement.revision).toBeNumber();
  expect(replacement.revision).not.toBe(first.revision);
  queue.update("view-created", "renamed second view");
  expect(queue.find("view-created")).toEqual({ ...replacement, content: "renamed second view" });
});

test("has looks up caller-owned ids including waiting toasts", () => {
  const queue = createToastQueue(1);
  expect(queue.has("first")).toBe(false);
  queue.show("one", { id: "first" });
  queue.show("two", { id: "second" });
  expect(queue.has("first")).toBe(true);
  expect(queue.has("second")).toBe(true);
  queue.dismiss("first");
  expect(queue.has("first")).toBe(false);
});

test("R3-chrome-D4: deadlines wait while the queue is held (pointer on the toasts, hidden tab) and resume with the time left", () => {
  jest.useFakeTimers();
  try {
    const queue = createToastQueue();
    queue.show("copied", { id: "a", duration: Infinity, expiresIn: 5000 });
    let gone = false;
    queue.countdown(4000, () => (gone = true));
    jest.advanceTimersByTime(3000);
    queue.hold("hover", true);
    queue.hold("hidden", true);
    jest.advanceTimersByTime(60_000);
    expect(ids(queue)).toEqual(["a"]);
    queue.hold("hover", false);
    jest.advanceTimersByTime(60_000);
    expect(ids(queue)).toEqual(["a"]); // still hidden
    queue.hold("hidden", false);
    jest.advanceTimersByTime(999);
    expect(gone).toBe(false);
    jest.advanceTimersByTime(1);
    expect(gone).toBe(true);
    expect(ids(queue)).toEqual(["a"]);
    jest.advanceTimersByTime(1000);
    expect(ids(queue)).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});
