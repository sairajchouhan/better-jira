import { expect, test } from "bun:test";
import { savedViewClient } from "./saved-view-client";
import { defaultPreferences } from "./view-model";
import type { SavedView } from "./saved-view-model";

const view = (id = "one"): SavedView => ({
  ...defaultPreferences(), id, board: 1, kind: "custom", name: "Original",
  description: "", icon: "custom-view", color: "gray", mine: false,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
});
function fixture() {
  let views = [view(), view("two")];
  const storage = new Map<string, string>();
  const calls: { path: string; init?: RequestInit; resolve: (r: Response) => void }[] = [];
  const client = savedViewClient(
    { read: () => views, write: (next) => { views = next; } },
    () => "legacy",
    { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
    (input, init) => new Promise<Response>((resolve) => calls.push({ path: String(input), init, resolve })),
  );
  return { client, calls, storage, views: () => views };
}
// Wait for the promise queue to dispatch, without timers or network access.
const turn = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("queued edits preserve the newest optimistic value and block focus refresh", async () => {
  const f = fixture();
  const first = f.client.update("one", { name: "First" });
  const second = f.client.update("one", { name: "Second" });
  expect(f.views()[0]!.name).toBe("Second");
  await turn();
  expect(f.calls).toHaveLength(1);
  const refresh = f.client.refresh();
  f.calls[1]!.resolve(Response.json([view()]));
  expect(await refresh).toBeUndefined();
  expect(f.views()[0]!.name).toBe("Second");
  f.calls[0]!.resolve(Response.json({ ...view(), name: "First from server" }));
  await first;
  await turn();
  expect(f.views()[0]!.name).toBe("Second");
  expect(f.calls[2]!.init?.body).toBe(JSON.stringify({ name: "Second" }));
  f.calls[2]!.resolve(Response.json({ ...view(), name: "Second from server" }));
  await second;
  expect(f.views()[0]!.name).toBe("Second from server");
  const later = f.client.refresh();
  f.calls[3]!.resolve(Response.json([view()]));
  expect(await later).toEqual([view()]);
});

test("a failed edit rolls back only its own optimistic value and does not block the next edit", async () => {
  const f = fixture();
  const first = f.client.update("one", { name: "First" });
  const failure = first.catch((e: Error) => e);
  const second = f.client.update("one", { name: "Second" });
  await turn();
  f.calls[0]!.resolve(new Response(null, { status: 500 }));
  expect(await failure).toMatchObject({ message: "Could not save views (500)" });
  await turn();
  expect(f.views()[0]!.name).toBe("Second");
  f.calls[1]!.resolve(Response.json({ ...view(), name: "Second" }));
  await second;
  const third = f.client.update("one", { name: "Third" });
  const thirdFailure = third.catch((e: Error) => e);
  await turn();
  f.calls[2]!.resolve(new Response(null, { status: 400 }));
  expect(await thirdFailure).toMatchObject({ message: "Could not save views (400)" });
  expect(f.views()[0]!.name).toBe("Second");
});

test("different views write independently; missing ids never send a request", async () => {
  const f = fixture();
  await expect(f.client.update("missing", {})).rejects.toThrow("View not found");
  const a = f.client.update("one", { name: "A" });
  const b = f.client.update("two", { name: "B" });
  await turn();
  expect(f.calls.map((c) => c.path)).toEqual(["/api/views/one", "/api/views/two"]);
  f.calls[1]!.resolve(Response.json({ ...view("two"), name: "B" }));
  await b;
  f.calls[0]!.resolve(Response.json({ ...view(), name: "A" }));
  await a;
  expect(f.views().map((v) => v.name)).toEqual(["A", "B"]);
});

test("legacy import is marked only after success and retains the source", async () => {
  const f = fixture();
  f.storage.set("legacy", "[]");
  const failed = f.client.load(true);
  const failure = failed.catch((e: Error) => e);
  f.calls[0]!.resolve(new Response(null, { status: 500 }));
  expect(await failure).toMatchObject({ message: "Could not save views (500)" });
  expect(f.storage.has("legacy:imported")).toBe(false);
  const load = f.client.load(true);
  expect(f.calls[1]!.path).toBe("/api/views/import");
  f.calls[1]!.resolve(Response.json([]));
  await turn();
  f.calls[2]!.resolve(Response.json([view()]));
  expect(await load).toEqual([view()]);
  expect(f.storage.get("legacy")).toBe("[]");
  expect(f.storage.get("legacy:imported")).toBe("1");
  const again = f.client.load(true);
  expect(f.calls[3]!.path).toBe("/api/views");
  f.calls[3]!.resolve(Response.json([]));
  await again;
});

test("creation drops duplicate source metadata and deletion accepts an empty response", async () => {
  const f = fixture();
  const created = f.client.create({ ...view(), sourceId: "old" });
  expect(JSON.parse(String(f.calls[0]!.init?.body))).not.toHaveProperty("sourceId");
  f.calls[0]!.resolve(Response.json(view()));
  expect(await created).toEqual(view());
  const removed = f.client.remove("one/two");
  expect(f.calls[1]!.path).toBe("/api/views/one%2Ftwo");
  f.calls[1]!.resolve(new Response(null, { status: 204 }));
  await removed;
});
