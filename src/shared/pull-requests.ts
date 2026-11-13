/** A pull request Jira's development panel links to the issue (`/rest/dev-status/latest/issue/detail`, dataType pullrequest). */
export type PullRequest = {
  url: string;
  title: string;
  /** Jira's PR id as the provider shows it: "#12" on GitHub. */
  number: string;
  status: "open" | "merged" | "declined" | "draft";
  repo?: string;
  author?: string;
  branch?: string;
  updated?: string;
};

const STATUS: Record<string, PullRequest["status"]> = { OPEN: "open", MERGED: "merged", DECLINED: "declined", DRAFT: "draft" };
/** Jira's pull request state (OPEN, MERGED, DECLINED, DRAFT) as ours; anything else is unknown. */
export const jiraPullRequestStatus = (state: unknown): PullRequest["status"] | undefined => STATUS[String(state).toUpperCase()];

/** Linear's order for the one status icon a set of PRs shows (`Hpn`: open, in review, approved, draft, merged, closed; Jira has no
 *  review states). */
const LEADING: PullRequest["status"][] = ["open", "draft", "merged", "declined"];
/** The status Linear's PR badge icon shows for several PRs (`Upn`): the first in `LEADING` any of them has. */
export const leadingStatus = (prs: Pick<PullRequest, "status">[]) =>
  LEADING.find((status) => prs.some((pr) => pr.status === status));

/** Linear's PR badge text (`mhn`): the one PR's number (`prNumber`, "#12"), or "N PRs" for several. */
export const pullRequestBadgeText = (count: number, number?: string) => (count === 1 ? (number ?? "") : `${count} PRs`);

/** The providers Jira's summary counts pull requests for (`summary.pullrequest.byInstanceType`), e.g. "GitHub". */
export function pullRequestProviders(summary: any): string[] {
  const types = summary?.summary?.pullrequest?.byInstanceType;
  if (!types || typeof types !== "object") return [];
  return Object.entries(types).flatMap(([type, value]: [string, any]) => (value?.count ? [type] : []));
}

/** Every provider's detail answer as one list, most recently updated first (Linear's `qg(r, "desc")`); one row per URL. */
export function pullRequestList(details: any[]): PullRequest[] {
  const byUrl = new Map<string, PullRequest>();
  for (const answer of details)
    for (const detail of answer?.detail ?? [])
      for (const pr of detail?.pullRequests ?? []) {
        if (typeof pr?.url !== "string" || byUrl.has(pr.url)) continue;
        const id = String(pr.id ?? "");
        byUrl.set(pr.url, {
          url: pr.url,
          title: typeof pr.name === "string" && pr.name ? pr.name : pr.url,
          number: id ? (id.startsWith("#") ? id : `#${id}`) : "",
          status: jiraPullRequestStatus(pr.status) ?? "open",
          ...(pr.repositoryName ? { repo: pr.repositoryName } : {}),
          ...(pr.author?.name ? { author: pr.author.name } : {}),
          ...(pr.source?.branch ? { branch: pr.source.branch } : {}),
          ...(pr.lastUpdate ? { updated: pr.lastUpdate } : {}),
        });
      }
  return [...byUrl.values()].sort((a, b) => Date.parse(b.updated ?? "") - Date.parse(a.updated ?? "") || 0);
}

/** Linear's PR status label (`bj.statusLabel`). */
export const pullRequestStatus = (pr: PullRequest) =>
  ({ open: "Open", merged: "Merged", declined: "Closed", draft: "Draft" })[pr.status];
