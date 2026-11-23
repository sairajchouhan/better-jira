import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueStore } from "./issue-store";
import { LEDGER_MAX_AGE_MS, writeLedger } from "./write-ledger";
import { viewRepository } from "./view-repository";
import { DETAIL_CACHE_VERSION, detailCache } from "./detail-cache";
import { HISTORY_CACHE_VERSION, historyCache } from "./issue-history";
import { defaultPreferences } from "@/shared/view-model";

const tempDirs: string[] = [];
function tempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `better-jira-db-${name}-`));
  tempDirs.push(dir);
  return join(dir, "cache.db");
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("issueStore (real SQLite)", () => {
  test("stale poll put never overwrites a newer saved issue row", () => {
    const db = new Database(tempDbPath("stale"), { create: true, strict: true });
    const store = issueStore(db);
    store.see("APP-1", 1, 100);
    store.put({
      key: "APP-1",
      slim: { key: "APP-1", summary: "Newer write", updated: "2026-11-20T12:00:00.000Z" },
      full: { key: "APP-1", fields: { summary: "Newer write" } },
    });
    store.put({
      key: "APP-1",
      slim: { key: "APP-1", summary: "Stale poll", updated: "2026-11-20T11:59:00.000Z" },
      full: { key: "APP-1", fields: { summary: "Stale poll" } },
    });
    const [listed] = store.slims([1]).map((raw) => JSON.parse(raw));
    expect(listed.summary).toBe("Newer write");
    expect(store.updated("APP-1")).toBe("2026-11-20T12:00:00.000Z");
    db.close();
  });

  test("forgetBoards drops unconfigured boards while preserving shared and kept-on-no-board issues across reopen (2c8d6799, 08fbe86c)", () => {
    const path = tempDbPath("forget");
    let db = new Database(path, { create: true, strict: true });
    let store = issueStore(db);

    store.see("SHARED-1", 1, 100);
    store.see("SHARED-1", 2, 100);
    store.put({ key: "SHARED-1", slim: { key: "SHARED-1", updated: "2026-11-20T10:00:00Z" }, full: {} });

    store.see("BOARD2-ONLY", 2, 100);
    store.put({ key: "BOARD2-ONLY", slim: { key: "BOARD2-ONLY", updated: "2026-11-20T10:00:00Z" }, full: {} });

    store.put({ key: "KEPT-NONE", slim: { key: "KEPT-NONE", updated: "2026-11-20T10:00:00Z" }, full: {} });

    expect(store.forgetBoards([1])).toEqual([2]);
    db.close();

    db = new Database(path, { create: true, strict: true });
    store = issueStore(db);
    const items = store.slims([1]).map((raw) => JSON.parse(raw) as { key: string; boards: number[] });
    expect(items.map((i) => [i.key, i.boards]).sort()).toEqual([
      ["KEPT-NONE", []],
      ["SHARED-1", [1]],
    ]);
    db.close();
  });

  test("forgetBoards forgets nothing when configured boards list is empty (c339674e)", () => {
    const db = new Database(tempDbPath("empty-config"), { create: true, strict: true });
    const store = issueStore(db);
    store.see("APP-1", 1, 100);
    store.put({ key: "APP-1", slim: { key: "APP-1", updated: "2026-11-20T10:00:00Z" }, full: {} });

    expect(store.forgetBoards([])).toEqual([]);
    expect(store.slims([1])).toHaveLength(1);
    expect(store.count(1)).toBe(1);
    db.close();
  });

  test("sweep drops issues that left a board without deleting issues held by another board or kept on no board", () => {
    const db = new Database(tempDbPath("sweep"), { create: true, strict: true });
    const store = issueStore(db);
    store.see("STAY-1", 1, 200);
    store.put({ key: "STAY-1", slim: { key: "STAY-1", updated: "2026-11-20T10:00:00Z" }, full: {} });

    store.see("GONE-1", 1, 100);
    store.put({ key: "GONE-1", slim: { key: "GONE-1", updated: "2026-11-20T10:00:00Z" }, full: {} });

    store.put({ key: "KEPT-1", slim: { key: "KEPT-1", updated: "2026-11-20T10:00:00Z" }, full: {} });

    expect(store.sweep(1, 150)).toBe(1);
    const keys = store.slims([1]).map((raw) => (JSON.parse(raw) as { key: string }).key).sort();
    expect(keys).toEqual(["KEPT-1", "STAY-1"]);
    db.close();
  });
});

