import { viewRepository } from "./view-repository";
import { Database } from "bun:sqlite";
import { jira, JiraError } from "./jira";
import { jiraProblem } from "./jira-problem";
import { boardFromInput, boardProject, withoutAddedBoard } from "./config";
import type { Board } from "@/shared/issue-model";
import { detailCache } from "./detail-cache";
import { historyCache, readHistory } from "./issue-history";
import { linkedPullRequests, pullRequestNumbers, readPullRequests } from "./pull-requests";
import { gitHubClient, gitHubConfiguration, gitHubPullRequests, gitHubToken, GitHubPaused } from "./github-pull-requests";
import {
  mergePullRequests,
  singlePullRequestNumber,
  withGitHubPullRequests,
  withPullRequestNumber,
  type PullRequest,
} from "@/shared/pull-requests";
import { missingLinkTitles, recentlyTouched, storeRemoteLinks } from "./remote-links";
import { attachmentGateway, jiraAttachmentReader } from "@/shared/attachment-media";
import { cachePath, saveAddedBoard, serverAuth } from "./server-config";
import { threadParent } from "@/shared/jira-ops";
import { statusDates, type History } from "@/shared/issue-properties";
import {
  issueProjection,
  SLIM_VERSION,
  type IssueProjection,
  jiraUser,
  propertyEntries,
  remoteLinkData,
  watcherList,
} from "./issue-projection";
import { serverConfiguration } from "./server-config";
import { unseenChanged } from "./notifications";
import { writeLedger } from "./write-ledger";
import { avatarProxy, type AvatarCache } from "@/shared/avatar-proxy";
import { faviconProxy } from "./favicon";
import { smartLinkCache } from "./smart-link";
import { droppedBoardMeta, issueStore } from "./issue-store";
import { readWholeBoard, syncHealthOf } from "./board-sync";
import { keptChildren, keptIssues } from "./kept-issues";

const configuration = serverConfiguration();
// `bun --hot` re-runs this module on every edit; the loops and the open tabs live on globalThis so they survive it.
const g = globalThis as {
  syncing?: boolean;
  live?: { clients: Set<Client>; wake: () => void };
  boards?: number[];
};
/** Live: a board added in the app joins it, and the sync loop (which outlives a hot reload) reads the same array. */
export const BOARDS = (g.boards ??= []);
for (const b of configuration.boards) if (!BOARDS.includes(b)) BOARDS.push(b);
/** Set by `start`, from the site's fields. */
let projection: IssueProjection;
/** The site's story point field IDs, the preferred one first. Set by `start`. */
export let ESTIMATES: string[] = [];
const ACTIVE_POLL_MS = 5_000; // a tab is open and visible
const IDLE_POLL_MS = 60_000; // no tab open: keep the mirror warm
const OPEN_ISSUE_POLL_MS = 3_000;
const PROBE_MS = 30_000; // the deleted-issue count check
const GITHUB_POLL_MS = 30_000; // GitHub's pull requests: one search per poll once the backfill is read
const FULL_SYNC_EVERY_MS = 6 * 3600_000; // full sync also sweeps out issues that left a board
const PAGE = 100;
const PARALLEL = 4;

const db = new Database(cachePath(), { create: true, strict: true });
// Every open tab re-reads the views when one changes; `notify` is defined below and only runs after a write.
export const views = viewRepository(db, () => notify("views"));
db.run("PRAGMA journal_mode = WAL");
/** Issues and the boards that hold them (an issue is on every board whose filter holds it). */
const store = issueStore(db);
/** Bumped when every board needs a full sync on its next turn: "5" came with per-board membership, whose migration kept only
 *  the last board's claim to a shared issue. */
const FIELDS = "5";
db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
db.run(
  "CREATE TABLE IF NOT EXISTS issue_properties (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, synced INTEGER NOT NULL, data TEXT NOT NULL)",
);
db.run(
  "CREATE TABLE IF NOT EXISTS issue_details (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, data TEXT NOT NULL)",
);

db.run("CREATE TABLE IF NOT EXISTS attachment_media (id TEXT PRIMARY KEY, media_id TEXT NOT NULL)");
export const ledger = writeLedger(db);
db.run(
  "CREATE TABLE IF NOT EXISTS avatars (url TEXT PRIMARY KEY, type TEXT NOT NULL, body BLOB NOT NULL, at INTEGER NOT NULL)",
);
/** Avatar images (and smart links' site icons), at most 512KB each; the newest 2,000 are kept. */
const imageCache: AvatarCache = {
    get: (url) =>
      db
        .query<{ type: string; body: Uint8Array; at: number }, [string]>(
          "SELECT type, body, at FROM avatars WHERE url = ?",
        )
        .get(url) ?? undefined,
    set: (url, type, body) => {
      db.query("INSERT OR REPLACE INTO avatars VALUES (?, ?, ?, ?)").run(
        url,
        type,
        body,
        Date.now(),
      );
      db.run(
        "DELETE FROM avatars WHERE url NOT IN (SELECT url FROM avatars ORDER BY at DESC LIMIT 2000)",
      );
    },
};
export const avatar = avatarProxy({ site: configuration.site, auth: serverAuth(), cache: imageCache });
/** Smart links' site icons (BJ-16), beside the avatars. */
export const favicon = faviconProxy({ cache: imageCache });
/** Smart links' issue and page titles on the configured site (BJ-16). */
export const smartLinkDetails = smartLinkCache(db, configuration.site, jira);

const getMeta = (k: string) =>
  db.query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(k)?.v;
