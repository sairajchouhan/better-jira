import { expect, test } from "bun:test";
import { linkedPullRequests, readLinkedPullRequestKeys, readPullRequests } from "./pull-requests";
import type { PullRequest } from "@/shared/pull-requests";

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

test("a board's issues with pull requests come from Jira's development index, page by page, keys only", async () => {
  const calls: string[] = [];
  const jira = async (path: string): Promise<any> => {
    calls.push(path);
    const start = Number(new URL(path, "https://x.test").searchParams.get("startAt"));
    return start === 0 ? { total: 3, issues: [{ key: "K-1" }, { key: "K-2" }] } : { total: 3, issues: [{ key: "K-3" }] };
  };
  expect(await readLinkedPullRequestKeys(jira as never, 7)).toEqual(["K-1", "K-2", "K-3"]);
  const first = new URL(calls[0]!, "https://x.test");
  expect(first.pathname).toBe("/rest/agile/1.0/board/7/issue");
  expect(first.searchParams.get("jql")).toBe("development[pullrequests].all > 0");
  expect(first.searchParams.get("fields")).toBe("key");
  expect(new URL(calls[1]!, "https://x.test").searchParams.get("startAt")).toBe("2");
});

test("an issue whose Development field lists no pull request shows one when Jira's development index links it, and back", async () => {
  const meta = new Map<string, string>();
  const issue = (v: { key: string; prCount?: number; prStatus?: PullRequest["status"] }) => v;
  const prs = linkedPullRequests({ get: (k) => meta.get(k), set: (k, v) => void meta.set(k, v) });
  let linked = ["K-1"];
  const jira = async (): Promise<any> => ({ total: linked.length, issues: linked.map((key) => ({ key })) });
  // Before the index is read, the field's answer stands.
  expect(prs.apply(issue({ key: "K-1", prCount: 0 }), [7])).toEqual({ key: "K-1", prCount: 0 });
  // The first read may change any issue's answer.
  expect(await prs.refresh(jira as never, 7)).toBeNull();
  expect(prs.apply(issue({ key: "K-1", prCount: 0 }), [7])).toEqual({ key: "K-1", prCount: 1, prStatus: undefined });
  expect(prs.apply(issue({ key: "K-2", prCount: 1, prStatus: "open" }), [7])).toEqual({ key: "K-2", prCount: 0, prStatus: undefined });
  // Later reads name the issues whose answer changed.
  linked = ["K-2"];
  expect((await prs.refresh(jira as never, 7))?.sort()).toEqual(["K-1", "K-2"]);
  expect(prs.apply(issue({ key: "K-1", prCount: 0 }), [7])).toEqual({ key: "K-1", prCount: 0 });
  // The set survives a restart through the store.
  const again = linkedPullRequests({ get: (k) => meta.get(k), set: (k, v) => void meta.set(k, v) });
  expect(again.apply(issue({ key: "K-2", prCount: 0 }), [7]).prCount).toBe(1);
  // Another board has its own set.
  expect(again.apply(issue({ key: "K-2", prCount: 0 }), [8]).prCount).toBe(0);
});

test("an issue on two boards has a pull request when either board's index links it, whichever board is named first", async () => {
  const meta = new Map<string, string>();
  const prs = linkedPullRequests({ get: (k) => meta.get(k), set: (k, v) => void meta.set(k, v) });
  const reads: Record<number, string[]> = { 7: ["K-1"], 8: [] };
  for (const board of [7, 8])
    await prs.refresh((async () => ({ total: reads[board]!.length, issues: reads[board]!.map((key) => ({ key })) })) as never, board);
  expect(prs.apply({ key: "K-1", prCount: 0 }, [7, 8]).prCount).toBe(1);
  expect(prs.apply({ key: "K-1", prCount: 0 }, [8, 7]).prCount).toBe(1);
  // Only boards that hold the issue count: board 8's read says nothing about an issue it doesn't hold.
  expect(prs.apply({ key: "K-1", prCount: 0 }, [8]).prCount).toBe(0);
  expect(prs.apply({ key: "K-1", prCount: 0 }, []).prCount).toBe(0);
});
