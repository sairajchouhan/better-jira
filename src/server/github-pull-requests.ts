/** Pull requests read straight from GitHub, read-only, for the organisations Jira's GitHub app doesn't cover. Linear links a pull
 *  request to an issue when its branch name, title or body names the issue's identifier; this does the same with Jira keys. One
 *  GraphQL search per poll covers every configured organisation and repository: the first poll reads the backfill window, each
 *  later one only what changed since the poll before. */
import { $ } from "bun";
import type { Database } from "bun:sqlite";
import { sortPullRequests, type PullRequest } from "@/shared/pull-requests";

type Environment = Record<string, string | undefined>;

// ——— Keys ———

/** A Jira issue key anywhere in the text, case-insensitive, as Linear links lowercase identifiers in branch names (its branch format
 *  "Issue identifier: Required for issue linking · eng-123"): not glued to a letter or digit before it, nor to a digit after it. */
const KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9_]*)-([1-9]\d*)(?!\d)/g;
/** The issue keys a pull request's branch, title or body names, upper-cased and once each. `projects` keeps only those projects'. */
export function issueKeysIn(text: string, projects?: ReadonlySet<string>): string[] {
  const keys = new Set<string>();
  for (const [, project, number] of text.matchAll(KEY)) {
    const upper = project!.toUpperCase();
    if (!projects || projects.has(upper)) keys.add(`${upper}-${number}`);
  }
  return [...keys];
}

// ——— GitHub's answer as ours ———

type Review = { state?: string; author?: { login?: string; __typename?: string } | null };
export type GitHubNode = {
  url?: string;
  number?: number;
  title?: string;
  body?: string | null;
  headRefName?: string;
  baseRefName?: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  merged?: boolean;
  updatedAt?: string;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  repository?: { name?: string } | null;
  author?: { login?: string } | null;
  latestReviews?: { nodes?: (Review | null)[] } | null;
};

/** Linear's `isBotReviewer`: a bot account (GitHub's `Bot` type, or a `[bot]` login). */
// oxlint-disable-next-line no-underscore-dangle -- GitHub's GraphQL type name
const isBot = (review: Review) => review.author?.__typename === "Bot" || !!review.author?.login?.endsWith("[bot]");
/** Linear's `statusBasedOnReviews` (`uU`/`dU`) for a pull request GitHub reports: merged, closed, draft, else by its people's latest
 *  reviews. A change request or any submitted review (approved, changes requested, commented) is in review; approved only when
 *  GitHub's own review decision says so (Linear's `trustHumanApprovals` is off for display). */
export function gitHubStatus(node: GitHubNode): Pick<PullRequest, "status" | "changesRequested"> {
  if (node.merged || node.state === "MERGED") return { status: "merged" };
  if (node.state === "CLOSED") return { status: "declined" };
  if (node.isDraft) return { status: "draft" };
  const reviews = (node.latestReviews?.nodes ?? []).filter((r): r is Review => !!r && !isBot(r));
  const changes = node.reviewDecision === "CHANGES_REQUESTED" || reviews.some((r) => r.state === "CHANGES_REQUESTED");
  if (changes) return { status: "inReview", changesRequested: true };
  if (node.reviewDecision === "APPROVED") return { status: "approved" };
  if (reviews.some((r) => r.state === "APPROVED" || r.state === "COMMENTED")) return { status: "inReview" };
  return { status: "open" };
}

export function gitHubPullRequest(node: GitHubNode): PullRequest {
  return {
    url: node.url!,
    title: node.title || node.url!,
    number: node.number ? `#${node.number}` : "",
    ...gitHubStatus(node),
    ...(node.repository?.name ? { repo: node.repository.name } : {}),
    ...(node.author?.login ? { author: node.author.login } : {}),
    ...(node.headRefName ? { branch: node.headRefName } : {}),
    ...(node.baseRefName ? { target: node.baseRefName } : {}),
    tool: "GitHub",
    ...(node.updatedAt ? { updated: node.updatedAt } : {}),
  };
}

// ——— Configuration ———

const QUALIFIER = /^(org|user|repo):[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/;
/** The search qualifiers `GITHUB_PR_SOURCES` names, comma or space separated: an organisation (`acme`), a repository
 *  (`acme/app`), or a qualifier as is (`user:ana`). "off" turns the source off; unset leaves it to the default (null). */
export function gitHubSources(value: string | undefined): string[] | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^(off|none|false|0)$/i.test(text)) return [];
  return [
    ...new Set(
      text.split(/[\s,]+/).flatMap((part) => {
        const qualifier = part.includes(":") ? part : part.includes("/") ? `repo:${part}` : `org:${part}`;
        if (!QUALIFIER.test(qualifier)) throw new Error(`GITHUB_PR_SOURCES: "${part}" is not an organisation or owner/repository.`);
        return [qualifier];
      }),
    ),
  ];
}

