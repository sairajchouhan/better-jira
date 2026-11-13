import { expect, test } from "bun:test";
import { leadingStatus, pullRequestBadgeText, pullRequestList, pullRequestProviders, pullRequestStatus, pullRequestTool } from "./pull-requests";

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
