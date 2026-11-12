import type { Database } from "bun:sqlite";
import { smartLink, type SmartLinkDetails } from "@/shared/smart-link";

/** An issue's status moves, so its read is short-lived; a page title rarely changes. Misses are kept as long as issues. */
export const ISSUE_FRESH_MS = 10 * 60_000;
export const PAGE_FRESH_MS = 24 * 3600_000;

/**
 * The title (and an issue's status) behind a smart link on the configured site, read once with the site's credentials and
 * kept in SQLite like the history cache (BJ-16). Issues: Jira's issue read. Confluence pages: Confluence's v2 page read,
 * the same Atlassian account. Anything else, or another site, is never fetched: null.
 */
export function smartLinkCache(
  db: Database,
  site: string,
  read: <T = any>(path: string) => Promise<T>,
  now: () => number = Date.now,
) {
  db.run("CREATE TABLE IF NOT EXISTS smart_links (url TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL)");
  const origin = new URL(site).origin;
  async function load(url: string): Promise<{ details: SmartLinkDetails | null; fresh: number } | undefined> {
    const link = smartLink(url);
    if (!link || link.kind === "external" || link.site !== origin) return;
    try {
      if (link.kind === "issue") {
        const issue = await read<any>(`/rest/api/3/issue/${encodeURIComponent(link.key)}?fields=summary,status`);
        return {
          fresh: ISSUE_FRESH_MS,
          details: {
            title: String(issue.fields?.summary ?? ""),
            ...(issue.fields?.status
              ? {
                  status: {
                    name: String(issue.fields.status.name ?? ""),
                    category: String(issue.fields.status.statusCategory?.key ?? "new"),
                  },
                }
              : {}),
          },
        };
      }
      if (!link.pageId) return;
      const page = await read<any>(`/wiki/api/v2/pages/${link.pageId}`);
      return { fresh: PAGE_FRESH_MS, details: typeof page?.title === "string" ? { title: page.title } : null };
    } catch (error) {
      // Jira's refusal (gone, no permission, no Confluence): remembered as nothing. A network failure is tried again.
      if ((error as { status?: number }).status) return { fresh: ISSUE_FRESH_MS, details: null };
      throw error;
    }
  }
  const pending = new Map<string, Promise<SmartLinkDetails | null>>();
  async function resolve(url: string): Promise<SmartLinkDetails | null> {
    const row = db
      .query<{ at: number; data: string }, [string]>("SELECT at, data FROM smart_links WHERE url = ?")
      .get(url);
    const cached = row ? (JSON.parse(row.data) as { fresh: number; details: SmartLinkDetails | null }) : undefined;
    if (row && cached && now() - row.at < cached.fresh) return cached.details;
    try {
      const result = await load(url);
      if (!result) return null;
      db.query("INSERT OR REPLACE INTO smart_links VALUES (?, ?, ?)").run(url, now(), JSON.stringify(result));
      db.run("DELETE FROM smart_links WHERE url NOT IN (SELECT url FROM smart_links ORDER BY at DESC LIMIT 5000)");
      return result.details;
    } catch {
      return cached?.details ?? null; // offline: an old title beats none
    }
  }
  /** A read already in flight for the URL is joined. */
  return (url: string): Promise<SmartLinkDetails | null> => {
    const existing = pending.get(url);
    if (existing) return existing;
    const request = resolve(url).finally(() => pending.delete(url));
    pending.set(url, request);
    return request;
  };
}
