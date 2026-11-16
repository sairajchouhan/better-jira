/** Pull requests read straight from GitHub, read-only, for the organisations Jira's GitHub app doesn't cover. Linear links a pull
 *  request to an issue when its branch name or title names the issue's identifier, or its description names it after a magic word;
 *  this does the same with Jira keys. One GraphQL search per poll covers every configured organisation and repository: the first
 *  poll reads the backfill window, each later one only what changed since the poll before. */
import { $ } from "bun";
import type { Database } from "bun:sqlite";
import { sortPullRequests, withGitHubAuthorAvatar, type PullRequest } from "@/shared/pull-requests";

type Environment = Record<string, string | undefined>;

// ——— Keys ———

/** A Jira issue key, case-insensitive, as Linear links lowercase identifiers in branch names (its branch format "Issue identifier:
 *  Required for issue linking · eng-123"): not glued to a letter or digit before it, nor to a digit after it. */
const KEY_SOURCE = String.raw`(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9_]*-[1-9]\d*(?!\d)`;
const KEY = new RegExp(KEY_SOURCE, "g");
const upper = (key: string) => key.toUpperCase();
/** The issue keys the text names anywhere, upper-cased and once each. `projects` keeps only those projects'. */
export function issueKeysIn(text: string, projects?: ReadonlySet<string>): string[] {
  return kept(
    [...text.matchAll(KEY)].map(([key]) => upper(key)),
    projects,
  );
}
function kept(keys: string[], projects?: ReadonlySet<string>): string[] {
  return [...new Set(keys.filter((key) => !projects || projects.has(key.slice(0, key.lastIndexOf("-")))))];
}

/** Linear's magic words (linear.app/docs/github, "Magic words"), any of which before an issue ID in a pull request's description
 *  links it. Closing: close … implementing, linear issue. Non-closing: ref … towards. Relation: relates to, related to. All three
 *  link; they differ only in the status Linear then sets, which Jira's workflow owns here. */
export const MAGIC_WORDS = [
  "close, closes, closed, closing, fix, fixes, fixed, fixing, resolve, resolves, resolved, resolving",
  "complete, completes, completed, completing, implement, implements, implemented, implementing, linear issue",
  "ref, refs, references, part of, contributes to, toward, towards",
  "relates to, related to",
]
  .join(", ")
  .split(", ");
/** Linear's words that keep an issue from being linked: "Ignore ENG-123". */
export const SKIP_WORDS = ["skip", "ignore"] as const;

const wordsPattern = (words: readonly string[]) =>
  new RegExp(String.raw`(?<![A-Za-z0-9_])(?:${words.map((w) => w.replace(/ /g, String.raw`\s+`)).join("|")})(?![A-Za-z0-9_-])`, "gi");
const MAGIC = wordsPattern(MAGIC_WORDS);
const SKIP = wordsPattern(SKIP_WORDS);
/** One issue reference after a magic word, emphasis marks around it allowed: a markdown link (`[ACME-1](…)`), an `<…>` or bare URL
 *  (`https://acme.atlassian.net/browse/ACME-1`, as Linear's own "Fixes https://linear.app/…/issue/ENG-123/title"), or the key. */
const REFERENCE = new RegExp(
  String.raw`[*_\`]*(?:\[([^\]\n]*)\]\(([^)\s]*)\)|<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<>()\[\],]*[^\s<>()\[\],.;:!?'"])|(${KEY_SOURCE}))[*_\`]*`,
  "iy",
);
/** Between a magic word and its first reference: spaces, or a colon ("Fixes: ACME-1"). */
const LEAD = /[^\S\n]*:?[^\S\n]*/y;
/** Between two references of one magic word: "ACME-1, ACME-2, and ACME-3", "ACME-1 and ACME-2", "ACME-1 & ACME-2". */
const BETWEEN = /[^\S\n]*(?:,[^\S\n]*(?:(?:and|&)[^\S\n]+)?|[^\S\n]+(?:and|&)[^\S\n]+)/iy;
const WHOLE_KEY = new RegExp(String.raw`^[*_\`]*(${KEY_SOURCE})[*_\`]*$`);
/** The key a link to an issue names: Jira's `/browse/ACME-1` or `selectedIssue=ACME-1`, or Linear's `/issue/ACME-1`. */
const URL_KEY = new RegExp(String.raw`(?:\/(?:browse|issue)\/|[?&]selectedIssue=)(${KEY_SOURCE})(?![A-Za-z0-9])`);

/** The key one reference names, or undefined when it names none (a link elsewhere). */
function referenceKey(match: RegExpExecArray): string | undefined {
  const [, text, href, angled, bare, key] = match;
  const found =
    key ?? (text !== undefined ? (WHOLE_KEY.exec(text.trim())?.[1] ?? URL_KEY.exec(href!)?.[1]) : URL_KEY.exec(angled ?? bare!)?.[1]);
  return found && upper(found);
}
/** The keys named right after any of `words`: one reference, then more joined by commas or "and". Prose between the word and the
 *  key ("Fixes the cache in ACME-1") ends it. */
