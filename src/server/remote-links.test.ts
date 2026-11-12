import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { recentlyTouched, storeRemoteLinks } from "./remote-links";

function cache() {
  const db = new Database(":memory:", { strict: true });
  db.run("CREATE TABLE issues (key TEXT PRIMARY KEY, slim TEXT NOT NULL)");
  db.run(
    "CREATE TABLE issue_properties (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, synced INTEGER NOT NULL, data TEXT NOT NULL)",
  );
  return db;
}
const row = (db: Database, key: string, updated: string, synced: number) => {
  db.query("INSERT INTO issues VALUES (?,?)").run(key, JSON.stringify({ updated }));
  db.query("INSERT INTO issue_properties VALUES (?,?,?,?)").run(key, updated, synced, "{}");
};

test("R2-D1: a web link Jira added without bumping `updated` reaches the property cache", () => {
  const db = cache();
  row(db, "KAN-141", "2026-11-08T20:17:11.777+0000", Date.parse("2026-11-08T20:17:12Z"));
  expect(storeRemoteLinks(db, "KAN-141", ["https://example.com/qa-vf-link-marker"])).toBe(true);
  expect(storeRemoteLinks(db, "KAN-141", ["https://example.com/qa-vf-link-marker"])).toBe(false);
  const data = db.query<{ data: string }, []>("SELECT data FROM issue_properties").get()!.data;
  expect(JSON.parse(data).remoteLinks).toEqual(["https://example.com/qa-vf-link-marker"]);
  expect(storeRemoteLinks(db, "KAN-999", ["https://x.test"])).toBe(false); // not enriched yet
});

test("R2-D1: issues enriched right after an update are read again until 15 min have passed", () => {
  const db = cache();
  const now = Date.parse("2026-11-08T20:30:00Z");
  row(db, "NEW", "2026-11-08T20:17:11.777+0000", Date.parse("2026-11-08T20:17:12Z"));
  row(db, "OLD", "2026-11-01T10:00:00.000+0000", Date.parse("2026-11-08T20:00:00Z"));
  row(db, "JUST", "2026-11-08T20:29:30.000+0000", now - 10_000); // enriched under a minute ago
  expect(recentlyTouched(db, now)).toEqual(["NEW"]);
  expect(recentlyTouched(db, Date.parse("2026-11-08T20:40:00Z"))).toEqual(["NEW", "JUST"]);
});
