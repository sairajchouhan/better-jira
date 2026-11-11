import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { viewRepository } from "./view-repository";
import { defaultPreferences } from "./view-model";
import {
  migrateLegacyViews,
  encodeOverlay,
  decodeOverlay,
  emptyOverlay,
  mergeFilters,
  validateDraft,
} from "./saved-view-model";
const p = defaultPreferences();
const draft = {
  board: 1,
  kind: "custom",
  name: "Mine",
  icon: "filter",
  color: "gray",
  description: "",
  filters: p.filters,
  display: p.display,
  scope: p.scope,
  mine: false,
};
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/views", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
test("API CRUD, namespace isolation, metadata writes independent of Jira", async () => {
  const db = new Database(":memory:");
  const r = viewRepository(db);
  const created = await r.handle(req("POST", draft), "site/a");
  expect(created.status).toBe(201);
  const v = await created.json();
  expect(r.list("site/b")).toEqual([]);
  expect((await r.handle(req("PUT", { name: "Renamed" }), "site/a", v.id)).status).toBe(200);
  expect(r.list("site/a")[0]).toMatchObject({
    id: v.id,
    name: "Renamed",
    createdAt: v.createdAt,
  });
  expect((await r.handle(req("DELETE"), "site/a", v.id)).status).toBe(204);
  expect(r.list("site/a")).toEqual([]);
  db.close();
});
test("API rejects malformed input and cross-origin mutations", async () => {
  const db = new Database(":memory:");
  const r = viewRepository(db);
  for (const change of [
    { board: -1 },
    { name: " " },
    { kind: "shared" },
    { display: {} },
    { filters: { join: "xor", children: [] } },
  ])
    expect((await r.handle(req("POST", { ...draft, ...change }), "a")).status).toBe(400);
  expect(
    (
      await r.handle(
        new Request("http://localhost/api/views", {
          method: "POST",
          headers: { origin: "https://evil.test" },
          body: JSON.stringify(draft),
        }),
        "a",
      )
    ).status,
  ).toBe(403);
  db.close();
});
test("legacy import keeps ids, scope and mine, is atomic and runs once", async () => {
  const legacy = migrateLegacyViews(
    JSON.stringify([
      {
        id: "old-id",
        board: 1,
        name: "Old",
        preferences: { ...p, scope: "backlog" },
        mine: true,
      },
    ]),
  );
  expect(legacy[0]).toMatchObject({
    id: "old-id",
    scope: "backlog",
    mine: true,
    kind: "custom",
    display: p.display,
  });
  const db = new Database(":memory:");
  const r = viewRepository(db);
  expect((await r.handle(req("POST", [...legacy, { bad: true }]), "a", "import")).status).toBe(
    400,
  );
  expect(r.list("a")).toEqual([]);
  await r.handle(req("POST", legacy), "a", "import");
  await r.handle(req("DELETE"), "a", "old-id");
  await r.handle(req("POST", legacy), "a", "import");
  expect(r.list("a")).toEqual([]);
  await r.handle(req("POST", [{ ...legacy[0], id: "other-browser" }]), "a", "import");
  expect(r.list("a").map(v => v.id)).toEqual(["other-browser"]);
  db.close();
});
test("versioned typed overlay round trips Unicode and rejects malformed/deep/unknown inputs", () => {
  const filters = {
    ...emptyOverlay(),
    children: [
      {
        id: "r",
        field: "labels" as const,
        op: "is" as const,
        values: ["日本語 🐈"],
      },
    ],
  };
  expect(decodeOverlay(encodeOverlay(filters))).toEqual(filters);
  for (const v of [
    "%",
    "x".repeat(33000),
    Buffer.from(JSON.stringify({ v: 2, filters })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, filters: { ...filters, join: "xor" } })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        v: 1,
        filters: {
          ...filters,
          children: [{ id: "r", field: "sql", op: "is", values: [] }],
        },
      }),
    ).toString("base64url"),
  ])
    expect(decodeOverlay(v)).toEqual(emptyOverlay());
  expect(() =>
    validateDraft({
      ...draft,
      filters: {
        ...filters,
        children: [{ id: "r", field: "status", op: "contains", values: [] }],
      },
    }),
  ).toThrow();
});
test("merging keeps OR bases and overlays as AND operands", () => {
  const base = {
    ...emptyOverlay(),
    join: "or" as const,
    children: [
      {
        id: "r",
        field: "status" as const,
        op: "is" as const,
        values: ["todo"],
      },
    ],
  };
  const merged = mergeFilters(base, base);
  expect(merged.join).toBe("and");
  expect(merged.children).toHaveLength(2);
  expect(merged.children[0]).toMatchObject({ join: "or" });
});
