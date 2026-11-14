import { expect, test } from "bun:test";
import {
  leadingStatus,
  mergePullRequests,
  pullRequestBadgeText,
  pullRequestList,
  pullRequestProviders,
  pullRequestStatus,
  pullRequestTool,
  withGitHubPullRequests,
  withLinkedPullRequests,
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
  expect(list.map(pullRequestStatus)).toEqual(["Open", "Closed", "Merged"]);
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
  expect(pullRequestStatus(pr(1, "inReview"))).toBe("In review");
  expect(pullRequestStatus(pr(1, "approved"))).toBe("Approved");
  expect(pullRequestStatus(pr(1, "inReview", undefined, { changesRequested: true }))).toBe("Changes requested");
  expect(pullRequestStatus(pr(1, "merged", undefined, { changesRequested: true }))).toBe("Merged");
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
