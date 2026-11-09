import type { Database } from "bun:sqlite";

/** Jira doesn't bump `updated` when a web link is added, so every fresh read of an issue's remote links updates the
 * property cache the Links filter reads (R2-D1). True when they changed. */
export function storeRemoteLinks(db: Database, key: string, urls: string[]): boolean {
  const row = db
    .query<{ data: string }, [string]>("SELECT data FROM issue_properties WHERE key = ?")
    .get(key);
  if (!row) return false;
  const data = JSON.parse(row.data);
  if (JSON.stringify(data.remoteLinks ?? []) === JSON.stringify(urls)) return false;
  db.query("UPDATE issue_properties SET data = ? WHERE key = ?").run(
    JSON.stringify({ ...data, remoteLinks: urls }),
    key,
  );
  return true;
}

/** People add web links right after creating or editing an issue, which Jira doesn't count as an update: rows enriched
 * within 15 min of their last update are due again each minute until that window passes (R2-D1).
 * ponytail: later links reach the cache when the issue is opened or on the 6 h sweep; widen the window if that's too slow. */
export const recentlyTouched = (db: Database, now = Date.now()): string[] =>
  db
    .query<{ key: string; updated: string; synced: number }, [number]>(
      `SELECT p.key,json_extract(i.slim,'$.updated') AS updated,p.synced FROM issue_properties p JOIN issues i ON i.key=p.key
    WHERE p.synced < ? AND p.source_updated = json_extract(i.slim,'$.updated')`,
    )
    .all(now - 60_000)
    .filter((r) => r.synced - Date.parse(r.updated) < 15 * 60_000)
    .map((r) => r.key);
