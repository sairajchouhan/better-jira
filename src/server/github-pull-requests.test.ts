import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  gitHubClient,
  gitHubConfiguration,
  GitHubPaused,
  gitHubPullRequest,
  gitHubPullRequests,
  gitHubSources,
  gitHubStatus,
  issueKeysIn,
  ownersOf,
  type GitHubNode,
} from "./github-pull-requests";
import { withGitHubPullRequests, type PullRequest } from "@/shared/pull-requests";

// Synthetic fixtures only: made-up organisations, repositories, keys and titles.

test("issue keys come from branch names, titles and bodies, in any case, once each", () => {
  expect(issueKeysIn("feat/ACME-970-tidy-the-cache")).toEqual(["ACME-970"]);
  expect(issueKeysIn("fix/acme-971-queued-save")).toEqual(["ACME-971"]);
  expect(issueKeysIn("fix(cache): keep the queue (ACME-12)\nRefs ACME-12 and OPS-3")).toEqual(["ACME-12", "OPS-3"]);
  expect(issueKeysIn("ACME-5_retry, ACME-6.")).toEqual(["ACME-5", "ACME-6"]);
});

test("issue keys are whole: not inside a longer word or number, and never number 0", () => {
  expect(issueKeysIn("1ACME-2 ACME-0 ACME- v2-ACME")).toEqual([]);
  expect(issueKeysIn("XACME-1 ACME-2", new Set(["ACME"]))).toEqual(["ACME-2"]);
  expect(issueKeysIn("ACME-12345")).toEqual(["ACME-12345"]);
});

test("issue keys can be kept to the board's projects", () => {
  expect(issueKeysIn("Use UTF-8 for ACME-4", new Set(["ACME"]))).toEqual(["ACME-4"]);
});

const node = (over: Partial<GitHubNode> = {}): GitHubNode => ({
  url: "https://github.com/acme-org/widgets/pull/7",
  number: 7,
  title: "Tidy the cache (ACME-1)",
  body: "",
  headRefName: "feat/ACME-1-tidy",
  baseRefName: "main",
  state: "OPEN",
  isDraft: false,
  merged: false,
  updatedAt: "2026-11-10T10:00:00Z",
  repository: { name: "widgets" },
  author: { login: "ana-dev" },
  latestReviews: { nodes: [] },
  ...over,
});
const review = (state: string, login = "ben-dev", bot = false) => ({ state, author: { login, __typename: bot ? "Bot" : "User" } });

test("a pull request's state follows Linear's statusBasedOnReviews", () => {
  expect(gitHubStatus(node({ state: "MERGED", merged: true }))).toEqual({ status: "merged" });
  expect(gitHubStatus(node({ state: "CLOSED" }))).toEqual({ status: "declined" });
  expect(gitHubStatus(node({ isDraft: true, latestReviews: { nodes: [review("COMMENTED")] } }))).toEqual({ status: "draft" });
  expect(gitHubStatus(node())).toEqual({ status: "open" });
  expect(gitHubStatus(node({ latestReviews: { nodes: [review("COMMENTED")] } }))).toEqual({ status: "inReview" });
  // Without GitHub's review decision a person's approval is approved; with it, the decision says.
  expect(gitHubStatus(node({ latestReviews: { nodes: [review("APPROVED")] } }))).toEqual({ status: "approved" });
  expect(gitHubStatus(node({ reviewDecision: "REVIEW_REQUIRED", latestReviews: { nodes: [review("APPROVED")] } }))).toEqual({ status: "inReview" });
  expect(gitHubStatus(node({ reviewDecision: "APPROVED", latestReviews: { nodes: [review("APPROVED")] } }))).toEqual({ status: "approved" });
  expect(gitHubStatus(node({ reviewDecision: "APPROVED", latestReviews: { nodes: [review("APPROVED"), review("CHANGES_REQUESTED", "cy-dev")] } }))).toEqual({
    status: "inReview",
    changesRequested: true,
  });
  // A bot's review is not a person's.
  expect(gitHubStatus(node({ latestReviews: { nodes: [review("COMMENTED", "lint-bot", true), review("COMMENTED", "helper[bot]")] } }))).toEqual({
    status: "open",
  });
});