const setMeta = (k: string, v: string) =>
  db.query("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(k, v);
/** Which issues have pull requests, by Jira's development index; the Development field each issue carries lags it. */
const linkedPrs = linkedPullRequests({ get: getMeta, set: setMeta });
/** The pull requests GitHub links to Jira keys (branch name, title, or description after a magic word), for organisations Jira's
 *  GitHub app doesn't cover. */
const github = gitHubPullRequests(db, {
  client: gitHubClient(() => gitHubToken()),
  ...gitHubConfiguration(),
});
/** The pull request URLs Jira's development panel lists, per issue, read where GitHub links the same issue, so a pull request both
 *  link counts once. */
const jiraPrUrls = new Map<string, string[]>();
/** The number of each issue's one pull request by Jira's development detail, for its badge's first paint. */
const prNumbers = pullRequestNumbers(db);
/** An issue's pull requests by Jira alone: its Development field, with the development index's say on whether it has any. */
const jiraSlimOf = (raw: any, boards: number[]) => linkedPrs.apply(projection.slim(raw), boards);
/** An issue as the board and search read it: Jira's pull requests, with GitHub's added, and the one pull request's number
 *  (GitHub's, else Jira's detail's) in the same row as the count, so one board update brings both. `boards` hold it (pull
 *  request links are read per board). */
const slimOf = (raw: any, boards: number[]) => {
  const slim = jiraSlimOf(raw, boards),
    fromGitHub = github.forKey(slim.key);
  return withPullRequestNumber(
    withGitHubPullRequests(slim, fromGitHub, jiraPrUrls.get(slim.key)),
    fromGitHub,
    prNumbers.apply(slim.key, slim),
  );
};
const source = JSON.stringify({ site: configuration.site, email: configuration.email });
if (getMeta("source") && getMeta("source") !== source)
  throw new Error(
    "This cache belongs to another Jira site or account. Choose a different JIRA_CACHE or rerun setup.",
  );
setMeta("source", source);
/** A board's sync read these issues: they are on `board`, and their content is saved when newer. Returns the keys Jira changed
 *  since the mirror last saw them, and the keys newly on the board. */
const save = db.transaction((board: number, issues: any[], seen: number) => {
  const changed: string[] = [];
  for (const i of issues) {
    const joined = store.see(i.key, board, seen);
    // Jira's search index can lag behind a newer copy saved from an issue read; the upsert keeps the newer one, so that is no change.
    if (joined || store.updated(i.key) < i.fields.updated) changed.push(i.key);
    saveContent(i);
  }
  return changed;
});
/** Saves an issue Jira returned, for the boards already holding it; never changes which boards those are. One no board holds
 *  is kept on none. */
const saveContent = (raw: any) =>
  store.put({ key: raw.key, slim: slimOf(raw, store.boardsOf(raw.key)), full: raw });

/** Whether the mirror has the issue, reading it from Jira the first time something asks for it by key (kept-issues.ts). */
const kept = keptIssues({
  has: (key) => !!store.updated(key),
  read: (key) => jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${projection.fields}`),
  save: saveContent,
});

const page = (board: number, jql: string, startAt: number) =>
  jira(
    `/rest/agile/1.0/board/${board}/issue?` +
      new URLSearchParams({
        jql,
        fields: projection.fields,
        startAt: String(startAt),
        maxResults: String(PAGE),
      }),
  );

/** A board's columns and Jira project: its configuration lists status ids only; names and categories come from the status list.
 *  The project is the board's location (null for a board kept in a user's space): what an empty board creates in, and whose
 *  issue types the options list. */
async function boardColumns(board: number) {
  const [config, statuses] = await Promise.all([
    jira(`/rest/agile/1.0/board/${board}/configuration`),
    jira<any[]>("/rest/api/3/status"),
  ]);
  const byId = new Map(
    statuses.map((s) => [s.id, { id: s.id, name: s.name, category: s.statusCategory.key }]),
  );
  const columns = config.columnConfig.columns.map((c: any) => ({
    name: c.name,
    statuses: c.statuses.map(
      (s: any) => byId.get(s.id) ?? { id: s.id, name: s.id, category: "indeterminate" },
    ),
  }));
  return { id: board, name: config.name, columns, project: boardProject(config.location) };
}

/** While a first sync streams in, open tabs re-read the mirror at most this often. */
const STREAM_NOTIFY_MS = 2_000;
/** Full syncs under way, by board: the loop never starts a second read of a board one is still reading. */
const fullSyncs = new Map<number, Promise<void>>();
/** Reads every issue on the board and sweeps out the ones it no longer holds. `shown` runs once the first page and the
 *  board's columns are in: on the board's first sync it shows then, and the rest streams into open tabs (BJ-338). */
function fullSync(board: number, shown?: () => void) {
  const run = readFullBoard(board, shown).finally(() => fullSyncs.delete(board));
  fullSyncs.set(board, run);
  return run;
}
async function readFullBoard(board: number, shown?: () => void) {
  const t0 = Date.now(),
    first = !getMeta(`full:${board}`);
  const jql = "ORDER BY key ASC"; // stable order so parallel startAt pages don't skip issues
  let streamed = 0;
  const { total } = await readWholeBoard({
    page: (startAt) => page(board, jql, startAt),
    columns: () => boardColumns(board),
    save: (issues) => save(board, issues, t0),
    shown: (columns, progress) => {
      setMeta(`config:${board}`, JSON.stringify(columns));
      boardSync.set(board, { ...boardSync.get(board), progress });
      if (first) notify("boards");
      shown?.();
    },
    landed: () => {
      if (!first || Date.now() - streamed < STREAM_NOTIFY_MS) return;
      streamed = Date.now();
      notify();
    },
    pageSize: PAGE,
    parallel: PARALLEL,
  });
  const gone = store.sweep(board, t0);
  boardSync.set(board, { ...boardSync.get(board), progress: undefined });
  setMeta(`full:${board}`, String(t0));
  setMeta(`inc:${board}`, String(t0));
  setMeta(`fields:${board}`, FIELDS);
  console.log(`[sync] board ${board}: full, ${total} issues, ${gone} removed, ${Date.now() - t0}ms`);
}

/** Fetch issues updated since the last sync (with a minute of overlap). Returns the keys that actually changed. */
async function incrementalSync(board: number): Promise<string[]> {
  const t0 = Date.now();
  const since = Number(getMeta(`inc:${board}`));
  // Relative minutes avoid JQL's profile-timezone date parsing; +1 minute of overlap.
  const jql = `updated >= -${Math.ceil((t0 - since) / 60_000) + 1}m ORDER BY key ASC`;
  const keys: string[] = [];
  for (let s = 0, total = 1; s < total; s += PAGE) {
    const p = await page(board, jql, s);
    total = p.total;
    keys.push(...save(board, p.issues, t0));
  }
  setMeta(`inc:${board}`, String(t0));
  return keys;
}

/** Re-projects the stored issues' pull request count, state and number. Returns whether any changed. */
function reprojectPullRequests(rows: { key: string; slim: string; full: string }[]) {
  const update = db.query("UPDATE issues SET slim = ? WHERE key = ?");
  let changed = false;
  db.transaction(() => {
    for (const row of rows) {
      // From the stored Jira record, so an issue the index links again gets the field's own count and state back.
      const slim = JSON.parse(row.slim),
        next = slimOf(JSON.parse(row.full), store.boardsOf(row.key));
      if (next.prCount === slim.prCount && next.prStatus === slim.prStatus && next.prNumber === slim.prNumber) continue;
      update.run(
        JSON.stringify({ ...slim, prCount: next.prCount, prStatus: next.prStatus, prNumber: next.prNumber }),
        row.key,
      );
      changed = true;
    }
  })();
  return changed;
}
const rowsOf = (keys: string[]) =>
  keys.length
    ? db
        .query<{ key: string; slim: string; full: string }, string[]>(
          `SELECT key, slim, full FROM issues WHERE key IN (${keys.map(() => "?").join(",")})`,
        )
        .all(...keys)
    : [];

const prsProbed = new Map<number, number>();
/** Re-reads which of the board's issues Jira's development index links pull requests to, on the probe's cadence, and re-projects
 *  the issues whose answer changed. Linking a pull request leaves an issue's `updated` alone, so the sync never re-reads it, and
 *  its Development field can say none. Returns whether any issue changed. */
async function syncLinkedPullRequests(board: number) {
  if (Date.now() - (prsProbed.get(board) ?? 0) < PROBE_MS) return false;
  prsProbed.set(board, Date.now());
  const keys = await linkedPrs.refresh(jira, board);
  const rows = store
    .rowsOn(board)
    .filter((row) => !keys || keys.includes(row.key));
  return reprojectPullRequests(rows);
}

/** Jira panels read per GitHub poll for issues both sources link. */
const OVERLAP_READS = 5;
/** Reads Jira's pull request URLs for issues GitHub links that Jira links too, a few per poll, so their count is the union. */
async function readOverlaps() {
  const keys = rowsOf(github.keys().filter((key) => !jiraPrUrls.has(key)))
    .filter((row) => jiraSlimOf(JSON.parse(row.full), store.boardsOf(row.key)).prCount)
    .slice(0, OVERLAP_READS);
  for (const row of keys) jiraPrUrls.set(row.key, (await readPullRequests(jira, row.key)).map((pr) => pr.url));
  return reprojectPullRequests(keys);
}

/** Jira development details read per poll for the number of an issue's one pull request. */
const NUMBER_READS = 5;
/** After a detail read fails, that issue waits this long, and every other one a minute (Jira refusing or rate limiting). */
const NUMBER_RETRY_MS = 10 * 60_000,
  NUMBER_PAUSE_MS = 60_000;
/** With nothing due at the last look and no board change since, the issues are looked over again only this often. */
const NUMBER_IDLE_MS = 30_000;
const numberFailed = new Map<string, number>();
let numbersBusy = false,
  numbersPaused = 0,
  numbersIdleSince = 0;
/** Reads Jira's development detail for a few issues with one pull request whose number neither GitHub nor an earlier read gave
 *  (or whose Jira count or state moved since), beside the board loop and never holding it up, then re-projects them and tells open
 *  tabs. Until it lands the badge keeps the number's room (card-badges.tsx). Reads only. */
function readPullRequestNumbers(boardsChanged: boolean) {
  const now = Date.now();
  if (numbersBusy || now < numbersPaused || (!boardsChanged && now - numbersIdleSince < NUMBER_IDLE_MS)) return;
  const due = db
    .query<{ key: string; status: string | null }, []>(
      "SELECT key, json_extract(slim, '$.prStatus') AS status FROM issues WHERE json_extract(slim, '$.prCount') = 1",
    )
    .all()
    // GitHub names its own pull request's number; with none from GitHub the row's count and state are Jira's alone.
    .filter(({ key }) => !github.forKey(key).length && now - (numberFailed.get(key) ?? 0) > NUMBER_RETRY_MS)
    .map(({ key, status }) => ({ key, jira: { prCount: 1, prStatus: (status ?? undefined) as PullRequest["status"] | undefined } }))
    .filter(({ key, jira }) => prNumbers.stale(key, jira))
    .slice(0, NUMBER_READS);
  if (!due.length) return void (numbersIdleSince = now);
  numbersIdleSince = 0;
  numbersBusy = true;
  void (async () => {
    for (const { key, jira: at } of due) {
      try {
        prNumbers.set(key, at, singlePullRequestNumber(await readPullRequests(jira, key)));
      } catch (e) {
        numberFailed.set(key, Date.now());
        numbersPaused = Date.now() + NUMBER_PAUSE_MS;
        console.error(`[prs] ${key}:`, String((e as Error)?.message ?? e).slice(0, 200));
        break;
      }
    }
    if (reprojectPullRequests(rowsOf(due.map((d) => d.key)))) notify();
  })().finally(() => (numbersBusy = false));
}

let githubPolled = 0,
  githubBusy = false,
  /** The last poll's error, logged once until the source reads again (no token, or GitHub's rate limit spent). */
  githubError = "";
/** Reads GitHub's changed pull requests every `GITHUB_POLL_MS`, beside the board loop and never holding it up (the first poll reads
 *  the backfill window), then re-projects the issues whose pull requests changed and tells open tabs. */
function syncGitHub() {
  if (githubBusy || Date.now() - githubPolled < GITHUB_POLL_MS) return;
  githubBusy = true;
  githubPolled = Date.now();
  void github
    .refresh()
    .then(async (keys) => {
      githubError = "";
      if (keys.length) console.log(`[github] pull requests changed on ${keys.length} keys`);
      const changed = reprojectPullRequests(rowsOf(keys));
      if ((await readOverlaps()) || changed) notify();
    })
    .catch((e) => {
      const message = e instanceof GitHubPaused ? "paused" : String(e?.message ?? e).slice(0, 200);
      if (message !== githubError) console.error("[github]", e instanceof GitHubPaused ? e.message : message);
      githubError = message;
    })
    .finally(() => (githubBusy = false));
}

const probed = new Map<number, number>();
/** Returns whether the mirror changed. */
async function syncBoard(board: number) {
  // A board added in the app is still streaming in: its own read tells open tabs.
  if (fullSyncs.has(board)) return false;
  const lastFull = Number(getMeta(`full:${board}`) ?? 0);
  if (getMeta(`fields:${board}`) !== FIELDS || Date.now() - lastFull > FULL_SYNC_EVERY_MS)
    return (await fullSync(board), true);
  // A board mirrored before its project was kept reads its configuration again, once.
  if (!("project" in (JSON.parse(getMeta(`config:${board}`) ?? "{}") as object)))
    setMeta(`config:${board}`, JSON.stringify(await boardColumns(board)));
  const keys = await incrementalSync(board);
  if (keys.length) console.log(`[sync] board ${board}: ${keys.join(" ")}`);
  if (Date.now() - (probed.get(board) ?? 0) < PROBE_MS) return keys.length > 0;
  probed.set(board, Date.now());
  // Jira has no feed of deleted issues. A board holding fewer issues than the mirror lost some (deleted or moved off it): resync it.
  const { total } = await jira<{ total: number }>(
    `/rest/agile/1.0/board/${board}/issue?maxResults=1&fields=key`,
  );
  if (total < store.count(board)) return (await fullSync(board), true);
  return keys.length > 0;
}

/** Per board: why the last sync failed, in words (jira-problem.ts), and a full sync's progress while it reads. */
const boardSync = new Map<number, { error?: string; progress?: { loaded: number; total: number } }>();
/** Records a board's sync outcome; open tabs re-read the health when the error appears, changes or clears. */
function recordSync(board: number, error?: unknown) {
  const before = boardSync.get(board)?.error,
    after = error === undefined ? undefined : jiraProblem(error, configuration.site, board);
  boardSync.set(board, { ...boardSync.get(board), error: after });
  if (before !== after) notify();
}
/** What the app shows about syncing (board-sync.ts `syncHealthOf`). */
export const syncHealth = () =>
  syncHealthOf(
    BOARDS.map((id) => ({ id, ...boardSync.get(id) })),
    (board) => !!getMeta(`full:${board}`),
  );

type Client = { issue?: string; send: (kind?: "changed" | "inbox" | "boards" | "views") => void };
const live = (g.live ??= { clients: new Set(), wake: () => {} });
/** An open, visible tab, and the issue it shows. Jira is polled fast while one is connected; the first one syncs at once. Returns the disconnect. */
export function watch(client: Client) {
  live.clients.add(client);
  live.wake();
  return () => void live.clients.delete(client);
}
/** Tells every open tab the mirror changed, so it refetches now instead of on its timer. */
const notify = (kind?: "inbox" | "boards" | "views") => {
  for (const client of live.clients) client.send(kind);
};

async function loop() {
  for (;;) {
    const changed = await Promise.all(
      BOARDS.map(async (b) => {
        const synced = await syncBoard(b).then(
          (changed) => (recordSync(b), changed),
          (e) => (console.error(`[sync] board ${b}:`, e.message), recordSync(b, e), false),
        );
        const prs = await syncLinkedPullRequests(b).catch((e) => (console.error(`[prs] board ${b}:`, e.message), false));
        return synced || prs;
      }),
    );
    if (changed.includes(true)) notify();
    syncGitHub();
    readPullRequestNumbers(changed.includes(true));
    if (live.clients.size)
      void unseenChanged().then(
        (moved) => moved && notify("inbox"),
        (e) => console.error("[inbox]", String(e).slice(0, 200)),
      );
    void enrichProperties().catch((e) => console.error("[properties]", String(e).slice(0, 200)));
    await new Promise<void>((resolve) => {
      live.wake = resolve;
      setTimeout(resolve, live.clients.size ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    });
  }
}

/** The issues open in tabs are checked every few seconds: a cheap `updated` read, and the full row only when it moved. */
async function watchOpenIssues() {
  for (;;) {
    await Bun.sleep(OPEN_ISSUE_POLL_MS);
    let changed = false;
    for (const key of new Set([...live.clients].flatMap((c) => (c.issue ? [c.issue] : [])))) {
      // Only issues the mirror has: one it lacks is read when something asks for it by key (`kept`), never by this poll, which
      // would ask Jira for an unsaved draft's key every few seconds.
      const updated = store.updated(key);
      if (!updated) continue;
      try {
        const [{ fields }, remote] = await Promise.all([
          jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=updated`),
          jira<any[]>(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`),
        ]);
        if (
          storeRemoteLinks(
            db,
            key,
            remoteLinkData(remote),
          )
        ) {
          db.query("DELETE FROM issue_details WHERE key = ?").run(key); // the panel's web links too
          changed = true;
        }
        if (fields.updated === updated) continue;
        saveContent(await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${projection.fields}`));
        console.log(`[sync] open issue ${key}`);
        changed = true;
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          store.remove(key);
          changed = true;
        } else console.error(`[sync] ${key}:`, String(error).slice(0, 200));
      }
    }
    if (changed) notify();
  }
}

