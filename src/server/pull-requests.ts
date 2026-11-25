import type { Database } from "bun:sqlite";
import { pullRequestList, pullRequestProviders, withLinkedPullRequests, type PullRequest } from "@/shared/pull-requests";

type Read = <T = any>(path: string) => Promise<T>;

/** The issue's pull requests from Jira's development panel, read-only: the issue's id, the providers its development summary counts
 *  pull requests for, then each provider's pull request detail. */
export async function readPullRequests(jira: Read, key: string): Promise<PullRequest[]> {
  const { id } = await jira<{ id: string }>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=created`);
  const at = `issueId=${encodeURIComponent(id)}`;
  const providers = pullRequestProviders(await jira(`/rest/dev-status/latest/issue/summary?${at}`));
  const details = await Promise.all(
    providers.map((type) =>
      jira(`/rest/dev-status/latest/issue/detail?${at}&applicationType=${encodeURIComponent(type)}&dataType=pullrequest`),
    ),
  );
  return pullRequestList(details, providers);
}

const PAGE = 100;
/** The board's issues Jira's development index links a pull request to, by key: one JQL read per page, keys only. */
export async function readLinkedPullRequestKeys(jira: Read, board: number): Promise<string[]> {
  const keys: string[] = [];
  for (let startAt = 0, total = 1; startAt < total; ) {
    const page = await jira<{ total: number; issues: { key: string }[] }>(
      `/rest/agile/1.0/board/${board}/issue?` +
        new URLSearchParams({
          jql: "development[pullrequests].all > 0",
          fields: "key",
          startAt: String(startAt),
          maxResults: String(PAGE),
        }),
    );
    keys.push(...page.issues.map((i) => i.key));
    total = page.total;
    if (!page.issues.length) break;
    startAt += page.issues.length;
  }
  return keys;
}

/** Which of a board's issues have pull requests, by Jira's development index, kept per board in the mirror's meta table so a
 *  restart keeps it. The mirror passes every issue it projects through `apply`; `refresh` re-reads a board's set and returns the
 *  issues whose answer it changed, or null on the board's first read, when every issue's answer may have. Linking a pull request leaves the issue's `updated` alone, so the board's own sync never sees
 *  it; and the Development field it reads lags the index. */
export function linkedPullRequests(store: { get: (k: string) => string | undefined; set: (k: string, v: string) => void }) {
  const boards = new Map<number, Set<string>>();
  const linked = (board: number) => {
    let keys = boards.get(board);
    if (!keys) {
      const saved = store.get(`prs:${board}`);
      if (saved === undefined) return undefined;
      boards.set(board, (keys = new Set(JSON.parse(saved) as string[])));
    }
    return keys;
  };
  return {
    /** `boards` hold the issue: it has pull requests when any of their reads links one, and stays as its field says until one
     *  of them is read. */
    apply: <T extends { key: string; prCount?: number; prStatus?: PullRequest["status"] }>(issue: T, boards: readonly number[]): T => {
      const read = boards.flatMap((board) => linked(board) ?? []);
      return withLinkedPullRequests(issue, read.length ? read.some((keys) => keys.has(issue.key)) : undefined);
    },
    async refresh(jira: Read, board: number): Promise<string[] | null> {
      const before = linked(board);
      const now = new Set(await readLinkedPullRequestKeys(jira, board));
      boards.set(board, now);
      store.set(`prs:${board}`, JSON.stringify([...now]));
      if (!before) return null;
      return [...new Set([...before, ...now])].filter((key) => before.has(key) !== now.has(key));
    },
  };
}

type JiraPullRequests = { prCount?: number; prStatus?: PullRequest["status"] };
/** What a stored number was read for: Jira's own count and state of the issue's pull requests. */
const signatureOf = (issue: JiraPullRequests) => ({ count: issue.prCount ?? 0, status: issue.prStatus ?? "" });

/** The number of an issue's one pull request by Jira's development detail, kept in the mirror's database so a restart keeps it.
 *  Jira's Development field gives only a count and a state, so the detail is read once per issue that has one pull request, and
 *  again only when Jira's count or state for it changes. Each number is stored with the count and state it was read for. */
export function pullRequestNumbers(db: Database) {
  db.run(
    "CREATE TABLE IF NOT EXISTS pr_numbers (key TEXT PRIMARY KEY, count INTEGER NOT NULL, status TEXT NOT NULL, number TEXT NOT NULL)",
  );
  const stored = new Map(
    db
      .query<{ key: string; count: number; status: string; number: string }, []>("SELECT key, count, status, number FROM pr_numbers")
      .all()
      .map(({ key, ...row }) => [key, row]),
  );
  const forget = (key: string) => {
    if (stored.delete(key)) db.query("DELETE FROM pr_numbers WHERE key = ?").run(key);
  };
  return {
    /** The number to project for the issue as Jira alone counts its pull requests. While Jira still counts one, the stored number
     *  stands even after its state moved (the same pull request was merged or closed: its number is unchanged) until the re-read
     *  replaces it. Jira counting none or several forgets it: a later count of one may be a different pull request. */
    apply(key: string, jira: JiraPullRequests): string | undefined {
      if (jira.prCount !== 1) return void forget(key);
      return stored.get(key)?.number || undefined;
    },
    /** Whether the issue needs its detail read: Jira counts one pull request and nothing was read for this count and state. */
    stale(key: string, jira: JiraPullRequests) {
      if (jira.prCount !== 1) return false;
      const at = stored.get(key),
        now = signatureOf(jira);
      return !at || at.count !== now.count || at.status !== now.status;
    },
    /** Stores what the detail read for the count and state `jira` had when it was read: "" when it listed none or several. */
    set(key: string, jira: JiraPullRequests, number: string) {
      if (jira.prCount !== 1) return forget(key);
      const row = { ...signatureOf(jira), number };
      stored.set(key, row);
      db.query("INSERT OR REPLACE INTO pr_numbers VALUES (?, ?, ?, ?)").run(key, row.count, row.status, row.number);
    },
  };
}
