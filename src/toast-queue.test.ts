import { expect, test } from "bun:test";
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
    { id: "a", content: "second", duration: 8000 },
    { id: "b", content: "other", duration: 4000 },
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