/**
 * Starts the mirror; the server awaits it before serving. Importing this module only opens the cache.
 * Discovers the site's fields (custom field IDs differ per site), re-projects stored rows when the slim shape changed,
 * then starts polling Jira. Under `bun --hot` the loops already running are kept.
 */
export async function start() {
  projection = issueProjection(await jira<any[]>("/rest/api/3/field").catch(() => null));
  ESTIMATES = projection.estimates;
  // Each day, so a server left running prunes too.
  setInterval(ledger.prune, 24 * 3600_000).unref?.();
  // Expand existing cached rows immediately; a subsequent full sync fetches newly requested fields.
  if (getMeta("slim-version") !== SLIM_VERSION) {
    db.transaction(() => {
      const rows = db
        .query<{ key: string; full: string }, []>("SELECT key, full FROM issues")
        .all();
      const update = db.query("UPDATE issues SET slim = ? WHERE key = ?");
      for (const row of rows)
        update.run(JSON.stringify(slimOf(JSON.parse(row.full), store.boardsOf(row.key))), row.key);
      setMeta("slim-version", SLIM_VERSION);
    })();
  }
  forgetDroppedBoards();
  if (!g.syncing) {
    g.syncing = true;
    loop();
    watchOpenIssues();
  }
}

/** Boards no longer configured (dropped from setup, or removed in the app last run) let go of their issues and memberships,
 *  keeping any a configured board holds or that is kept on no board, and of their sync state (BJ-342). */