function keysAfter(words: RegExp, text: string): string[] {
  const keys: string[] = [];
  for (const word of text.matchAll(words)) {
    let at = word.index + word[0].length;
    LEAD.lastIndex = at;
    at += LEAD.exec(text)![0].length;
    for (;;) {
      REFERENCE.lastIndex = at;
      const reference = REFERENCE.exec(text);
      const key = reference && referenceKey(reference);
      if (!key) break;
      keys.push(key);
      at = REFERENCE.lastIndex;
      BETWEEN.lastIndex = at;
      const between = BETWEEN.exec(text);
      if (!between) break;
      at += between[0].length;
    }
  }
  return keys;
}
/** The keys a pull request's description links: only those after a magic word, as Linear's "Use a magic word + issue ID in the PR
 *  description". A key the description merely mentions ("Follow-up: ACME-9") links nothing. */
export const magicKeysIn = (text: string, projects?: ReadonlySet<string>) => kept(keysAfter(MAGIC, text), projects);

/** The issue keys a pull request links, upper-cased and once each: any its branch name or title names, those its description
 *  names after a magic word, less those the description skips ("Ignore ACME-1"). `projects` keeps only those projects'. */
export function pullRequestKeys(
  pr: { headRefName?: string; title?: string; body?: string | null },
  projects?: ReadonlySet<string>,
): string[] {
  const body = pr.body ?? "";
  const skipped = new Set(keysAfter(SKIP, body));
  return kept(
    [...issueKeysIn(pr.headRefName ?? ""), ...issueKeysIn(pr.title ?? ""), ...magicKeysIn(body)].filter((key) => !skipped.has(key)),
    projects,
  );
}
/** Bumped whenever `pullRequestKeys` links differently, so stored pull requests are matched again under the new rule. 2: the
 *  description links only keys after a magic word. */
const MATCHER = "2";

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
  mergedAt?: string | null;
  closedAt?: string | null;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  repository?: { name?: string; owner?: { login?: string } | null } | null;
  author?: { login?: string } | null;
  latestReviews?: { nodes?: (Review | null)[] } | null;
};

/** Linear's `isBotReviewer`: a bot account (GitHub's `Bot` type, or a `[bot]` login). */
// oxlint-disable-next-line no-underscore-dangle -- GitHub's GraphQL type name
const isBot = (review: Review) => review.author?.__typename === "Bot" || !!review.author?.login?.endsWith("[bot]");
/** Linear's `statusBasedOnReviews` (`uU`/`dU`) for a pull request GitHub reports: merged, closed, draft, else by its people's latest
 *  reviews (bots' don't count). A change request wins and is in review; an approval is approved; any other submitted review
 *  (commented) is in review. GitHub's `reviewDecision`, when the query asks for it, decides approval instead: the search leaves it
 *  out, as it makes each page several times slower. */