describe("writeLedger (real SQLite)", () => {
  test("persists intents, remembered ids, ownership, and 90-day pruning across reopen", () => {
    const path = tempDbPath("ledger");
    let now = 1_700_000_000_000;
    let db = new Database(path, { create: true, strict: true });
    let ledger = writeLedger(db, () => now);

    ledger.intend("upload:file-1", ["100"]);
    expect(ledger.made("upload:file-1")).toEqual({ key: "", at: now, data: ["100"], found: false });

    ledger.remember("upload:file-1", "205", true);
    expect(ledger.owned("upload:", "205", "upload:file-2")).toBe(true);
    expect(ledger.owned("upload:", "205", "upload:file-1")).toBe(false);
    db.close();

    db = new Database(path, { create: true, strict: true });
    ledger = writeLedger(db, () => now);
    expect(ledger.made("upload:file-1")).toEqual({ key: "205", at: now, data: ["100"], found: true });

    now += LEDGER_MAX_AGE_MS + 1;
    ledger.prune();
    expect(ledger.made("upload:file-1")).toBeUndefined();
    db.close();
  });
});

describe("viewRepository (real SQLite)", () => {
  test("persists CRUD and idempotent legacy imports across reopen", async () => {
    const path = tempDbPath("views");
    let changes = 0;
    let db = new Database(path, { create: true, strict: true });
    let repo = viewRepository(db, () => {
      changes++;
    });

    const prefs = defaultPreferences();
    const draft = {
      name: "High priority",
      description: "",
      icon: "filter" as const,
      color: "gray" as const,
      kind: "custom" as const,
      board: 1,
      filters: prefs.filters,
      display: prefs.display,
      scope: prefs.scope,
      hidden: {},
      collapsed: {},
      order: {},
      mine: false,
    };
    const createRes = await repo.handle(
      new Request("http://127.0.0.1:3002/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3002" },
        body: JSON.stringify(draft),
      }),
      "ns-1",
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };
    expect(changes).toBe(1);

    const legacy = [
      {
        ...draft,
        id: "legacy-1",
        name: "Legacy view",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    for (let i = 0; i < 2; i++) {
      const importRes = await repo.handle(
        new Request("http://127.0.0.1:3002/api/views/import", {
          method: "POST",
          headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3002" },
          body: JSON.stringify(legacy),
        }),
        "ns-1",
        "import",
      );
      expect(importRes.status).toBe(200);
    }
    db.close();

    db = new Database(path, { create: true, strict: true });
    repo = viewRepository(db);
    expect(repo.list("ns-1").map((v) => v.name)).toEqual(["High priority", "Legacy view"]);

    const delRes = await repo.handle(
      new Request(`http://127.0.0.1:3002/api/views/${created.id}`, {
        method: "DELETE",
        headers: { origin: "http://127.0.0.1:3002" },
      }),
      "ns-1",
      created.id,
    );
    expect(delRes.status).toBe(204);
    expect(repo.list("ns-1").map((v) => v.id)).toEqual(["legacy-1"]);
    db.close();
  });
});

describe("detailCache and historyCache (real SQLite)", () => {
  test("invalidates stale schema versions on startup and caches by source_updated", async () => {
    const path = tempDbPath("caches");
    let db = new Database(path, { create: true, strict: true });
    const store = issueStore(db);
    store.see("APP-9", 1, 100);
    store.put({
      key: "APP-9",
      slim: { key: "APP-9", updated: "2026-11-20T10:00:00Z" },
      full: { key: "APP-9", fields: { summary: "Original" } },
    });

    db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS issue_details (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, data TEXT NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS issue_history (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, data TEXT NOT NULL)");
    db.query("INSERT OR REPLACE INTO meta VALUES ('details-version', '0')").run();
    db.query("INSERT OR REPLACE INTO meta VALUES ('history-version', '0')").run();
    db.query("INSERT INTO issue_details VALUES ('APP-9', '2026-11-20T10:00:00Z', '{\"stale\":true}')").run();
    db.query("INSERT INTO issue_history VALUES ('APP-9', '2026-11-20T10:00:00Z', '[{\"id\":\"stale\"}]')").run();

    let detailLoads = 0;
    const details = detailCache(db, async () => {
      detailLoads++;
      return { fields: { description: { type: "doc", version: 1, content: [] } } };
    });
    let historyLoads = 0;
    const history = historyCache(
      db,
      async () => {
        historyLoads++;
        return [{ id: "h1", at: "2026-11-20T10:00:00Z", actor: null, items: [] }];
      },
      (key) => store.updated(key) || undefined,
    );

    const d1 = JSON.parse((await details.read("APP-9"))!);
    const d2 = JSON.parse((await details.read("APP-9"))!);
    expect(d1.stale).toBeUndefined();
    expect(d2.fields.summary).toBe("Original");
    expect(detailLoads).toBe(1);

    const h1 = JSON.parse((await history("APP-9"))!);
    const h2 = JSON.parse((await history("APP-9"))!);
    expect(h1[0].id).toBe("h1");
    expect(h2[0].id).toBe("h1");
    expect(historyLoads).toBe(1);

    expect(db.query<{ v: string }, []>("SELECT v FROM meta WHERE k = 'details-version'").get()?.v).toBe(
      DETAIL_CACHE_VERSION,
    );
    expect(db.query<{ v: string }, []>("SELECT v FROM meta WHERE k = 'history-version'").get()?.v).toBe(
      HISTORY_CACHE_VERSION,
    );
    db.close();
  });
});
