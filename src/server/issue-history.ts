import type { Database } from "bun:sqlite";
import { jiraAvatar } from "@/shared/avatar-url";
import type { HistoryEntry, HistoryItem } from "@/shared/jira-history";

/** Bump when the stored shape changes, so old rows are read again. */
export const HISTORY_CACHE_VERSION = "3";
/** Jira's page cap for the changelog endpoint. */
const PAGE = 100;
/** Text fields whose values are whole documents: the Activity says they changed, never what to (Linear shows one line). */
const DOCUMENT_FIELDS = new Set(["environment", "comment", "Comment"]);
/** The description keeps both texts: its row opens Linear's description history (`Xz` "Show description history"), which
 *  diffs each version against the one before. Jira's changelog holds the whole wiki-markup text on both sides. */
const VERSIONED_FIELDS = new Set(["description"]);
/** Longer display values are cut: a line in the Activity, not a diff. */
export const MAX_VALUE = 200;
/** A description longer than this is cut: the history dialog shows a version, not an archive. */
export const MAX_DOCUMENT = 50_000;

const cut = (value: unknown, max = MAX_VALUE): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** A display value: a document's is only whether it was there; a versioned field's is its whole text. */
const text = (value: unknown, kind: "document" | "versioned" | "value") =>
  kind === "document" ? (value ? "" : null) : cut(value, kind === "versioned" ? MAX_DOCUMENT : MAX_VALUE);

/** Jira's changelog entries, slimmed for the client: actor, time and each item's raw and display values, long text cut. */
export function slimHistory(values: readonly any[]): HistoryEntry[] {
  return values.map((entry) => ({
    id: String(entry.id),
    at: new Date(entry.created).toISOString(),
    actor: entry.author
      ? {
          id: entry.author.accountId,
          name: entry.author.displayName ?? "Unknown",
          avatar: jiraAvatar(entry.author.avatarUrls),
          ...(entry.author.accountType === "app" ? { app: true } : {}),
        }
      : null,
    items: (entry.items ?? []).map((item: any): HistoryItem => {
      const id = item.fieldId ?? item.field;
      const kind = DOCUMENT_FIELDS.has(id) ? "document" : VERSIONED_FIELDS.has(id) ? "versioned" : "value";
      return {
        field: item.field,
        ...(item.fieldId ? { fieldId: item.fieldId } : {}),
        ...(item.fieldtype === "custom" ? { custom: true } : {}),
        from: cut(item.from),
        fromText: text(item.fromString, kind),
        to: cut(item.to),
        // Jira's toString read as an own key: a missing one is Object.prototype's function, not a value.
        toText: text(Object.hasOwn(item, "toString") ? item.toString : null, kind),
      };
    }),
  }));
}

/** Every changelog page of one issue, oldest first. The first page says the total; the rest are read together. */
export async function readHistory(
  jira: <T = any>(path: string, init?: RequestInit) => Promise<T>,
  key: string,
): Promise<HistoryEntry[]> {
  const path = (startAt: number) =>
    `/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=${PAGE}`;
  const first = await jira<{ values: any[]; total: number }>(path(0));
  const starts: number[] = [];
  for (let start = PAGE; start < first.total; start += PAGE) starts.push(start);
  const rest = await Promise.all(
    starts.map((start) => jira<{ values: any[] }>(path(start)).then((page) => page.values)),
  );
  return slimHistory([...first.values, ...rest.flat()]);
}

/** History is cached per issue and Jira `updated` stamp: a changed issue is read again, an unchanged one costs nothing. */
export function historyCache(
  db: Database,
  load: (key: string) => Promise<HistoryEntry[]>,
  updated: (key: string) => string | undefined,
) {
  db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  db.run(
    "CREATE TABLE IF NOT EXISTS issue_history (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, data TEXT NOT NULL)",
  );
  const version = db
    .query<{ v: string }, []>("SELECT v FROM meta WHERE k = 'history-version'")
    .get()?.v;
  if (version !== HISTORY_CACHE_VERSION) {
    db.run("DELETE FROM issue_history");
    db.query("INSERT OR REPLACE INTO meta VALUES ('history-version', ?)").run(
      HISTORY_CACHE_VERSION,
    );
  }
  const pending = new Map<string, Promise<string | undefined>>();
  async function readHistoryJson(key: string) {
    const stamp = updated(key);
    if (stamp === undefined) return;
    const cached = db
      .query<{ source_updated: string; data: string }, [string]>(
        "SELECT source_updated,data FROM issue_history WHERE key = ?",
      )
      .get(key);
    if (cached && cached.source_updated === stamp) return cached.data;
    const data = JSON.stringify(await load(key));
    db.query("INSERT OR REPLACE INTO issue_history VALUES (?,?,?)").run(key, stamp, data);
    return data;
  }
  /** A read already in flight for the issue is joined. */
  return (key: string): Promise<string | undefined> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const request = readHistoryJson(key).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
