/** A pull request Jira's development panel links to the issue (`/rest/dev-status/latest/issue/detail`, dataType pullrequest). */
export type PullRequest = {
  url: string;
  title: string;
  /** Jira's PR id as the provider shows it: "#12" on GitHub. */
  number: string;
  status: "open" | "merged" | "declined" | "draft";
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

/** Linear's PR status label (`bj.statusLabel`). */
export const pullRequestStatus = (pr: PullRequest) =>
  ({ open: "Open", merged: "Merged", declined: "Closed", draft: "Draft" })[pr.status];
