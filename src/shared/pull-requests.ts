/** A pull request linked to the issue: by Jira's development panel (`/rest/dev-status/latest/issue/detail`, dataType pullrequest),
 *  or read straight from GitHub (`src/server/github-pull-requests.ts`). */
export type PullRequest = {
  url: string;
  title: string;
  /** Jira's PR id as the provider shows it: "#12" on GitHub. */
  number: string;
  /** Linear's `statusBasedOnReviews` (`HE`: draft, open, inReview, approved, merged, closed; our "declined" is its closed). Jira has
   *  no review states; only GitHub's own answer gives inReview and approved. */
  status: "open" | "inReview" | "approved" | "merged" | "declined" | "draft";
  /** A reviewer asked for changes: Linear's row says "Changes requested" (`statusForPopoversAndActions`) over "In review". */
  changesRequested?: boolean;
  repo?: string;
  author?: string;
  /** The source branch Jira lists (`source.branch`) and the one it merges into (`destination.branch`). */
  branch?: string;
  target?: string;
  /** The review tool's name, as Linear's `externalReviewToolLabel` ("GitHub"): "Open in GitHub", "Copy GitHub URL". */
  tool?: string;
  updated?: string;
};

/** Jira's development providers (the summary's `byInstanceType` keys, e.g. "GitHub", "githube", "bitbucket") by the name their
 *  review tool goes by. */
const TOOLS: Record<string, string> = { github: "GitHub", githube: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", stash: "Bitbucket" };
/** The review tool's name for a provider detail: Jira's instance type, or its own instance name for one we don't know. */
export const pullRequestTool = (type: unknown, instance?: { name?: unknown; typeName?: unknown }) => {
  const known = TOOLS[String(type ?? "").toLowerCase()];
  const named = instance?.typeName ?? instance?.name;
  return known ?? (typeof named === "string" && named ? named : typeof type === "string" && type ? type : undefined);
};

const STATUS: Record<string, PullRequest["status"]> = { OPEN: "open", MERGED: "merged", DECLINED: "declined", DRAFT: "draft" };
/** Jira's pull request state (OPEN, MERGED, DECLINED, DRAFT) as ours; anything else is unknown. */
export const jiraPullRequestStatus = (state: unknown): PullRequest["status"] | undefined => STATUS[String(state).toUpperCase()];

/** Linear's order for the one status icon a set of PRs shows (`Hpn`: open, in review, approved, draft, merged, closed), and the
 *  first key its PR lists sort by (`qg`). */
const LEADING: PullRequest["status"][] = ["open", "inReview", "approved", "draft", "merged", "declined"];
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

/** Every provider's detail answer as one list, most recently updated first (Linear's `qg(r, "desc")`); one row per URL. `providers`
 *  names the provider each answer came from, in the same order. */
export function pullRequestList(details: any[], providers: string[] = []): PullRequest[] {
  const byUrl = new Map<string, PullRequest>();
  for (const [index, answer] of details.entries())
    for (const detail of answer?.detail ?? [])
      for (const pr of detail?.pullRequests ?? []) {
        if (typeof pr?.url !== "string" || byUrl.has(pr.url)) continue;
        const id = String(pr.id ?? "");
        const tool = pullRequestTool(providers[index], detail?._instance);
        byUrl.set(pr.url, {
          url: pr.url,
          title: typeof pr.name === "string" && pr.name ? pr.name : pr.url,
          number: id ? (id.startsWith("#") ? id : `#${id}`) : "",
          status: jiraPullRequestStatus(pr.status) ?? "open",
          ...(pr.repositoryName ? { repo: pr.repositoryName } : {}),
          ...(pr.author?.name ? { author: pr.author.name } : {}),
          ...(pr.source?.branch ? { branch: pr.source.branch } : {}),
          ...(pr.destination?.branch ? { target: pr.destination.branch } : {}),
          ...(tool ? { tool } : {}),
          ...(pr.lastUpdate ? { updated: pr.lastUpdate } : {}),
        });
      }
  return [...byUrl.values()].sort((a, b) => Date.parse(b.updated ?? "") - Date.parse(a.updated ?? "") || 0);
}

/** Linear's PR status label (`bj.statusLabel`), with its open pull request's review answer (`statusForPopoversAndActions`): "Changes
 *  requested" when a reviewer asked for changes. */
export const pullRequestStatus = (pr: PullRequest) =>
  pr.changesRequested && (pr.status === "open" || pr.status === "inReview" || pr.status === "approved")
    ? "Changes requested"
    : { open: "Open", inReview: "In review", approved: "Approved", merged: "Merged", declined: "Closed", draft: "Draft" }[pr.status];

/** Linear's PR list order (`qg(prs, "desc")`): by status in `LEADING` order, then the newest first. */
export const sortPullRequests = (prs: PullRequest[]) =>
  prs.toSorted(
    (a, b) =>
      LEADING.indexOf(a.status) - LEADING.indexOf(b.status) ||
      (Date.parse(b.updated ?? "") || 0) - (Date.parse(a.updated ?? "") || 0),
  );

/** One list of an issue's pull requests from Jira's development panel and from GitHub, one row per URL. GitHub's row wins: it
 *  carries the review state Jira doesn't. */
export function mergePullRequests(jira: PullRequest[], github: PullRequest[]): PullRequest[] {
  const byUrl = new Map(jira.map((pr) => [pr.url, pr]));
  for (const pr of github) byUrl.set(pr.url, pr);
  return sortPullRequests([...byUrl.values()]);
}

type PullRequestFields = { prCount?: number; prStatus?: PullRequest["status"] };
/** An issue's pull request count and state with Jira's development index as the judge of whether it has any. Jira's Development
 *  field (`customfield_10000`) is a cached summary that lags the index: it can list no pull request for an issue the index links
 *  one to, or still list one that was unlinked. `linked` is the index's answer (JQL `development[pullrequests].all > 0`); unknown
 *  leaves the field's answer. Where they agree the field's count and state stand; an issue the field misses counts one, with no
 *  state, until the badge reads its detail. */
export function withLinkedPullRequests<T extends PullRequestFields>(issue: T, linked: boolean | undefined): T {
  if (linked === undefined || linked === !!issue.prCount) return issue;
  return { ...issue, prCount: linked ? 1 : 0, prStatus: undefined };
}

/** An issue's pull request count and state with the pull requests GitHub links to it added. `jiraUrls` are the pull requests
 *  Jira's development panel lists for the issue, when read: a pull request both sources link counts once. Unread, Jira's count
 *  and GitHub's add up (Jira's GitHub app and the GitHub source usually cover different organisations) until the panel is read. */
export function withGitHubPullRequests<T extends PullRequestFields>(issue: T, github: PullRequest[], jiraUrls?: string[]): T {
  if (!github.length) return issue;
  const jira = issue.prCount ?? 0;
  if (!jira) return { ...issue, prCount: github.length, prStatus: leadingStatus(github) };
  const extra = jiraUrls ? github.filter((pr) => !jiraUrls.includes(pr.url)) : github;
  const count = (jiraUrls ? jiraUrls.length : jira) + extra.length;
  return { ...issue, prCount: count, prStatus: leadingStatus([...(issue.prStatus ? [{ status: issue.prStatus }] : []), ...github]) };
}
