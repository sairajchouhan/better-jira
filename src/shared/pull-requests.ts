import { shortDuration } from "./duration";

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
  /** The repository's owner when the source names it apart from `repo` (GitHub's `repository.owner`; Jira's `repositoryName` is
   *  already "owner/repo"): Linear's `repoOwner`, in the row's `fullIdentifier`. */
  owner?: string;
  author?: string;
  /** The source branch Jira lists (`source.branch`) and the one it merges into (`destination.branch`). */
  branch?: string;
  target?: string;
  /** The review tool's name, as Linear's `externalReviewToolLabel` ("GitHub"): "Open in GitHub", "Copy GitHub URL". */
  tool?: string;
  updated?: string;
  /** When it merged or closed: Linear's `mergedAt` / `closedAt`, the time in "Merged 3d ago". */
  closedAt?: string;
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
          // Jira's detail has no merge or close time; a merged or declined pull request's last update stands in for it.
          ...(pr.lastUpdate && /^(MERGED|DECLINED)$/i.test(String(pr.status)) ? { closedAt: pr.lastUpdate } : {}),
        });
      }
  return [...byUrl.values()].sort((a, b) => Date.parse(b.updated ?? "") - Date.parse(a.updated ?? "") || 0);
}

/** Linear's PR status text (`AP.statusForPopoversAndActions`, through `qhn`): an open pull request (not a draft) says its review
 *  answer, "Changes requested" over "Approved" over its status ("Open", "In review"), or only "Open" without `reviews` (the card,
 *  `showReviewStatus: false`); a draft "Draft"; a merged or closed one "Merged" / "Closed", with how long ago when known
 *  ("Merged 3d ago", `Uf(now, mergedAt, { singlePart: true })`). */
export function pullRequestStatusText(pr: PullRequest, now = Date.now(), { reviews = true }: { reviews?: boolean } = {}): string {
  if (pr.status === "draft") return "Draft";
  if (pr.status === "merged" || pr.status === "declined") {
    const text = pr.status === "merged" ? "Merged" : "Closed";
    const at = Date.parse(pr.closedAt ?? "");
    return Number.isNaN(at) ? text : `${text} ${shortDuration(now - at)} ago`;
  }
  if (!reviews) return "Open";
  if (pr.changesRequested) return "Changes requested";
  return { open: "Open", inReview: "In review", approved: "Approved" }[pr.status];
}

/** Linear's `fullIdentifier`: owner, repository and number ("acme/app#12"). */
export const pullRequestIdentifier = (pr: Pick<PullRequest, "owner" | "repo" | "number">) =>
  `${pr.owner ? `${pr.owner}/` : ""}${pr.repo ?? ""}${pr.number}`;

/** Linear's PR row line under the title (`AP.description`): the identifier and the status, " · " between. */
export const pullRequestDescription = (pr: PullRequest, now = Date.now()) =>
  [pullRequestIdentifier(pr), pullRequestStatusText(pr, now)].filter(Boolean).join(" · ");

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

type PullRequestFields = { prCount?: number; prStatus?: PullRequest["status"]; prNumber?: string };
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

/** The one pull request's number a list gives ("#12"), or "" when it lists none or several. */
export const singlePullRequestNumber = (prs: Pick<PullRequest, "number">[]) => (prs.length === 1 ? prs[0]!.number : "");

/** An issue's `prNumber`: the number of its one pull request, carried with the count so the badge draws "#12" on its first paint
 *  as Linear's `mhn` does (it reads `prNumber` off the pull request model it already holds). GitHub's own row names it when GitHub
 *  links the one pull request; otherwise `jira` is the number Jira's development detail gave. Gone for none or several. */
export function withPullRequestNumber<T extends PullRequestFields>(
  issue: T,
  github: PullRequest[],
  jira?: string,
): T & { prNumber?: string } {
  const { prNumber: _, ...rest } = issue;
  const number = issue.prCount !== 1 ? undefined : github.length === 1 ? github[0]!.number : jira;
  return (number ? { ...rest, prNumber: number } : rest) as T;
}

// ——— The issue's sidebar list (Linear's "Diffs" section: IssueDetailsPaneSidebar `Cg` → `yg` → `pg`) ———

/** Linear's `$h`: an issue's pull request rows put open ones (open, in review, approved, draft) first, merged next, closed last. */
const sidebarRank = (pr: Pick<PullRequest, "status">) => (pr.status === "declined" ? 2 : pr.status === "merged" ? 1 : 0);
/** Linear's issue sidebar order (`Qh`): by `$h`, then the newest first. Linear sorts by when the pull request was linked
 *  (`createdAt`); neither Jira nor GitHub says that, so the last update stands in. */
export const issuePullRequestOrder = (prs: PullRequest[]) =>
  prs.toSorted(
    (a, b) => sidebarRank(a) - sidebarRank(b) || (Date.parse(b.updated ?? "") || 0) - (Date.parse(a.updated ?? "") || 0),
  );

/** Linear's `bg`: the rows the sidebar shows before "Show N more". */
export const SIDEBAR_PULL_REQUESTS = 3;
/** Linear's `Ok.canHide`: a toggle never hides a single row. */
const canHide = (count: number) => count >= 2;

export type PullRequestSections = {
  /** Always shown. */
  shown: PullRequest[];
  /** Behind "Show N more" / "Show less": the rows past the first three, with the closed ones when both can hide. */
  more: PullRequest[];
  /** Below the rest when they don't fold into `more`: shown outright when one, else behind "N closed" / "Hide closed". */
  closed: PullRequest[];
  closedFold: boolean;
};
/** How Linear's sidebar list (`yg` with `xg` and `Ok.split`) lays out an issue's pull requests, already in `issuePullRequestOrder`.
 *  Closed ones set apart unless every one is closed; three rows show, the rest fold under "Show N more" when that hides two or more;
 *  when that fold exists and the closed ones can fold too, they join it, otherwise they get their own "N closed" toggle (from two). */
export function pullRequestSections(prs: PullRequest[]): PullRequestSections {
  const open = prs.filter((pr) => pr.status !== "declined");
  const [rows, closed] = open.length ? [open, prs.filter((pr) => pr.status === "declined")] : [prs, []];
  const split = canHide(rows.length - SIDEBAR_PULL_REQUESTS);
  const shown = split ? rows.slice(0, SIDEBAR_PULL_REQUESTS) : rows;
  const hidden = split ? rows.slice(SIDEBAR_PULL_REQUESTS) : [];
  const closedFold = canHide(closed.length);
  if (hidden.length && closedFold) return { shown, more: [...hidden, ...closed], closed: [], closedFold: false };
  return { shown, more: hidden, closed, closedFold };
}

/** Linear's review answer on an open pull request's row (`mg`): changes requested wins over approved. */
export type ReviewDecision = { label: "Changes requested"; status: "blocked" } | { label: "Approved"; status: "approved" };
const isOpen = (pr: Pick<PullRequest, "status">) => pr.status !== "merged" && pr.status !== "declined";
export function reviewDecision(pr: PullRequest): ReviewDecision | undefined {
  if (!isOpen(pr)) return undefined;
  if (pr.changesRequested) return { label: "Changes requested", status: "blocked" };
  if (pr.status === "approved") return { label: "Approved", status: "approved" };
  return undefined;
}