function forgetDroppedBoards() {
  const dropped = store.forgetBoards(BOARDS);
  const keys = db.query<{ k: string }, []>("SELECT k FROM meta").all().map((r) => r.k);
  const forget = db.query("DELETE FROM meta WHERE k = ?");
  for (const k of droppedBoardMeta(keys, BOARDS)) forget.run(k);
  if (dropped.length) console.log(`[sync] forgot boards no longer configured: ${dropped.join(", ")}`);
}

// --- reads (the UI only ever reads from here) ---

/** `removable` marks a board added in the app, which the sidebar can remove (BJ-24). */
export const boards = () =>
  BOARDS.map((b) => {
    const board = JSON.parse(getMeta(`config:${b}`) ?? "null");
    return board && !configuration.setupBoards.includes(b) ? { ...board, removable: true } : board;
  }).filter(Boolean);

/** Adds a board from a pasted link or ID: checked against Jira (reads only), mirrored, then saved for this site and pushed to open tabs. */
export async function addBoard(input: string) {
  const id = boardFromInput(input, configuration.site);
  if (BOARDS.includes(id)) {
    const name = boards().find((b) => b.id === id)?.name ?? `Board ${id}`;
    return { id, message: `${name} is already in your sidebar.` };
  }
  try {
    await jira(`/rest/agile/1.0/board/${id}`);
    // The board is added once its first page is in, and the rest streams in (BJ-338). A later page that fails is the
    // board's sync error, and the loop reads the board in full again.
    await new Promise<void>((added, failed) => {
      let shown = false;
      fullSync(id, () => ((shown = true), added())).then(
        () => notify(),
        (error) => {
          if (!shown) return failed(error);
          console.error(`[sync] board ${id}:`, String(error).slice(0, 300));
          recordSync(id, error);
        },
      );
    });
  } catch (error) {
    console.error(`[boards] add ${id}:`, String(error).slice(0, 300));
    if (error instanceof JiraError && [400, 401, 403, 404].includes(error.status))
      throw new Error(
        `Board ${id} doesn't exist on ${new URL(configuration.site).host}, or your Jira account can't see it.`,
        { cause: error },
      );
    throw new Error(`Could not read board ${id} from Jira. Retry in a moment.`, { cause: error });
  }
  await saveAddedBoard(id);
  if (!BOARDS.includes(id)) BOARDS.push(id);
  notify("boards");
  return { id, message: `Added ${boards().find((b) => b.id === id)?.name ?? `board ${id}`}.` };
}