test("a GitHub pull request reads as ours: number, repository, author, branches, review tool", () => {
  expect(gitHubPullRequest(node())).toEqual({
    url: "https://github.com/acme-org/widgets/pull/7",
    title: "Tidy the cache (ACME-1)",
    number: "#7",
    status: "open",
    repo: "widgets",
    author: "ana-dev",
    branch: "feat/ACME-1-tidy",
    target: "main",
    tool: "GitHub",
    updated: "2026-11-10T10:00:00Z",
  });
});

test("sources: organisations, repositories and qualifiers from GITHUB_PR_SOURCES; off turns it off; unset is the default", () => {
  expect(gitHubSources("acme-org, acme-org/widgets user:ana-dev")).toEqual(["org:acme-org", "repo:acme-org/widgets", "user:ana-dev"]);
  expect(gitHubSources("off")).toEqual([]);
  expect(gitHubSources(undefined)).toBeNull();
  expect(() => gitHubSources("acme org;drop")).toThrow();
  expect(gitHubConfiguration({})).toEqual({ sources: null, backfillDays: 30 });
  expect(gitHubConfiguration({ GITHUB_PR_DAYS: "7", GITHUB_PR_SOURCES: "acme-org" })).toEqual({ sources: ["org:acme-org"], backfillDays: 7 });
});

test("the default sources are the owners of the user's own recent pull requests", () => {
  const owner = (login: string, __typename: string) => ({ repository: { owner: { login, __typename } } });
  expect(ownersOf([owner("acme-org", "Organization"), owner("ana-dev", "User"), owner("acme-org", "Organization"), {}])).toEqual([
    "org:acme-org",
    "user:ana-dev",
  ]);
});

const answer = (status: number, headers: Record<string, string>, body: unknown = { data: { ok: true } }) =>
  new Response(JSON.stringify(body), { status, headers });

test("the client only POSTs queries, with the token in the header, and pauses at the rate limit's reserve until its reset", async () => {
  const sent: RequestInit[] = [];
  let now = 1_000_000;
  const client = gitHubClient(
    async () => "test-token",
    async (_url, init) => (sent.push(init), answer(200, { "x-ratelimit-remaining": "40", "x-ratelimit-reset": "2000" })),
    () => now,
  );
  expect(await client.graphql("query { ok }", {})).toEqual({ ok: true });
  expect(sent[0]!.method).toBe("POST");
  expect((sent[0]!.headers as Record<string, string>).Authorization).toBe("bearer test-token");
  expect(JSON.parse(String(sent[0]!.body)).query).toBe("query { ok }");
  await expect(client.graphql("query { ok }", {})).rejects.toBeInstanceOf(GitHubPaused);
  expect(sent).toHaveLength(1);
  now = 2_000_001;
  await client.graphql("query { ok }", {});
  expect(sent).toHaveLength(2);
});

test("the client waits out a secondary limit's Retry-After, and reads the token again after a 401", async () => {
  let now = 0,
    tokens = 0;
  const replies = [answer(403, { "retry-after": "60" }), answer(401, {}), answer(200, {})];
  const client = gitHubClient(
    async () => `token-${++tokens}`,
    async () => replies.shift()!,
    () => now,
  );
  await expect(client.graphql("query { ok }", {})).rejects.toBeInstanceOf(GitHubPaused);
  now = 30_000;
  await expect(client.graphql("query { ok }", {})).rejects.toBeInstanceOf(GitHubPaused);
  now = 61_000;
  await expect(client.graphql("query { ok }", {})).rejects.toThrow("401");
  await client.graphql("query { ok }", {});
  expect(tokens).toBe(2);
  expect(client.requests()).toBe(3);
});