/** The owners of the user's own recent pull requests, as search qualifiers: an organisation's `org:`, a person's `user:`. */
export function ownersOf(nodes: { repository?: { owner?: { login?: string; __typename?: string } } }[]): string[] {
  const owners = new Set<string>();
  for (const node of nodes) {
    const owner = node.repository?.owner;
    // oxlint-disable-next-line no-underscore-dangle -- GitHub's GraphQL type name
    if (owner?.login) owners.add(`${owner.__typename === "User" ? "user" : "org"}:${owner.login}`);
  }
  return [...owners].sort();
}

/** The GitHub token: `GITHUB_TOKEN`, else the GitHub CLI's own login (`gh auth token`, its active account), read when needed and
 *  kept in memory only. Never logged, printed or saved. */
export async function gitHubToken(env: Environment = process.env): Promise<string | undefined> {
  const own = env.GITHUB_TOKEN?.trim();
  if (own) return own;
  try {
    const out = await $`gh auth token --hostname github.com`.quiet().nothrow();
    return out.exitCode === 0 ? out.stdout.toString().trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

// ——— Client ———

/** Requests stop this far above GitHub's hourly limit, until its reset. */
const RESERVE = 100;
export class GitHubPaused extends Error {
  constructor(readonly until: number) {
    super(`GitHub's rate limit is spent; reads resume at ${new Date(until).toISOString()}.`);
  }
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
/** GitHub's GraphQL API, read-only (queries only), within its rate limit: `X-RateLimit-Remaining` at or under the reserve, a
 *  secondary limit (403/429 with `Retry-After`) or a RATE_LIMITED answer pauses every request until GitHub's reset. A rejected token
 *  is read again on the next request. */
export function gitHubClient(token: () => Promise<string | undefined>, fetcher: Fetch = fetch, now = Date.now) {
  let pausedUntil = 0,
    held: string | undefined,
    requests = 0;
  const resetOf = (res: Response) => {
    const retry = Number(res.headers.get("retry-after")),
      reset = Number(res.headers.get("x-ratelimit-reset"));
    return retry > 0 ? now() + retry * 1000 : reset > 0 ? reset * 1000 : now() + 60_000;
  };
  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (now() < pausedUntil) throw new GitHubPaused(pausedUntil);
    held ??= await token();
    if (!held) throw new Error("No GitHub token: log in with `gh auth login`, or set GITHUB_TOKEN.");
    const res = await fetcher("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${held}`, "Content-Type": "application/json", "User-Agent": "better-jira" },
      body: JSON.stringify({ query, variables }),
    });
    requests++;
    if (res.status === 401) {
      held = undefined;
      throw new Error("GitHub rejected the token (401).");
    }
    if (res.status === 403 || res.status === 429) {
      pausedUntil = resetOf(res);
      throw new GitHubPaused(pausedUntil);
    }
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining !== null && Number(remaining) <= RESERVE) pausedUntil = resetOf(res);
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const body = (await res.json()) as { data?: T; errors?: { type?: string; message?: string }[] };
    if (body.errors?.some((e) => e.type === "RATE_LIMITED")) {
      pausedUntil = resetOf(res);
      throw new GitHubPaused(pausedUntil);
    }
    if (!body.data) throw new Error(`GitHub: ${body.errors?.[0]?.message ?? "no data"}`);
    return body.data;
  }
  return { graphql, requests: () => requests };
}
export type GitHubClient = ReturnType<typeof gitHubClient>;

// ——— The source ———

