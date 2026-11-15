import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { issueStore, migrateIssueStore, withBoards } from "./issue-store";

const fresh = () => {
  const db = new Database(":memory:", { strict: true });
  db.run("CREATE TABLE issue_properties (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, synced INTEGER NOT NULL, data TEXT NOT NULL)");
  return db;
};
const raw = (key: string, updated = "2026-11-01T10:00:00.000+0000") => ({ key, fields: { updated } });
/** What a board's sync does with one issue it read (mirror.ts `save`). */
const sync = (store: ReturnType<typeof issueStore>, board: number, key: string, seen: number, updated?: string) => {
  const joined = store.see(key, board, seen);
  store.put({ key, slim: { key, updated: raw(key, updated).fields.updated }, full: raw(key, updated) });
  return joined;
};
const listed = (store: ReturnType<typeof issueStore>, boards: number[]) =>
  Object.fromEntries(store.slims(boards).map((s) => JSON.parse(s)).map((i) => [i.key, i.boards]));

test("an issue on two boards is on both, whichever board synced last", () => {
  const store = issueStore(fresh());
  expect(sync(store, 1, "TEAM-1", 100)).toBe(true);
  expect(sync(store, 2, "TEAM-1", 101)).toBe(true);
  sync(store, 1, "TEAM-2", 100);
  expect(sync(store, 1, "TEAM-1", 102)).toBe(false); // seen again: nothing new
  expect(listed(store, [1, 2])).toEqual({ "TEAM-1": [1, 2], "TEAM-2": [1] });
  // In the sidebar's order, so "the first board that holds it" is the same everywhere.
  expect(listed(store, [2, 1])).toEqual({ "TEAM-1": [2, 1], "TEAM-2": [1] });
  // Only configured boards are listed; an issue only on a board left out of the sidebar isn't sent.
  expect(listed(store, [2])).toEqual({ "TEAM-1": [2] });
  expect(store.count(1)).toBe(2);
  expect(store.count(2)).toBe(1);
  // One content row however many boards hold it.
  expect(store.slims([1, 2])).toHaveLength(2);
});

test("a full sync that no longer finds an issue takes it off that board only; on no board, it leaves the mirror", () => {
  const db = fresh();
  const store = issueStore(db);
  sync(store, 1, "TEAM-1", 100);
  sync(store, 2, "TEAM-1", 100);
  sync(store, 2, "SQUAD-1", 100);
  // Board 2's next full sync (from 200) reads SQUAD-1 but not TEAM-1.
  sync(store, 2, "SQUAD-1", 200);
  expect(store.sweep(2, 200)).toBe(1);
  expect(listed(store, [1, 2])).toEqual({ "TEAM-1": [1], "SQUAD-1": [2] });
  // Board 1's full sync doesn't find it either: it is on no board and its row goes.
  expect(store.sweep(1, 300)).toBe(1);
  expect(listed(store, [1, 2])).toEqual({ "SQUAD-1": [2] });
  expect(store.updated("TEAM-1")).toBe("");
});

test("a linked issue on no board lands on none; a new issue made on a board starts on that board", () => {
  const store = issueStore(fresh());
  sync(store, 1, "TEAM-1", 100);
  // Refreshed without a board (a linked issue the tab shows on none): no membership, so it isn't listed on any board.
  expect(store.boardsOf("OTHER-9")).toEqual([]);
  // Refreshed from board 2, where the tab made it: it starts there, not on the first board.
  store.claim("TEAM-5", 2, [1, 2]);
  expect(store.boardsOf("TEAM-5")).toEqual([2]);
  // A board the sidebar doesn't have never places it.
  store.claim("TEAM-6", 9, [1, 2]);
  expect(store.boardsOf("TEAM-6")).toEqual([]);
  // An issue a board already holds keeps the boards Jira gave it: a stale tab can't put it back on a board it left.
  store.claim("TEAM-1", 2, [1, 2]);
  expect(store.boardsOf("TEAM-1")).toEqual([1]);
  // The claim lasts only until the board's full sync: one that doesn't find it takes it off.
  store.put({ key: "TEAM-5", slim: { key: "TEAM-5", updated: "x" }, full: raw("TEAM-5") });
  store.sweep(2, Date.now() + 1);
  expect(store.boardsOf("TEAM-5")).toEqual([]);
});

test("an older copy never replaces a newer one, while the board's claim still advances", () => {
  const store = issueStore(fresh());
  sync(store, 1, "TEAM-1", 100, "2026-11-02T00:00:00.000+0000");
  sync(store, 1, "TEAM-1", 200, "2026-11-01T00:00:00.000+0000");
  expect(store.updated("TEAM-1")).toBe("2026-11-02T00:00:00.000+0000");
  expect(store.sweep(1, 200)).toBe(0);
});

test("a cache from before per-board membership loads with every row, and moves once", () => {
  const db = fresh();
  db.run(`CREATE TABLE issues (
  key TEXT PRIMARY KEY, board INTEGER NOT NULL, seen INTEGER NOT NULL, slim TEXT NOT NULL, full TEXT NOT NULL)`);
  const old = db.query("INSERT INTO issues VALUES (?,?,?,?,?)");
  old.run("TEAM-1", 2, 100, JSON.stringify({ key: "TEAM-1", board: 2, updated: "u1" }), JSON.stringify(raw("TEAM-1")));
  old.run("TEAM-2", 1, 90, JSON.stringify({ key: "TEAM-2", board: 1, updated: "u2" }), JSON.stringify(raw("TEAM-2")));
  db.run("INSERT INTO issue_properties VALUES ('TEAM-1','u1',1,'{\"watchers\":[]}')");

  expect(migrateIssueStore(db)).toBe(true);
  expect(migrateIssueStore(db)).toBe(false);
  const store = issueStore(db);
  expect(db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('issues')").all().map((c) => c.name)).toEqual([
    "key",
    "slim",
    "full",
  ]);
  expect(listed(store, [1, 2])).toEqual({ "TEAM-1": [2], "TEAM-2": [1] });
  expect(store.updated("TEAM-1")).toBe("u1");
  // The old `seen` stamps carry over, so the boards' next full syncs sweep exactly as before.
  expect(store.sweep(1, 90)).toBe(0);
  expect(store.propertyRows([1, 2]).find((r) => r.key === "TEAM-1")?.data).toBe('{"watchers":[]}');
  // The board that lost the shared issue to the last sync gets it back on its next sync.
  sync(store, 1, "TEAM-1", 300);
  expect(listed(store, [1, 2])).toEqual({ "TEAM-1": [1, 2], "TEAM-2": [1] });
});

test("an issue's JSON carries its boards", () => {
  expect(JSON.parse(withBoards('{"key":"A-1"}', [2, 1]))).toEqual({ boards: [2, 1], key: "A-1" });
  expect(JSON.parse(withBoards("{}", []))).toEqual({ boards: [] });
});