const NOW = Date.parse("2026-11-14T12:00:00Z");
type Page = { nodes: GitHubNode[]; next?: string; count?: number };
/** A fake GitHub search: `pages(q, after)` answers each query. Records every query string. */
function fakeGitHub(pages: (q: string, after: string | null) => Page) {
  const queries: { q: string; after: string | null; query: string }[] = [];
  return {
    queries,
    client: {
      graphql: async <T,>(query: string, variables: Record<string, unknown>): Promise<T> => {
        const q = String(variables.q),
          after = (variables.after as string | null) ?? null;
        queries.push({ q, after, query });
        const page = pages(q, after);
        return {
          search: {
            issueCount: page.count ?? page.nodes.length,
            pageInfo: { hasNextPage: !!page.next, endCursor: page.next ?? null },
            nodes: page.nodes,
          },
        } as T;
      },
    },
  };
}

test("the first poll reads the backfill window, later ones only what changed since the last, and links keys to pull requests", async () => {
  const db = new Database(":memory:");
  let now = NOW,
    nodes = [node(), node({ url: "https://github.com/acme-org/widgets/pull/8", number: 8, title: "Docs", headRefName: "docs/readme" })];
  const gh = fakeGitHub(() => ({ nodes }));
  const prs = gitHubPullRequests(db, { client: gh.client, sources: ["org:acme-org"], backfillDays: 30, now: () => now });
  expect(await prs.refresh()).toEqual(["ACME-1"]);
  expect(gh.queries[0]!.q).toBe("is:pr org:acme-org updated:>=2026-10-15T12:00:00Z sort:updated-asc");
  expect(gh.queries[0]!.query.trimStart().startsWith("query")).toBe(true);
  expect(prs.forKey("ACME-1").map((pr) => [pr.number, pr.status])).toEqual([["#7", "open"]]);
  expect(prs.forKey("ACME-2")).toEqual([]);

  // Nothing new: no key changes. The next poll starts five minutes before the last one began.
  now += 30_000;
  expect(await prs.refresh()).toEqual([]);
  expect(gh.queries[1]!.q).toBe("is:pr org:acme-org updated:>=2026-11-14T11:55:00Z sort:updated-asc");

  // Reviewed, then retitled to another issue: both issues' lists change.
  nodes = [node({ latestReviews: { nodes: [review("COMMENTED")] } })];
  expect(await prs.refresh()).toEqual(["ACME-1"]);
  expect(prs.forKey("ACME-1")[0]!.status).toBe("inReview");
  nodes = [node({ title: "Tidy the cache", headRefName: "feat/ACME-2-tidy" })];
  expect((await prs.refresh()).toSorted()).toEqual(["ACME-1", "ACME-2"]);
  expect(prs.forKey("ACME-1")).toEqual([]);
  expect(prs.forKey("ACME-2")).toHaveLength(1);

  // A restart keeps the list and reads on from the last poll.
  const again = gitHubPullRequests(db, { client: gh.client, sources: ["org:acme-org"], backfillDays: 30, now: () => now });
  expect(again.forKey("ACME-2")).toHaveLength(1);
});

