import { expect, test } from "bun:test";
import {
  issuePullRequestOrder,
  leadingStatus,
  pullRequestSections,
  reviewDecision,
  mergePullRequests,
  pullRequestBadgeText,
  pullRequestList,
  pullRequestProviders,
  pullRequestDescription,
  pullRequestIdentifier,
  pullRequestStatusText,
  pullRequestTool,
  withGitHubPullRequests,
  withLinkedPullRequests,
  withPullRequestNumber,
  singlePullRequestNumber,
  type PullRequest,
} from "./pull-requests";

test("the providers are those Jira's development summary counts pull requests for", () => {
  expect(
    pullRequestProviders({ summary: { pullrequest: { byInstanceType: { GitHub: { count: 2 }, bitbucket: { count: 0 } } } } }),
  ).toEqual(["GitHub"]);
  expect(pullRequestProviders({})).toEqual([]);
});

test("pull requests from every provider's detail: one per URL, newest first, with Jira's fields", () => {
  const pr = (id: string, status: string, lastUpdate: string) => ({
    id,
    name: `Change ${id}`,
    url: `https://github.com/acme/app/pull/${id.slice(1)}`,
    status,
    lastUpdate,
    repositoryName: "acme/app",
    author: { name: "Ana" },
    source: { branch: "ana/change" },
  });
  const list = pullRequestList([
    { detail: [{ pullRequests: [pr("#1", "MERGED", "2026-01-01T00:00:00Z"), pr("#2", "OPEN", "2026-03-01T00:00:00Z")] }] },
    { detail: [{ pullRequests: [pr("#2", "OPEN", "2026-03-01T00:00:00Z"), { ...pr("#3", "DECLINED", "2026-02-01T00:00:00Z"), id: "3" }] }] },
  ]);
  expect(list.map((p) => [p.number, p.status])).toEqual([
    ["#2", "open"],
    ["#3", "declined"],
    ["#1", "merged"],
  ]);
  expect(list[0]).toEqual({
    url: "https://github.com/acme/app/pull/2",
    title: "Change #2",
    number: "#2",
    status: "open",
    repo: "acme/app",
    author: "Ana",
    branch: "ana/change",
    updated: "2026-03-01T00:00:00Z",
  });
  // Jira's detail has no merge or close time: a merged or declined pull request's last update stands in for it.
  expect(list.map((p) => p.closedAt)).toEqual([undefined, "2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
  const now = Date.parse("2026-03-01T00:00:00Z");
  expect(list.map((p) => pullRequestStatusText(p, now))).toEqual(["Open", "Closed 4w ago", "Merged 8w ago"]);
});

test("Linear's PR badge: one PR shows its number, several \"N PRs\" with the icon of the first status in Linear's order", () => {
  expect(pullRequestBadgeText(1, "#7")).toBe("#7");
  expect(pullRequestBadgeText(1)).toBe("");
  expect(pullRequestBadgeText(3, "#7")).toBe("3 PRs");
  expect(leadingStatus([{ status: "merged" }, { status: "open" }])).toBe("open");
  expect(leadingStatus([{ status: "declined" }, { status: "merged" }, { status: "draft" }])).toBe("draft");
  expect(leadingStatus([{ status: "declined" }, { status: "merged" }])).toBe("merged");
  expect(leadingStatus([])).toBeUndefined();
});

test("each pull request keeps its target branch and its review tool's name, for Linear's Open in and Copy actions", () => {
  const pr = { id: "#5", name: "Five", url: "https://github.com/acme/app/pull/5", status: "OPEN", source: { branch: "ana/five" }, destination: { branch: "main" } };
  const [github] = pullRequestList([{ detail: [{ pullRequests: [pr] }] }], ["GitHub"]);
  expect([github!.branch, github!.target, github!.tool]).toEqual(["ana/five", "main", "GitHub"]);
  // A provider Jira names by its instance only, and one it names nowhere: no tool, so Linear's fallbacks ("Open in source").
  const [named] = pullRequestList([{ detail: [{ _instance: { name: "Forge" }, pullRequests: [pr] }] }], ["forge-x"]);
  expect(named!.tool).toBe("Forge");
  expect(pullRequestList([{ detail: [{ pullRequests: [pr] }] }])[0]!.tool).toBeUndefined();
  expect(["githube", "stash", "gitlab"].map((type) => pullRequestTool(type))).toEqual(["GitHub", "Bitbucket", "GitLab"]);
});

test("Jira's development index decides whether an issue has pull requests; its stale Development field only fills in the count", () => {
  const pr = (v: { prCount?: number; prStatus?: PullRequest["status"] }) => v;
  // The field lists none, the index links one: the badge shows, counting one until its detail is read.
  expect(withLinkedPullRequests(pr({ prCount: 0 }), true)).toEqual({ prCount: 1, prStatus: undefined });
  expect(withLinkedPullRequests(pr({}), true)).toEqual({ prCount: 1, prStatus: undefined });
  // The field still lists an unlinked one: no badge.
  expect(withLinkedPullRequests(pr({ prCount: 2, prStatus: "open" }), false)).toEqual({ prCount: 0, prStatus: undefined });
  // They agree: the field's count and state stand, the same object.
  const both = { prCount: 3, prStatus: "merged" as const };
  expect(withLinkedPullRequests(both, true)).toBe(both);
  const none = { prCount: 0 };
  expect(withLinkedPullRequests(none, false)).toBe(none);
  // The index not read yet: the field's answer.
  expect(withLinkedPullRequests(none, undefined)).toBe(none);
});

const pr = (n: number, status: PullRequest["status"], updated = "2026-11-01T00:00:00Z", extra: Partial<PullRequest> = {}): PullRequest => ({
  url: `https://github.com/acme-org/widgets/pull/${n}`,
  title: `Change ${n}`,
  number: `#${n}`,
  status,
  updated,
  ...extra,
});

test("Jira's and GitHub's pull requests merge into one row per URL, GitHub's row winning, in Linear's order", () => {
  const merged = mergePullRequests(
    [pr(1, "open", "2026-11-01T00:00:00Z", { tool: "GitHub", repo: "acme-org/widgets" }), pr(2, "merged", "2026-11-05T00:00:00Z")],
    [pr(1, "approved", "2026-11-02T00:00:00Z"), pr(3, "inReview", "2026-11-03T00:00:00Z"), pr(4, "inReview", "2026-11-04T00:00:00Z")],
  );
  // Linear's `qg`: open, in review, approved, draft, merged, closed; then the newest first.
  expect(merged.map((p) => [p.number, p.status])).toEqual([
    ["#4", "inReview"],
    ["#3", "inReview"],
    ["#1", "approved"],
    ["#2", "merged"],
  ]);
});

test("the in-review and approved states lead after open, and read as Linear labels them", () => {
  expect(leadingStatus([{ status: "merged" }, { status: "approved" }, { status: "inReview" }, { status: "draft" }])).toBe("inReview");
  expect(pullRequestStatusText(pr(1, "inReview"))).toBe("In review");
  expect(pullRequestStatusText(pr(1, "approved"))).toBe("Approved");
  expect(pullRequestStatusText(pr(1, "inReview", undefined, { changesRequested: true }))).toBe("Changes requested");
  expect(pullRequestStatusText(pr(1, "merged", undefined, { changesRequested: true }))).toBe("Merged");
});

test("GitHub's pull requests add to an issue's count and state; one both sources link counts once", () => {
  const github = [pr(1, "inReview"), pr(2, "merged")];
  const issue = (v: { key: string; prCount?: number; prStatus?: PullRequest["status"] }) => v;
  expect(withGitHubPullRequests(issue({ key: "ACME-1" }), [])).toEqual({ key: "ACME-1" });
  expect(withGitHubPullRequests(issue({ key: "ACME-1", prCount: 0 }), github)).toEqual({ key: "ACME-1", prCount: 2, prStatus: "inReview" });
  // Jira's panel not read yet: the sources add up.
  expect(withGitHubPullRequests(issue({ key: "ACME-1", prCount: 1, prStatus: "draft" }), github)).toEqual({ key: "ACME-1", prCount: 3, prStatus: "inReview" });
  // Read: Jira lists #1 too, so it counts once.
  expect(withGitHubPullRequests(issue({ key: "ACME-1", prCount: 1, prStatus: "open" }), github, [github[0]!.url])).toEqual({
    key: "ACME-1",
    prCount: 2,
    prStatus: "open",
  });
});

// ——— The issue sidebar's "Diffs" list (Linear IssueDetailsPaneSidebar `Qh`, `xg`, `yg`, `mg`) ———

const row = (n: number, status: PullRequest["status"], updated = `2026-11-${String(n).padStart(2, "0")}T10:00:00Z`): PullRequest => ({
  url: `https://github.com/acme/app/pull/${n}`,
  title: `Change ${n}`,
  number: `#${n}`,
  status,
  updated,
});
const numbers = (prs: PullRequest[]) => prs.map((pr) => pr.number);

test("the issue sidebar lists open pull requests (draft and in review too) first, then merged, then closed; newest first in each", () => {
  const prs = [row(1, "declined"), row(2, "merged"), row(3, "draft"), row(4, "open"), row(5, "merged"), row(6, "inReview")];
  expect(numbers(issuePullRequestOrder(prs))).toEqual(["#6", "#4", "#3", "#5", "#2", "#1"]);
});

test("three rows show; the rest fold under Show N more only when that hides two or more", () => {
  const four = [1, 2, 3, 4].map((n) => row(n, "open"));
  expect(pullRequestSections(four)).toEqual({ shown: four, more: [], closed: [], closedFold: false });
  const five = [1, 2, 3, 4, 5].map((n) => row(n, "open"));
  const sections = pullRequestSections(five);
  expect([numbers(sections.shown), numbers(sections.more)]).toEqual([["#1", "#2", "#3"], ["#4", "#5"]]);
});

test("closed pull requests sit apart: one shows outright, two or more fold under their own toggle", () => {
  const one = pullRequestSections([row(1, "open"), row(2, "declined")]);
  expect([numbers(one.shown), numbers(one.closed), one.closedFold]).toEqual([["#1"], ["#2"], false]);
  const two = pullRequestSections([row(1, "open"), row(2, "declined"), row(3, "declined")]);
  expect([numbers(two.shown), numbers(two.more), numbers(two.closed), two.closedFold]).toEqual([["#1"], [], ["#2", "#3"], true]);
});

test("when both the extra rows and the closed ones can fold, they fold together under one Show N more", () => {
  const prs = [1, 2, 3, 4, 5].map((n) => row(n, "open")).concat([row(6, "declined"), row(7, "declined")]);
  const sections = pullRequestSections(prs);
  expect([numbers(sections.shown), numbers(sections.more), sections.closed]).toEqual([["#1", "#2", "#3"], ["#4", "#5", "#6", "#7"], []]);
});

test("an issue whose pull requests are all closed lists them as its rows", () => {
  const prs = [row(1, "declined"), row(2, "declined")];
  expect(pullRequestSections(prs)).toEqual({ shown: prs, more: [], closed: [], closedFold: false });
});

test("an open pull request's row names its review: changes requested over approved; none once merged or closed", () => {
  expect(reviewDecision({ ...row(1, "approved"), changesRequested: true })).toEqual({ label: "Changes requested", status: "blocked" });
  expect(reviewDecision(row(1, "approved"))).toEqual({ label: "Approved", status: "approved" });
  expect(reviewDecision(row(1, "inReview"))).toBeUndefined();
  expect(reviewDecision({ ...row(1, "merged"), changesRequested: true })).toBeUndefined();
});

test("the pull request card's status line leaves reviews out: in review and approved are Open", () => {
  const card = (pr: PullRequest) => pullRequestStatusText(pr, Date.now(), { reviews: false });
  expect(card({ ...row(1, "inReview"), changesRequested: true })).toBe("Open");
  expect((["open", "inReview", "approved", "draft", "merged", "declined"] as const).map((s) => card(row(1, s)))).toEqual([
    "Open",
    "Open",
    "Open",
    "Draft",
    "Merged",
    "Closed",
  ]);
});

test("a merged or closed pull request says how long ago, as Linear's statusForPopoversAndActions; open and draft ones don't", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const done = (status: PullRequest["status"], closedAt: string) => ({ ...row(1, status), closedAt });
  expect(pullRequestStatusText(done("merged", "2026-11-11T12:00:00Z"), now)).toBe("Merged 3d ago");
  expect(pullRequestStatusText(done("declined", "2026-11-14T11:15:00Z"), now)).toBe("Closed 45min ago");
  // The card's line (no reviews) says it too.
  expect(pullRequestStatusText(done("merged", "2026-11-14T09:00:00Z"), now, { reviews: false })).toBe("Merged 3h ago");
  // Without a time: the status alone.
  expect(pullRequestStatusText(row(1, "merged"), now)).toBe("Merged");
  // Only merged and closed ones carry it.
  expect(pullRequestStatusText(done("open", "2026-11-11T12:00:00Z"), now)).toBe("Open");
  expect(pullRequestStatusText(done("draft", "2026-11-11T12:00:00Z"), now)).toBe("Draft");
});

test("a row of several names its pull request as Linear's description: owner/repo#N · status", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  expect(pullRequestIdentifier({ owner: "acme", repo: "app", number: "#4" })).toBe("acme/app#4");
  expect(pullRequestIdentifier({ repo: "acme/app", number: "#4" })).toBe("acme/app#4");
  expect(pullRequestDescription({ ...row(4, "inReview"), owner: "acme", repo: "app", changesRequested: true }, now)).toBe(
    "acme/app#4 · Changes requested",
  );
  expect(pullRequestDescription({ ...row(4, "merged"), repo: "app", closedAt: "2026-11-13T12:00:00Z" }, now)).toBe("app#4 · Merged 1d ago");
});

