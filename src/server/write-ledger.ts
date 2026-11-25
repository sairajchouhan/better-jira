import type { Database } from "bun:sqlite";

/** Rows older than this are dropped: a saved change that old has long been replayed or discarded. */
export const LEDGER_MAX_AGE_MS = 90 * 24 * 3600_000;

/**
 * Jira's creates have no idempotency key: what each client write made (issue key, comment id, attachment id), so a replay
 * never makes a second one. A row with no id is an intent: written before the send, so a send whose answer was lost (the
 * server exited, the connection dropped) is reconciled against Jira before anything is sent again.
 */
export function writeLedger(db: Database, now = () => Date.now()) {
  db.run("CREATE TABLE IF NOT EXISTS created_issues (client TEXT PRIMARY KEY, key TEXT NOT NULL)");
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(created_issues)").all();
  const has = (name: string) => columns.some((c) => c.name === name);
  // Older rows count from now, so the first prune doesn't drop them.
  if (!has("at"))
    db.run(`ALTER TABLE created_issues ADD COLUMN at INTEGER NOT NULL DEFAULT ${now()}`);
  // What the send started from (the create's fields, or the issue's attachment ids before an upload), as JSON.
  if (!has("data")) db.run("ALTER TABLE created_issues ADD COLUMN data TEXT");
  // 1: the id was matched by name and size after a lost answer, not answered by Jira: never deleted as an orphan.
  if (!has("found"))
    db.run("ALTER TABLE created_issues ADD COLUMN found INTEGER NOT NULL DEFAULT 0");
  const prune = () =>
    db.query("DELETE FROM created_issues WHERE at < ?").run(now() - LEDGER_MAX_AGE_MS);
  prune();
  return {
    /** `key` is empty while only the intent is known. */
    made: (client: string) => {
      const row = db
        .query<{ key: string; at: number; data: string | null; found: number }, [string]>(
          "SELECT key, at, data, found FROM created_issues WHERE client = ?",
        )
        .get(client);
      if (!row) return undefined;
      const data = row.data === null ? undefined : JSON.parse(row.data);
      return { key: row.key, at: row.at, data, found: row.found === 1 };
    },
    intend: (client: string, data?: unknown) =>
      db
        .query(
          "INSERT INTO created_issues (client, key, at, data, found) VALUES (?, '', ?, ?, 0) ON CONFLICT(client) DO UPDATE SET key = '', at = excluded.at, data = excluded.data, found = 0",
        )
        .run(client, now(), data === undefined ? null : JSON.stringify(data)),
    remember: (client: string, id: string, found = false) =>
      db
        .query(
          "INSERT INTO created_issues (client, key, at, found) VALUES (?, ?, ?, ?) ON CONFLICT(client) DO UPDATE SET key = excluded.key, found = excluded.found",
        )
        .run(client, id, now(), found ? 1 : 0),
    /** Whether a row other than `client`, of clients starting with `prefix`, has `id`. */
    owned: (prefix: string, id: string, client: string) =>
      !!db
        .query("SELECT 1 FROM created_issues WHERE key = ? AND client != ? AND client LIKE ?")
        .get(id, client, `${prefix}%`),
    forget: (client: string) => db.query("DELETE FROM created_issues WHERE client = ?").run(client),
    prune,
  };
}
export type WriteLedger = ReturnType<typeof writeLedger>;
