import { Database } from "bun:sqlite";
import { jira } from "./jira";

export const BOARDS = [4142, 1344];
const FIELDS =
  "summary,status,issuetype,priority,assignee,reporter,created,updated,resolutiondate,labels,parent,description,comment,customfield_10022";
const POLL_MS = 15_000;
const FULL_SYNC_EVERY_MS = 6 * 3600_000; // full sync also sweeps out issues that left a board
const PAGE = 100;
const PARALLEL = 4;

const db = new Database("cache.db", { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS issues (
  key TEXT PRIMARY KEY, board INTEGER NOT NULL, seen INTEGER NOT NULL, slim TEXT NOT NULL, full TEXT NOT NULL)`);
db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");

const getMeta = (k: string) => db.query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(k)?.v;
const setMeta = (k: string, v: string) => db.query("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(k, v);
const upsert = db.query(
  "INSERT OR REPLACE INTO issues (key, board, seen, slim, full) VALUES ($key, $board, $seen, $slim, $full)",
);

/** What the board and search need for every issue; description and comments stay in `full`. */
function slim(i: any, board: number) {
  const f = i.fields;
  return {
    key: i.key,
    board,
    summary: f.summary,
    status: f.status.id,
    type: f.issuetype?.name,
    typeIcon: f.issuetype?.iconUrl,
    priority: f.priority?.name,
    assignee: f.assignee && { id: f.assignee.accountId, name: f.assignee.displayName, avatar: f.assignee.avatarUrls?.["24x24"] },
    labels: f.labels,
    parent: f.parent?.key,
    rank: f.customfield_10022,
    comments: f.comment?.total ?? 0,
    updated: f.updated,
    resolved: f.resolutiondate,
  };
}

const save = db.transaction((board: number, issues: any[], seen: number) => {
  for (const i of issues)
    upsert.run({ key: i.key, board, seen, slim: JSON.stringify(slim(i, board)), full: JSON.stringify(i) });
});

const page = (board: number, jql: string, startAt: number) =>
  jira(`/rest/agile/1.0/board/${board}/issue?` +
    new URLSearchParams({ jql, fields: FIELDS, startAt: String(startAt), maxResults: String(PAGE) }));

async function fullSync(board: number) {
  const t0 = Date.now();
  const jql = "ORDER BY key ASC"; // stable order so parallel startAt pages don't skip issues
  const first = await page(board, jql, 0);
  save(board, first.issues, t0);
  const starts: number[] = [];
  for (let s = PAGE; s < first.total; s += PAGE) starts.push(s);
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let s; (s = starts.shift()) !== undefined; ) save(board, (await page(board, jql, s)).issues, t0);
  }));
  const gone = db.query("DELETE FROM issues WHERE board = ? AND seen < ?").run(board, t0).changes;
  // The board config lists status ids only; names and categories come from the status list.
  const [config, statuses] = await Promise.all([
    jira(`/rest/agile/1.0/board/${board}/configuration`),
    jira<any[]>("/rest/api/3/status"),
  ]);
  const byId = new Map(statuses.map((s) => [s.id, { id: s.id, name: s.name, category: s.statusCategory.key }]));
  const columns = config.columnConfig.columns.map((c: any) => ({
    name: c.name,
    statuses: c.statuses.map((s: any) => byId.get(s.id) ?? { id: s.id, name: s.id, category: "indeterminate" }),
  }));
  setMeta(`config:${board}`, JSON.stringify({ id: board, name: config.name, columns }));
  setMeta(`full:${board}`, String(t0));
  setMeta(`inc:${board}`, String(t0));
  console.log(`[sync] board ${board}: full, ${first.total} issues, ${gone} removed, ${Date.now() - t0}ms`);
}

/** Fetch issues updated since the last sync. Returns the changed keys. */
async function incrementalSync(board: number): Promise<string[]> {
  const t0 = Date.now();
  const since = Number(getMeta(`inc:${board}`));
  // Relative minutes avoid JQL's profile-timezone date parsing; +1 minute of overlap.
  const jql = `updated >= -${Math.ceil((t0 - since) / 60_000) + 1}m ORDER BY key ASC`;
  const keys: string[] = [];
  for (let s = 0, total = 1; s < total; s += PAGE) {
    const p = await page(board, jql, s);
    total = p.total;
    save(board, p.issues, t0);
    keys.push(...p.issues.map((i: any) => i.key));
  }
  setMeta(`inc:${board}`, String(t0));
  return keys;
}

async function syncBoard(board: number) {
  const lastFull = Number(getMeta(`full:${board}`) ?? 0);
  if (Date.now() - lastFull > FULL_SYNC_EVERY_MS) return void (await fullSync(board));
  const keys = await incrementalSync(board);
  if (keys.length) console.log(`[sync] board ${board}: ${keys.join(" ")}`);
}

async function loop() {
  for (;;) {
    await Promise.all(BOARDS.map((b) => syncBoard(b).catch((e) => console.error(`[sync] board ${b}:`, e.message))));
    await Bun.sleep(POLL_MS);
  }
}

// `bun --hot` re-runs this module on every edit; start the loop only once per process.
const g = globalThis as { syncing?: boolean };
if (!g.syncing) {
  g.syncing = true;
  loop();
}

// --- reads (the UI only ever reads from here) ---

export const boards = () => BOARDS.map((b) => JSON.parse(getMeta(`config:${b}`) ?? "null")).filter(Boolean);

/** All issues on both boards, slim. ~3k rows, ~1MB: the UI keeps them all in memory for instant search. */
export const issues = () =>
  `[${db.query<{ slim: string }, []>("SELECT slim FROM issues").all().map((r) => r.slim).join(",")}]`;

export const issue = (key: string) =>
  db.query<{ full: string }, [string]>("SELECT full FROM issues WHERE key = ?").get(key)?.full;