export function gitHubStatus(node: GitHubNode): Pick<PullRequest, "status" | "changesRequested"> {
  if (node.merged || node.state === "MERGED") return { status: "merged" };
  if (node.state === "CLOSED") return { status: "declined" };
  if (node.isDraft) return { status: "draft" };
  const reviews = (node.latestReviews?.nodes ?? []).filter((r): r is Review => !!r && !isBot(r));
  const changes = node.reviewDecision === "CHANGES_REQUESTED" || reviews.some((r) => r.state === "CHANGES_REQUESTED");
  if (changes) return { status: "inReview", changesRequested: true };
  const approved = node.reviewDecision === undefined ? reviews.some((r) => r.state === "APPROVED") : node.reviewDecision === "APPROVED";
  if (approved) return { status: "approved" };
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
    ...(node.repository?.owner?.login ? { owner: node.repository.owner.login } : {}),
    ...(node.author?.login ? { author: node.author.login } : {}),
    ...(node.headRefName ? { branch: node.headRefName } : {}),
    ...(node.baseRefName ? { target: node.baseRefName } : {}),
    tool: "GitHub",
    ...(node.updatedAt ? { updated: node.updatedAt } : {}),
    // Linear's `mergedAt` for a merged pull request, `closedAt` for a closed one: "Merged 3d ago".
    ...((node.mergedAt ?? node.closedAt) ? { closedAt: (node.mergedAt ?? node.closedAt)! } : {}),
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
export function gitHubClient(token: () => Promise<string | undefined>, fetcher: Fetch = fetch, now = Date.now, retryMs = 2000) {
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
    const send = () => {
      requests++;
      return fetcher("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `bearer ${held}`, "Content-Type": "application/json", "User-Agent": "better-jira" },
        body: JSON.stringify({ query, variables }),
      });
    };
    let res = await send();
    // GitHub's GraphQL answers 502 now and then on a heavy search: once more, after a moment.
    if (res.status >= 500) res = await Bun.sleep(retryMs).then(send);
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
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: { type?: string; message?: string }[] } | null;
    if (!body) throw new Error("GitHub answered no data.");
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
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      url number title body headRefName baseRefName state isDraft merged updatedAt mergedAt closedAt
      repository { name owner { login } } author { login }
      latestReviews(first: 20) { nodes { state author { login __typename } } }
    } }
  }
}`;
const MINE = `query { search(query: "is:pr author:@me sort:updated-desc", type: ISSUE, first: 100) {
  nodes { ... on PullRequest { repository { owner { login __typename } } } }
} }`;
type SearchPage = {
  search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GitHubNode[] };
};
/** GitHub's search answers at most this many results per query; past it, the next query starts at the newest one read. */
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
      // The author's avatar is added as the rows are read, not stored: rows stored before it get it too, and nothing re-polls.
      const pr = withGitHubAuthorAvatar(JSON.parse(row.data) as PullRequest);
      for (const key of JSON.parse(row.keys) as string[]) index.set(key, [...(index.get(key) ?? []), pr]);
    }
    for (const [key, prs] of index) index.set(key, sortPullRequests(prs));
    return index;
  };

  /** Saves one pull request GitHub returned; returns the keys whose list it changed. */
  const take = (node: GitHubNode): string[] => {
    if (!node.url) return [];
    const keys = pullRequestKeys(node);
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

  /** Matches the stored pull requests again under a new `MATCHER`, from what they keep (branch name and title), so a link the old
   *  rule made goes at once. The description isn't kept: the next poll reads again from the oldest one that changed, so its magic
   *  words link once more. The keys whose list changed wait in `pending` for the next poll to return. */
  const rematch = db.transaction(() => {
    if (getMeta("matcher") === MATCHER) return;
    setMeta("matcher", MATCHER);
    const changed = new Set<string>(JSON.parse(getMeta("pending") ?? "[]"));
    let oldest = Infinity;
    for (const row of db
      .query<{ url: string; keys: string; data: string }, []>("SELECT url, keys, data FROM github_pull_requests")
      .all()) {
      const pr = JSON.parse(row.data) as PullRequest;
      const keys = pullRequestKeys({ headRefName: pr.branch, title: pr.title });
      if (row.keys === JSON.stringify(keys)) continue;
      for (const key of [...JSON.parse(row.keys), ...keys]) changed.add(key);
      oldest = Math.min(oldest, Date.parse(pr.updated ?? "") || 0);
      if (keys.length) put.run(row.url, JSON.stringify(keys), row.data);
      else remove.run(row.url);
    }
    const since = Number(getMeta("since") ?? 0);
    if (since && oldest < since) setMeta("since", String(oldest));
    if (changed.size) setMeta("pending", JSON.stringify([...changed]));
  });
  rematch();

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

  /** Reads every pull request updated since the last poll into the store, adding the keys whose list changed to `changed`. */
  async function poll(changed: Set<string>) {
    const scope = (await sources()).join(" ");
    if (!scope) return;
    const started = now();
    if (getMeta("scope") !== scope) {
      // Other sources: what the old ones linked no longer counts.
      for (const key of byKey().keys()) changed.add(key);
      db.run("DELETE FROM github_pull_requests");
      db.run("DELETE FROM github_meta WHERE k = 'since'");
      setMeta("scope", scope);
    }
    const since = Number(getMeta("since") ?? 0);
    let from = since ? since - OVERLAP_MS : started - options.backfillDays * DAY_MS,
      after: string | undefined,
      read = 0;
    // Oldest first, so each page moves the mark on: a poll cut off (by GitHub's limit, or an error) resumes where it stopped.
    for (;;) {
      const { search } = await options.client.graphql<SearchPage>(SEARCH, {
        q: `is:pr ${scope} updated:>=${iso(from)} sort:updated-asc`,
        after: after ?? null,
      });
      for (const node of search.nodes) for (const key of take(node)) changed.add(key);
      read += search.nodes.length;
      const last = Date.parse(search.nodes.at(-1)?.updatedAt ?? "");
      if (last) setMeta("since", String(Math.max(last, since)));
      if (search.pageInfo.hasNextPage && search.pageInfo.endCursor) {
        after = search.pageInfo.endCursor;
        continue;
      }
      // Past the search's cap: the next query starts at the newest pull request this one reached.
      if (read < SEARCH_CAP || search.issueCount <= read || !last || last <= from) break;
      from = last;
      after = undefined;
      read = 0;
    }
    setMeta("since", String(started));
  }

  return {
    forKey: (key: string): PullRequest[] => byKey().get(key) ?? [],
    keys: () => [...byKey().keys()],
    /** Reads every pull request updated since the last poll (the backfill window on the first) and returns the keys it changed. */
    async refresh(): Promise<string[]> {
      // Keys an earlier poll changed but couldn't return, as it failed (or the matcher changed on start).
      const changed = new Set<string>(JSON.parse(getMeta("pending") ?? "[]"));
      try {
        await poll(changed);
        db.run("DELETE FROM github_meta WHERE k = 'pending'");
        return [...changed];
      } catch (error) {
        if (changed.size) setMeta("pending", JSON.stringify([...changed]));
        throw error;
      } finally {
        if (changed.size) index = undefined;
      }
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