test("an issue with one pull request carries its number, GitHub's or Jira's detail's; none or several carry none", () => {
  type Fields = { key: string; prCount?: number; prStatus?: PullRequest["status"]; prNumber?: string };
  const issue = (v: Fields) => v;
  // GitHub links the one pull request: its own number.
  expect(withPullRequestNumber(issue({ key: "ACME-1", prCount: 1, prStatus: "open" }), [pr(2965, "open")])).toEqual({
    key: "ACME-1",
    prCount: 1,
    prStatus: "open",
    prNumber: "#2965",
  });
  // GitHub's row wins over a number Jira's detail read.
  expect(withPullRequestNumber(issue({ key: "ACME-1", prCount: 1 }), [pr(7, "open")], "#6").prNumber).toBe("#7");
  // Jira alone: the number its development detail gave.
  expect(withPullRequestNumber(issue({ key: "ACME-1", prCount: 1, prStatus: "merged" }), [], "#41").prNumber).toBe("#41");
  // Not read yet, or the detail listed none: no number.
  expect(withPullRequestNumber(issue({ key: "ACME-1", prCount: 1 }), [])).toEqual({ key: "ACME-1", prCount: 1 });
  expect(withPullRequestNumber(issue({ key: "ACME-1", prCount: 1 }), [], "")).toEqual({ key: "ACME-1", prCount: 1 });
  // None or several: none, and a number the issue carried before goes.
  expect(withPullRequestNumber(issue({ key: "ACME-1", prCount: 0, prNumber: "#41" }), [], "#41")).toEqual({ key: "ACME-1", prCount: 0 });
  expect(withPullRequestNumber(issue({ key: "ACME-1", prCount: 2, prNumber: "#41" }), [pr(1, "open"), pr(2, "open")], "#41")).toEqual({
    key: "ACME-1",
    prCount: 2,
  });
  expect(withPullRequestNumber(issue({ key: "ACME-1" }), [])).toEqual({ key: "ACME-1" });
});

test("a list names its pull request's number only when it lists exactly one", () => {
  expect(singlePullRequestNumber([pr(12, "open")])).toBe("#12");
  expect(singlePullRequestNumber([])).toBe("");
  expect(singlePullRequestNumber([pr(1, "open"), pr(2, "open")])).toBe("");
});
