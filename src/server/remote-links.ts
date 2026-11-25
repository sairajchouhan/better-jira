import type { Database } from "bun:sqlite";
import type { RemoteLinks } from "./issue-projection";

/** Jira doesn't bump `updated` when a web link is added, so every fresh read of an issue's remote links updates the
 * property cache the Links filter reads (R2-D1). True when they changed. */
export function storeRemoteLinks(db: Database, key: string, links: RemoteLinks): boolean {
  const row = db
    .query<{ data: string }, [string]>("SELECT data FROM issue_properties WHERE key = ?")
    .get(key);
  if (!row) return false;
  const data = JSON.parse(row.data);
  if (
    JSON.stringify(data.remoteLinks ?? []) === JSON.stringify(links.remoteLinks) &&
    JSON.stringify(data.linkTitles ?? {}) === JSON.stringify(links.linkTitles)
  )
    return false;
  db.query("UPDATE issue_properties SET data = ? WHERE key = ?").run(
    JSON.stringify({ ...data, ...links }),
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

/** Rows cached before the property cache kept web-link titles (R3-board-D3) have links but no `linkTitles`: they are due
 * at once, so a title set in Jira reaches the card without opening the issue or waiting for the 6 h sweep. */
export const missingLinkTitles = (db: Database): string[] =>
  db
    .query<{ key: string }, []>(
      `SELECT key FROM issue_properties
    WHERE json_array_length(data,'$.remoteLinks') > 0 AND json_type(data,'$.linkTitles') IS NULL`,
    )
    .all()
    .map((r) => r.key);
