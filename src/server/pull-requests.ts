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
