import { expect, test } from "bun:test";
import { pullRequestList, pullRequestProviders, pullRequestStatus } from "./pull-requests";

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
