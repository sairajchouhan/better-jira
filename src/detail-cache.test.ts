import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { detailCache, DETAIL_CACHE_VERSION } from "./detail-cache";
function database() {
  const db = new Database(":memory:");
  db.run("CREATE TABLE issues (key TEXT PRIMARY KEY,slim TEXT,full TEXT)");
  db.run("CREATE TABLE meta (k TEXT PRIMARY KEY,v TEXT)");
  db.run("CREATE TABLE issue_details (key TEXT PRIMARY KEY,source_updated TEXT,data TEXT)");
  db.query("INSERT INTO issues VALUES (?,?,?)").run(
    "TEST-1",
    JSON.stringify({ updated: "same-time" }),
    JSON.stringify({ key: "TEST-1", fields: { summary: "Cached issue" } }),
  );
  return db;
}

test("legacy attachment-less details refresh even when Jira's updated timestamp is unchanged", async () => {
  const db = database();
  try {
    db.query("INSERT INTO meta VALUES ('details-version',?)").run("1");
    db.query("INSERT INTO issue_details VALUES (?,?,?)").run(
      "TEST-1",
      "same-time",
      JSON.stringify({ key: "TEST-1", fields: { description: "old" } }),
    );
    let reads = 0;
    const cache = detailCache(db, async () => {
      reads++;
      return { fields: { attachment: [{ id: "123" }], description: "rich" } };
    });
    expect(JSON.parse((await cache.read("TEST-1"))!).fields.attachment).toEqual([{ id: "123" }]);
    expect(reads).toBe(1);
    expect(
      db.query<{ v: string }, []>("SELECT v FROM meta WHERE k='details-version'").get()?.v,
    ).toBe(DETAIL_CACHE_VERSION);
    const reopened = detailCache(db, async () => {
      reads++;
      throw new Error("cache should be current");
    });
    expect(JSON.parse((await reopened.read("TEST-1"))!).fields.attachment).toEqual([{ id: "123" }]);
    expect(reads).toBe(1);
  } finally {
    db.close();
  }
});

test("detail reads deduplicate and parsed range-request context is reused until updated changes", async () => {
  const db = database();
  let reads = 0;
  try {
    const cache = detailCache(db, async () => {
      reads++;
      await Bun.sleep(1);
      return { fields: { attachment: [{ id: String(reads) }] } };
    });
    await Promise.all([cache.read("TEST-1"), cache.read("TEST-1")]);
    expect(reads).toBe(1);
    const first = await cache.readParsed("TEST-1");
    expect(await cache.readParsed("TEST-1")).toBe(first);
    db.query("UPDATE issues SET slim=? WHERE key='TEST-1'").run(
      JSON.stringify({ updated: "new-time" }),
    );
    const next = await cache.readParsed("TEST-1");
    expect(next).not.toBe(first);
    expect(next.fields.attachment[0].id).toBe("2");
    expect(reads).toBe(2);
    expect(await cache.read("UNKNOWN")).toBeUndefined();
  } finally {
    db.close();
  }
});
