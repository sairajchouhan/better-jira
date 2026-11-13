import { expect, test } from "bun:test";
import { readPullRequests } from "./pull-requests";

test("pull requests are read with GETs only: the issue id, the summary's providers, then each provider's detail", async () => {
  const calls: string[] = [];
  const jira = async (path: string): Promise<any> => {
    calls.push(path);
    if (path.startsWith("/rest/api/3/issue/")) return { id: "100" };
    if (path.includes("/summary")) return { summary: { pullrequest: { byInstanceType: { GitHub: { count: 1 } } } } };
    return { detail: [{ pullRequests: [{ id: "#4", name: "Fix", url: "https://github.com/a/b/pull/4", status: "OPEN" }] }] };
  };
  const prs = await readPullRequests(jira as never, "K-1");
  expect(calls).toEqual([
    "/rest/api/3/issue/K-1?fields=created",
    "/rest/dev-status/latest/issue/summary?issueId=100",
    "/rest/dev-status/latest/issue/detail?issueId=100&applicationType=GitHub&dataType=pullrequest",
  ]);
  expect(prs.map((p) => p.number)).toEqual(["#4"]);
});