/** Removes a board added in the app from this site's sidebar (BJ-24). Setup's boards stay; its cached rows stay, unread, until
 *  the next start forgets them (`forgetDroppedBoards`). */
export async function removeBoard(id: number) {
  if (!BOARDS.includes(id) || configuration.setupBoards.includes(id))
    throw new Error("Only a board added in the app can be removed.");
  await saveAddedBoard(id, withoutAddedBoard);
  BOARDS.splice(BOARDS.indexOf(id), 1);
  notify("boards");
}

/** Every issue on a configured board, slim, with the boards that hold it. ~3k rows, ~1MB: the UI keeps them all in memory for
 *  instant search, and every issue kept on no board. The app only knows configured boards. */
export const issues = () => `[${store.slims(BOARDS).join(",")}]`;

const details = detailCache(db, async (key) => {
  // The Agile endpoint returns legacy strings. API v3 preserves Jira's rich ADF tree.
  // Remote ("web") links someone added in Jira; the app shows them as link resources. Read alongside the fields.
  const [detail, remotelinks] = await Promise.all([
    jira(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description,comment,reporter,created,updated,attachment`,
    ),
    jira<any[]>(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`),
  ]);
  detail.fields.attachment ??= [];
  detail.remotelinks = remotelinks.flatMap((l) =>
    l.object?.url ? [{ url: l.object.url, title: l.object.title ?? l.object.url }] : [],
  );
  if (
    storeRemoteLinks(
      db,
      key,
      remoteLinkData(remotelinks),
    )
  )
    notify();
  const comments = detail.fields.comment;
  if (comments?.total) {
    // The comment endpoint carries Jira's reply threads (parentId), and the comment property older replies from this app kept them in.
    const complete: any[] = [];
    for (let start = 0; start < comments.total; start += 100) {
      const page = await jira(
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment?startAt=${start}&maxResults=100&expand=properties`,
      );
      complete.push(...page.comments);
      if (!page.comments.length) break;
    }
    detail.fields.comment = {
      ...comments,
      comments: complete.map(threadParent),
    };
  }
  return detail;
});
/** Every child Jira gives an issue through its `parent` field, kept when no board brought it (kept-issues.ts `keptChildren`). */
const children = keptChildren({
  search: async (key) => {
    const found: any[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = await jira<{ issues?: any[]; nextPageToken?: string }>(
        "/rest/api/3/search/jql?" +
          new URLSearchParams({
            jql: `parent = "${key}"`,
            fields: projection.fields,
            maxResults: "100",
            ...(nextPageToken ? { nextPageToken } : {}),
          }),
      );
      found.push(...(page.issues ?? []));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    return found;
  },
  updated: (key) => store.updated(key),
  save: saveContent,
  keptUnder: (key) =>
    db
      .query<{ key: string }, [string]>(
        `SELECT key FROM issues i WHERE json_extract(slim,'$.parent') = ?
           AND NOT EXISTS (SELECT 1 FROM issue_boards m WHERE m.key = i.key)`,
      )
      .all(key)
      .map((r) => r.key),
  read: (key) => jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${projection.fields}`),
  remove: (key) => store.remove(key),
});
/** The issue's details; one the mirror lacks is read and kept first (`kept`). Undefined when Jira has no such issue. Its
 *  children no board holds are read alongside, and open tabs hear when one arrives. */
export const issue = async (key: string) => {
  if (!(await kept(key))) return undefined;
  const [row] = rowsOf([key]);
  void children(key, row && JSON.parse(row.slim).level).then(
    (saved) => saved && notify(),
    (e) => console.error(`[sync] children of ${key}:`, String(e).slice(0, 200)),
  );
  return details.read(key);
};
const histories = historyCache(
  db,
  (key) => readHistory(jira, key),
  (key) =>
    db
      .query<{ updated: string }, [string]>(
        "SELECT json_extract(slim,'$.updated') AS updated FROM issues WHERE key = ?",
      )
      .get(key)?.updated,
);
/** The issue's whole Jira changelog for its Activity, read apart from the details so it never holds up their first paint. */
export const history = async (key: string) => ((await kept(key)) ? histories(key) : undefined);
/** The issue's pull requests from Jira's development panel and from GitHub, one per URL, read when a card's pull request badge
 *  asks. Jira's list also settles the issue's count where both link the same pull request. When Jira can't answer, GitHub's stand. */
export async function pullRequests(key: string) {
  const fromGitHub = github.forKey(key);
  // Jira's count and state as they were when the detail was asked for: the number read is stored for them.
  const [row] = rowsOf([key]);
  const at = row && jiraSlimOf(JSON.parse(row.full), store.boardsOf(key));
  const fromJira = await readPullRequests(jira, key).catch((error) => {
    if (!fromGitHub.length) throw error;
    return undefined;
  });
  if (fromJira) {
    if (fromGitHub.length) jiraPrUrls.set(key, fromJira.map((pr) => pr.url));
    if (at) prNumbers.set(key, at, singlePullRequestNumber(fromJira));
    if (reprojectPullRequests(rowsOf([key]))) notify();
  }
  return mergePullRequests(fromJira ?? [], fromGitHub);
}
/** Re-read one issue from Jira after a write, so reads and the next client poll see Jira's truth. Null when it no longer exists. */
export async function refresh(
  key: string,
  board?: number,
): Promise<{ issue: any; full: any } | null> {
  // Watchers are read alongside, so a write settles in two Jira round trips, not four (R2-create-D2).
  const watching = jira(`/rest/api/3/issue/${encodeURIComponent(key)}/watchers`);
  watching.catch(() => {});
  let raw: any;
  try {
    raw = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${projection.fields}`);
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      store.remove(key);
      notify(); // other tabs drop it
      return null;
    }
    throw error;
  }
  // `board` is the board a new issue was made on (jira-writes.ts sends it for a create only): it starts there. An issue no
  // board holds (one linked from a board issue) is kept on none.
  if (board !== undefined) store.claim(raw.key, board, BOARDS);
  const held = store.boardsOf(raw.key);
  saveContent(raw);
  db.query("DELETE FROM issue_details WHERE key = ?").run(raw.key);
  const [full, w] = await Promise.all([details.read(raw.key, true), watching]),
    issue = { boards: BOARDS.filter((b) => held.includes(b)), ...slimOf(raw, held) };
  const { watchers, watchersComplete } = watcherList(w);
  const old = db
    .query<{ data: string; source_updated: string }, [string]>(
      "SELECT data,source_updated FROM issue_properties WHERE key = ?",
    )
    .get(key);
  const props = {
    ...(old ? JSON.parse(old.data) : {}),
    watchers,
    watchersComplete,
  };
  // Keep the old revision stamp: status dates in `data` predate this write, so enrichment must recompute them.
  db.query("INSERT OR REPLACE INTO issue_properties VALUES (?,?,?,?)").run(
    key,
    old?.source_updated ?? "",
    Date.now(),
    JSON.stringify(props),
  );
  notify(); // other tabs see the write
  return {
    issue: { ...issue, watchers, watchersComplete: props.watchersComplete },
    full: full && JSON.parse(full),
  };
}
export const media = attachmentGateway({
  readIssue: details.readParsed,
  read: jiraAttachmentReader(serverAuth()),
  lookup: (id) =>
    db
      .query<{ media_id: string }, [string]>("SELECT media_id FROM attachment_media WHERE id = ?")
      .get(id)?.media_id,
  remember: (id, mediaId) => {
    db.query("INSERT OR REPLACE INTO attachment_media VALUES (?,?)").run(id, mediaId);
  },
});
let profileRequest: Promise<{ id: string; name: string; avatar?: string }> | undefined;
async function profile() {
  try {
    const user = await jira("/rest/api/3/myself");
    const profile = jiraUser(user);
    if (!profile.id) throw new Error("Jira did not return an account ID");
    setMeta("profile", JSON.stringify(profile));
    return profile;
  } catch (error) {
    const cached = getMeta("profile");
    if (cached) return JSON.parse(cached);
    throw error;
  }
}
export async function clientInfo() {
  const user = await (profileRequest ??= profile().catch((error) => {
    profileRequest = undefined;
    throw error;
  }));
  return { site: configuration.site, user, namespace: `${configuration.site}/${user.id}` };
}

export const viewDefaults = () =>
  Object.fromEntries(
    BOARDS.flatMap((id) => {
      const value = getMeta(`view-default:${id}`);
      return value ? [[id, JSON.parse(value)]] : [];
    }),
  );
export const saveViewDefault = (id: number, display: object) =>
  setMeta(`view-default:${id}`, JSON.stringify(display));

let enriching = false;
let propertyProgress = { pending: 0, completed: 0, errors: 0 };

/** Extra reads never sit on the board's request path. Cache them across process restarts. */
async function enrichProperties() {
  if (enriching) return;
  const recent = [...recentlyTouched(db), ...missingLinkTitles(db)];
  const rows = db
    .query<{ key: string; full: string; slim: string }, [number, number, string]>(
      `SELECT i.key,i.full,i.slim FROM issues i LEFT JOIN issue_properties p ON p.key=i.key
    WHERE p.key IS NULL OR p.source_updated != json_extract(i.slim,'$.updated') OR p.synced < ?
      OR (json_array_length(p.data,'$.errors') > 0 AND p.synced < ?)
      OR i.key IN (SELECT value FROM json_each(?))`,
    )
    .all(Date.now() - FULL_SYNC_EVERY_MS, Date.now() - 15 * 60000, JSON.stringify(recent));
  if (!rows.length) return;
  enriching = true;
  propertyProgress = { pending: rows.length, completed: 0, errors: 0 };
  const byStatus = new Map(
    boards().flatMap((b: any) =>
      b.columns.flatMap((c: any) => c.statuses.map((s: any) => [s.id, s.category])),
    ),
  );
  try {
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows
        .slice(offset, offset + 500)
        .map((r) => ({ ...r, raw: JSON.parse(r.full), issue: JSON.parse(r.slim) }));
      const histories = new Map<string, History[]>();
      let historyError = false;
      try {
        let nextPageToken: string | undefined;
        do {
          // POST is Jira's documented bulk READ endpoint. It changes no issues.
          const page = await jira("/rest/api/3/changelog/bulkfetch", {
            method: "POST",
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify({
              issueIdsOrKeys: batch.map((r) => r.key),
              fieldIds: ["status"],
              maxResults: 1000,
              ...(nextPageToken ? { nextPageToken } : {}),
            }),
          });
          for (const entry of page.issueChangeLogs ?? [])
            histories.set(entry.issueId, [
              ...(histories.get(entry.issueId) ?? []),
              ...entry.changeHistories,
            ]);
          nextPageToken = page.nextPageToken;
        } while (nextPageToken);
      } catch (e) {
        historyError = true;
        console.error("[properties] status history:", String(e).slice(0, 200));
      }
      const queue = [...batch];
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let row; (row = queue.shift());) {
            const errors: string[] = [];
            const data: any = { status: row.issue.status };
            if (historyError) errors.push("Status history unavailable");
            else
              Object.assign(
                data,
                statusDates(
                  row.raw.fields.created,
                  row.issue.status,
                  histories.get(row.raw.id) ?? [],
                  (id) => byStatus.get(id) as string | undefined,
                ),
              );
            try {
              const watches = row.raw.fields.watches;
              const w =
                watches?.watchCount === 0
                  ? { watchCount: 0, watchers: [] }
                  : await jira(`/rest/api/3/issue/${encodeURIComponent(row.key)}/watchers`, {
                      signal: AbortSignal.timeout(30000),
                    });
              Object.assign(data, watcherList(w));
              if (!data.watchersComplete)
                errors.push("Watcher list restricted by Jira permissions");
            } catch {
              data.watchersComplete = false;
              errors.push("Watcher list unavailable");
            }
            try {
              // Jira web links live outside the search fields; the Links filter matches them too.
              Object.assign(
                data,
                remoteLinkData(
                  await jira<any[]>(`/rest/api/3/issue/${encodeURIComponent(row.key)}/remotelink`, {
                    signal: AbortSignal.timeout(30000),
                  }),
                ),
              );
            } catch {
              errors.push("Web links unavailable");
            }
            if (errors.length) {
              data.errors = errors;
              propertyProgress.errors++;
            }
            db.query("INSERT OR REPLACE INTO issue_properties VALUES (?,?,?,?)").run(
              row.key,
              row.issue.updated,
              Date.now(),
              JSON.stringify(data),
            );
            propertyProgress.completed++;
            propertyProgress.pending--;
          }
        }),
      );
    }
  } finally {
    enriching = false;
  }
}

export const properties = () => ({
  ...propertyEntries(store.propertyRows(BOARDS), propertyProgress.pending),
  sync: syncHealth(),
});

/** People to @mention: those Jira lets see the issue (user/viewissue/search), as its own mention picker offers. That search returns no one for an empty
 * query, so a bare "@" lists the issue's assignable people; without an issue (a new one), anyone on the site. Apps and deactivated accounts are left out. */
export async function people(query: string, issue?: string) {
  const params = new URLSearchParams({
    query,
    maxResults: "20",
    ...(issue ? { issueKey: issue } : {}),
  });
  const search = (kind: string) => jira<any[]>(`/rest/api/3/user/${kind}?${params}`);
  const found = issue
    ? await search(query ? "viewissue/search" : "assignable/search").catch(() => {
        params.delete("issueKey");
        return search("search");
      })
    : await search("search");
  return found
    .filter((u) => u.accountType === "atlassian" && u.active !== false)
    .map(jiraUser);
}

/** Jira's choices for the property menus (priorities, assignable people, versions, labels). Cached for ten minutes. */
let optionCache: { at: number; value: Promise<any> } | undefined;
export function options() {
  if (optionCache && Date.now() - optionCache.at < 600_000) return optionCache.value;
  const value = (async () => {
    // The boards' own projects too, so an empty board's issue types and people are known.
    const projects = [
      ...new Set([
        ...boards().flatMap((b: Board) => (b.project ? [b.project.key] : [])),
        ...db
          .query<{ key: string }, []>(
            "SELECT DISTINCT json_extract(slim,'$.project.key') AS key FROM issues",
          )
          .all()
          .map((r) => r.key)
          .filter(Boolean),
      ]),
    ];
    const [priorities, users, labels, versions, types] = await Promise.all([
      jira<any[]>("/rest/api/3/priority"),
      projects.length
        ? jira<any[]>(
            `/rest/api/3/user/assignable/multiProjectSearch?${new URLSearchParams({ projectKeys: projects.join(","), maxResults: "1000" })}`,
          )
        : [],
      jira<{ values: string[] }>("/rest/api/3/label?maxResults=1000").then(
        (r) => r.values,
        () => [],
      ),
      Promise.all(
        projects.map(
          async (key) =>
            [
              key,
              (
                await jira<any[]>(`/rest/api/3/project/${encodeURIComponent(key)}/versions`).catch(
                  () => [],
                )
              )
                .filter((v) => !v.archived)
                .map((v) => ({ id: v.id, name: v.name })),
            ] as const,
        ),
      ),
      // Each project's issue types and where they sit in Jira's hierarchy (Epic 1, Task 0, Subtask -1), so a new parent gets a type Jira accepts.
      Promise.all(
        projects.map(
          async (key) =>
            [
              key,
              (
                await jira<{ issueTypes: any[] }>(
                  `/rest/api/3/issue/createmeta/${encodeURIComponent(key)}/issuetypes`,
                ).catch(() => ({ issueTypes: [] }))
              ).issueTypes.map((t) => ({ name: t.name, hierarchyLevel: t.hierarchyLevel })),
            ] as const,
        ),
      ),
    ]);
    return {
      priorities: priorities.map((p) => ({ id: p.id, name: p.name })),
      users: users.filter((u) => u.accountType === "atlassian" && u.active !== false).map(jiraUser),
      labels,
      versions: Object.fromEntries(versions),
      types: Object.fromEntries(types),
    };
  })();
  optionCache = {
    at: Date.now(),
    value: value.catch((e) => {
      optionCache = undefined;
      throw e;
    }),
  };
  return optionCache.value;
}