test("a window past the search's 1,000-result cap is read in slices from the newest pull request reached", async () => {
  const db = new Database(":memory:");
  const at = (i: number) => new Date(NOW - (1500 - i) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  // Oldest first, as `sort:updated-asc` answers.
  const all = Array.from({ length: 1500 }, (_, i) =>
    node({ url: `https://github.com/acme-org/widgets/pull/${i + 1}`, number: i + 1, title: `Change ACME-${i + 1}`, headRefName: "x", updatedAt: at(i) }),
  );
  const gh = fakeGitHub((q, after) => {
    const from = q.match(/updated:>=(\S+)/)![1]!;
    const matching = all.filter((n) => n.updatedAt! >= from);
    const capped = matching.slice(0, 1000);
    const start = after ? Number(after) : 0;
    const next = start + 50 < capped.length ? String(start + 50) : undefined;
    return { nodes: capped.slice(start, start + 50), next, count: matching.length };
  });
  const prs = gitHubPullRequests(db, { client: gh.client, sources: ["org:acme-org"], backfillDays: 30, now: () => NOW });
  expect(await prs.refresh()).toHaveLength(1500);
  // 20 pages to the cap, then 11 more from the 1,000th pull request (which is read twice).
  expect(gh.queries).toHaveLength(31);
  expect(gh.queries[20]!.q).toBe(`is:pr org:acme-org updated:>=${at(999)} sort:updated-asc`);
  expect(prs.forKey("ACME-1500")).toHaveLength(1);
});

test("a poll cut off midway resumes from the last page it read, not from the start of the window", async () => {
  const db = new Database(":memory:");
  const pages = [
    { nodes: [node({ updatedAt: "2026-11-01T00:00:00Z" })], next: "p2" },
    { nodes: [node({ url: "https://github.com/acme-org/widgets/pull/9", title: "ACME-9", updatedAt: "2026-11-02T00:00:00Z" })] },
  ];
  let fail = true;
  const client = {
    graphql: async <T,>(_query: string, variables: Record<string, unknown>): Promise<T> => {
      if (variables.after === "p2" && fail) throw new Error("GitHub answered 502.");
      const page = variables.after === "p2" ? pages[1]! : pages[0]!;
      queries.push(String(variables.q));
      return { search: { issueCount: 2, pageInfo: { hasNextPage: !!page.next, endCursor: page.next ?? null }, nodes: page.nodes } } as T;
    },
  };
  const queries: string[] = [];
  const prs = gitHubPullRequests(db, { client, sources: ["org:acme-org"], backfillDays: 30, now: () => NOW });
  await expect(prs.refresh()).rejects.toThrow("502");
  // What the first page read stands.
  expect(prs.forKey("ACME-1")).toHaveLength(1);
  fail = false;
  await prs.refresh();
  expect(queries.at(-1)).toBe("is:pr org:acme-org updated:>=2026-10-31T23:55:00Z sort:updated-asc");
});

test("the default sources come from the user's own pull requests, and other sources drop what the old ones linked", async () => {
  const db = new Database(":memory:");
  const queries: string[] = [];
  const client = {
    graphql: async <T,>(query: string, variables: Record<string, unknown>): Promise<T> => {
      queries.push(variables.q ? String(variables.q) : query.includes("author:@me") ? "mine" : query);
      if (!variables.q) return { search: { nodes: [{ repository: { owner: { login: "acme-org", __typename: "Organization" } } }] } } as T;
      return { search: { issueCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node()] } } as T;
    },
  };
  const first = gitHubPullRequests(db, { client, sources: null, backfillDays: 30, now: () => NOW });
  await first.refresh();
  expect(queries[0]).toBe("mine");
  expect(queries[1]).toStartWith("is:pr org:acme-org ");
  const other = gitHubPullRequests(db, { client, sources: ["repo:acme-org/gears"], backfillDays: 30, now: () => NOW });
  expect(await other.refresh()).toEqual(["ACME-1"]);
  expect(queries[2]).toBe("is:pr repo:acme-org/gears updated:>=2026-10-15T12:00:00Z sort:updated-asc");
});

test("regression: an issue Jira links no pull request to shows the one GitHub links by its branch name", async () => {
  const db = new Database(":memory:");
  const gh = fakeGitHub(() => ({ nodes: [node({ title: "Save queued edits", headRefName: "fix/ACME-9-queued-save" })] }));
  const prs = gitHubPullRequests(db, { client: gh.client, sources: ["org:acme-org"], backfillDays: 30, now: () => NOW });
  await prs.refresh();
  const issue: { key: string; prCount?: number; prStatus?: PullRequest["status"] } = { key: "ACME-9", prCount: 0 };
  expect(withGitHubPullRequests(issue, prs.forKey(issue.key))).toEqual({ key: "ACME-9", prCount: 1, prStatus: "open" });
});

test("the client asks once more when GitHub answers 502", async () => {
  const replies = [answer(502, {}), answer(200, {})];
  const client = gitHubClient(async () => "test-token", async () => replies.shift()!, Date.now, 0);
  expect(await client.graphql("query { ok }", {})).toEqual({ ok: true });
  expect(client.requests()).toBe(2);
});