const SEARCH = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      url number title body headRefName baseRefName state isDraft merged updatedAt reviewDecision
      repository { name } author { login }
      latestReviews(first: 20) { nodes { state author { login __typename } } }
    } }
  }
}`;
const MINE = `query { search(query: "is:pr author:@me sort:updated-desc", type: ISSUE, first: 100) {
  nodes { ... on PullRequest { repository { owner { login __typename } } } }
} }`;
type SearchPage = { search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GitHubNode[] } };
/** GitHub's search answers at most this many results per query; past it, the next query starts below the oldest one read. */
const SEARCH_CAP = 1000;
/** Each poll re-reads this much before the last one began: GitHub's search index lags its pull requests a little. */
const OVERLAP_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export type GitHubOptions = {
  client: Pick<GitHubClient, "graphql">;
  /** The search qualifiers to read (`org:acme`, `repo:acme/app`); null: the owners of the user's own recent pull requests. */
  sources: string[] | null;
  /** How far back the first poll reads. */
  backfillDays: number;
  now?: () => number;
};

/** The pull requests GitHub links to Jira keys, kept in the mirror's database so a restart reads only what changed. `refresh` reads
 *  GitHub's changes since the last poll and returns the issue keys whose pull requests changed; `forKey` answers from memory. */
export function gitHubPullRequests(db: Database, options: GitHubOptions) {
  const now = options.now ?? Date.now;
  db.run("CREATE TABLE IF NOT EXISTS github_pull_requests (url TEXT PRIMARY KEY, keys TEXT NOT NULL, data TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS github_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  const getMeta = (k: string) => db.query<{ v: string }, [string]>("SELECT v FROM github_meta WHERE k = ?").get(k)?.v;
  const setMeta = (k: string, v: string) => db.query("INSERT OR REPLACE INTO github_meta VALUES (?, ?)").run(k, v);
  const stored = db.query<{ keys: string; data: string }, [string]>("SELECT keys, data FROM github_pull_requests WHERE url = ?");
  const put = db.query("INSERT OR REPLACE INTO github_pull_requests VALUES (?, ?, ?)");
  const remove = db.query("DELETE FROM github_pull_requests WHERE url = ?");

  let index: Map<string, PullRequest[]> | undefined;
  const byKey = () => {
    if (index) return index;
    index = new Map();
    for (const row of db.query<{ keys: string; data: string }, []>("SELECT keys, data FROM github_pull_requests").all()) {
      const pr = JSON.parse(row.data) as PullRequest;
      for (const key of JSON.parse(row.keys) as string[]) index.set(key, [...(index.get(key) ?? []), pr]);
    }
    for (const [key, prs] of index) index.set(key, sortPullRequests(prs));
    return index;
  };

  /** Saves one pull request GitHub returned; returns the keys whose list it changed. */
  const take = (node: GitHubNode): string[] => {
    if (!node.url) return [];
    const keys = issueKeysIn([node.headRefName, node.title, node.body].filter(Boolean).join("\n"));
    const before = stored.get(node.url);
    const old: string[] = before ? JSON.parse(before.keys) : [];
    if (!keys.length) {
      if (before) remove.run(node.url);
      return old;
    }
    const data = JSON.stringify(gitHubPullRequest(node));
    if (before && before.data === data && before.keys === JSON.stringify(keys)) return [];
    put.run(node.url, JSON.stringify(keys), data);
    return [...new Set([...old, ...keys])];
  };

  async function sources(): Promise<string[]> {
    if (options.sources) return options.sources;
    const saved = getMeta("default-sources");
    if (saved && now() - Number(getMeta("default-sources-at") ?? 0) < DAY_MS) return JSON.parse(saved);
    const mine = await options.client.graphql<{ search: { nodes: Parameters<typeof ownersOf>[0] } }>(MINE, {});
    const owners = ownersOf(mine.search.nodes);
    setMeta("default-sources", JSON.stringify(owners));
    setMeta("default-sources-at", String(now()));
    return owners;
  }

  return {
    forKey: (key: string): PullRequest[] => byKey().get(key) ?? [],
    keys: () => [...byKey().keys()],
    /** Reads every pull request updated since the last poll (the backfill window on the first) and returns the keys it changed. */
    async refresh(): Promise<string[]> {
      const scope = (await sources()).join(" ");
      if (!scope) return [];
      const started = now();
      const changed = new Set<string>();
      if (getMeta("scope") !== scope) {
        // Other sources: what the old ones linked no longer counts.
        for (const key of byKey().keys()) changed.add(key);
        db.run("DELETE FROM github_pull_requests");
        db.run("DELETE FROM github_meta WHERE k = 'since'");
        setMeta("scope", scope);
      }
      const since = Number(getMeta("since") ?? 0);
      const from = iso(since ? since - OVERLAP_MS : started - options.backfillDays * DAY_MS);
      let until: string | undefined, after: string | undefined, read = 0;
      for (;;) {
        const range = until ? `updated:${from}..${until}` : `updated:>=${from}`;
        const { search } = await options.client.graphql<SearchPage>(SEARCH, {
          q: `is:pr ${scope} ${range} sort:updated-desc`,
          after: after ?? null,
        });
        for (const node of search.nodes) for (const key of take(node)) changed.add(key);
        read += search.nodes.length;
        if (search.pageInfo.hasNextPage && search.pageInfo.endCursor) {
          after = search.pageInfo.endCursor;
          continue;
        }
        // Past the search's cap: the next query reads below the oldest pull request this one reached.
        const oldest = search.nodes.at(-1)?.updatedAt;
        if (read < SEARCH_CAP || search.issueCount <= read || !oldest || oldest === until) break;
        until = oldest;
        after = undefined;
        read = 0;
      }
      setMeta("since", String(started));
      if (changed.size) index = undefined;
      return [...changed];
    },
  };
}
export type GitHubPullRequests = ReturnType<typeof gitHubPullRequests>;

/** The source's settings from the environment: `GITHUB_PR_SOURCES` (see `gitHubSources`) and `GITHUB_PR_DAYS`, how many days the
 *  first poll reads back (30 by default). */
export function gitHubConfiguration(env: Environment = process.env) {
  const days = Number(env.GITHUB_PR_DAYS || 30);
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error("GITHUB_PR_DAYS must be between 1 and 365.");
  return { sources: gitHubSources(env.GITHUB_PR_SOURCES), backfillDays: days };
}
