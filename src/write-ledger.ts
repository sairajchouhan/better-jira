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
  // Older rows count from now, so the first prune doesn't drop them.
  if (!columns.some((c) => c.name === "at"))
    db.run(`ALTER TABLE created_issues ADD COLUMN at INTEGER NOT NULL DEFAULT ${now()}`);
  const prune = () =>
    db.query("DELETE FROM created_issues WHERE at < ?").run(now() - LEDGER_MAX_AGE_MS);
  prune();
  return {
    /** `id` is empty while only the intent is known. */
    made: (client: string) =>
      db
        .query<{ key: string; at: number }, [string]>(
          "SELECT key, at FROM created_issues WHERE client = ?",
        )
        .get(client) ?? undefined,
    intend: (client: string) =>
      db
        .query(
          "INSERT INTO created_issues VALUES (?, '', ?) ON CONFLICT(client) DO UPDATE SET key = ''",
        )
        .run(client, now()),
    remember: (client: string, id: string) =>
      db
        .query(
          "INSERT INTO created_issues VALUES (?, ?, ?) ON CONFLICT(client) DO UPDATE SET key = excluded.key",
        )
        .run(client, id, now()),
    forget: (client: string) => db.query("DELETE FROM created_issues WHERE client = ?").run(client),
    prune,
  };
}
export type WriteLedger = ReturnType<typeof writeLedger>;
