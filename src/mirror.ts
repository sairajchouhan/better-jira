import { Database } from "bun:sqlite";
import { jira } from "./jira";
import { detailCache } from "./detail-cache";
import { issueAttachments, attachmentGateway, jiraAttachmentReader } from "./attachment-media";
import { serverAuth } from "./server-config";
import { THREAD_PROPERTY } from "./jira-ops";
import { pullRequestCount, statusDates, type History } from "./issue-properties";
import { serverConfiguration } from "./server-config";

const configuration = serverConfiguration();
export const BOARDS = configuration.boards;
// Custom field IDs differ per site; resolve rank and story points by type and name.
const siteFields = await jira<any[]>("/rest/api/3/field").catch(() => null);
export const RANK =
  siteFields?.find((f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-lexo-rank")?.id ??
  "customfield_10022";
export const ESTIMATES: string[] = siteFields
  ? siteFields
      .filter((f) => /^story points?( estimate)?$/i.test(f.name))
      .sort((a, b) => a.name.length - b.name.length)
      .map((f) => f.id)
  : ["customfield_10023", "customfield_10016"];
const FIELDS = [
  "summary,status,issuetype,priority,assignee,reporter,creator,created,updated,resolutiondate,duedate,project,issuelinks,labels,parent,description,comment,fixVersions,watches,attachment,customfield_10000",
  RANK,
  ...ESTIMATES,
].join(",");
const ACTIVE_POLL_MS = 5_000; // a tab is open and visible
const IDLE_POLL_MS = 60_000; // no tab open: keep the mirror warm
const OPEN_ISSUE_POLL_MS = 3_000;
const PROBE_MS = 30_000; // the deleted-issue count check
const FULL_SYNC_EVERY_MS = 6 * 3600_000; // full sync also sweeps out issues that left a board
const PAGE = 100;
const PARALLEL = 4;

const db = new Database(configuration.cachePath, { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS issues (
  key TEXT PRIMARY KEY, board INTEGER NOT NULL, seen INTEGER NOT NULL, slim TEXT NOT NULL, full TEXT NOT NULL)`);
db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
db.run(
  "CREATE TABLE IF NOT EXISTS issue_properties (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, synced INTEGER NOT NULL, data TEXT NOT NULL)",
);
db.run(
  "CREATE TABLE IF NOT EXISTS issue_details (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, data TEXT NOT NULL)",
);

db.run("CREATE TABLE IF NOT EXISTS attachment_media (id TEXT PRIMARY KEY, media_id TEXT NOT NULL)");

const getMeta = (k: string) =>
  db.query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(k)?.v;
const setMeta = (k: string, v: string) =>
  db.query("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(k, v);
const source = JSON.stringify({ site: configuration.site, email: configuration.email });
if (getMeta("source") && getMeta("source") !== source)
  throw new Error(
    "This cache belongs to another Jira site or account. Choose a different JIRA_CACHE or rerun setup.",
  );
setMeta("source", source);
const upsert = db.query(
  // A poll page fetched before a write must not replace the newer row the write's refresh saved; `seen` still advances so sweeps keep it.
  `INSERT INTO issues (key, board, seen, slim, full) VALUES ($key, $board, $seen, $slim, $full)
   ON CONFLICT(key) DO UPDATE SET board=excluded.board, seen=excluded.seen,
     slim=CASE WHEN COALESCE(json_extract(excluded.slim,'$.updated'),'')>=COALESCE(json_extract(issues.slim,'$.updated'),'') THEN excluded.slim ELSE issues.slim END,
     full=CASE WHEN COALESCE(json_extract(excluded.slim,'$.updated'),'')>=COALESCE(json_extract(issues.slim,'$.updated'),'') THEN excluded.full ELSE issues.full END`,
);

/** What the board and search need for every issue; description and comments stay in `full`. */
function slim(i: any, board: number) {
  const f = i.fields;
  const text = (n: any): string =>
    typeof n === "string" ? n : [n?.text ?? "", ...(n?.content ?? []).map(text)].join(" ");
  const user = (u: any) =>
    u ? { id: u.accountId, name: u.displayName, avatar: u.avatarUrls?.["24x24"] } : null;
  const links = new Set<string>();
  const collectLinks = (n: any) => {
    for (const m of n?.marks ?? []) if (m.type === "link" && m.attrs?.href) links.add(m.attrs.href);
    if (n?.type === "inlineCard" && n.attrs?.url) links.add(n.attrs.url);
    for (const child of n?.content ?? []) collectLinks(child);
  };
  collectLinks(f.description);
  for (const url of text(f.description).match(/https?:\/\/[^\s<>"\])]+/g) ?? []) links.add(url);
  return {
    key: i.key,
    board,
    summary: f.summary,
    status: f.status.id,
    type: f.issuetype?.name,
    typeIcon: f.issuetype?.iconUrl,
    priority: f.priority?.name,
    assignee: f.assignee && {
      id: f.assignee.accountId,
      name: f.assignee.displayName,
      avatar: f.assignee.avatarUrls?.["24x24"],
    },
    labels: f.labels,
    attachments: issueAttachments(i),
    parent: f.parent?.key,
    rank: f[RANK],
    comments: f.comment?.total ?? 0,
    updated: f.updated,
    resolved: f.resolutiondate,
    created: f.created,
    creator: user(f.creator ?? f.reporter),
    due: f.duedate ?? null,
    project: f.project
      ? { key: f.project.key, name: f.project.name }
      : { key: i.key.split("-")[0], name: i.key.split("-")[0] },
    description: text(f.description),
    milestones: f.fixVersions?.map((v: any) => ({ id: v.id, name: v.name })),
    prCount: pullRequestCount(f.customfield_10000),
    estimate: ESTIMATES.map((id) => f[id]).find((v) => typeof v === "number"),
    links: [...links],
    relations: (f.issuelinks ?? [])
      .map((r: any) => ({
        key: (r.outwardIssue ?? r.inwardIssue)?.key,
        kind: /block/i.test(r.type?.name ?? "")
          ? r.outwardIssue
            ? "blocking"
            : "blocked"
          : /duplicat/i.test(r.type?.name ?? "")
            ? r.outwardIssue
              ? "duplicate"
              : "duplicated"
            : "related",
      }))
      .filter((r: any) => r.key),
  };
}

const updatedOf = db.query<{ updated: string }, [string]>(
  "SELECT json_extract(slim,'$.updated') AS updated FROM issues WHERE key = ?",
);
/** Returns the keys Jira changed since the mirror last saw them. */
const save = db.transaction((board: number, issues: any[], seen: number) => {
  const changed: string[] = [];
  for (const i of issues) {
    // Jira's search index can lag behind a newer copy saved from an issue read; the upsert keeps the newer one, so that is no change.
    if ((updatedOf.get(i.key)?.updated ?? "") < i.fields.updated) changed.push(i.key);
    upsert.run({
      key: i.key,
      board,
      seen,
      slim: JSON.stringify(slim(i, board)),
      full: JSON.stringify(i),
    });
  }
  return changed;
});

// Expand existing cached rows immediately; a subsequent full sync fetches newly requested fields.
if (getMeta("slim-version") !== "6") {
  db.transaction(() => {
    const rows = db
      .query<{ key: string; board: number; full: string }, []>(
        "SELECT key, board, full FROM issues",
      )
      .all();
    const update = db.query("UPDATE issues SET slim = ? WHERE key = ?");
    for (const row of rows)
      update.run(JSON.stringify(slim(JSON.parse(row.full), row.board)), row.key);
    setMeta("slim-version", "6");
  })();
}

const page = (board: number, jql: string, startAt: number) =>
  jira(
    `/rest/agile/1.0/board/${board}/issue?` +
      new URLSearchParams({
        jql,
        fields: FIELDS,
        startAt: String(startAt),
        maxResults: String(PAGE),
      }),
  );

async function fullSync(board: number) {
  const t0 = Date.now();
  const jql = "ORDER BY key ASC"; // stable order so parallel startAt pages don't skip issues
  const first = await page(board, jql, 0);
  save(board, first.issues, t0);
  const starts: number[] = [];
  for (let s = PAGE; s < first.total; s += PAGE) starts.push(s);
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let s; (s = starts.shift()) !== undefined;)
        save(board, (await page(board, jql, s)).issues, t0);
    }),
  );
  const gone = db.query("DELETE FROM issues WHERE board = ? AND seen < ?").run(board, t0).changes;
  // The board config lists status ids only; names and categories come from the status list.
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
  setMeta(`config:${board}`, JSON.stringify({ id: board, name: config.name, columns }));
  setMeta(`full:${board}`, String(t0));
  setMeta(`inc:${board}`, String(t0));
  setMeta(`fields:${board}`, "4");
  console.log(
    `[sync] board ${board}: full, ${first.total} issues, ${gone} removed, ${Date.now() - t0}ms`,
  );
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

const probed = new Map<number, number>();
/** Returns whether the mirror changed. */
async function syncBoard(board: number) {
  const lastFull = Number(getMeta(`full:${board}`) ?? 0);
  if (getMeta(`fields:${board}`) !== "4" || Date.now() - lastFull > FULL_SYNC_EVERY_MS)
    return (await fullSync(board), true);
  const keys = await incrementalSync(board);
  if (keys.length) console.log(`[sync] board ${board}: ${keys.join(" ")}`);
  if (Date.now() - (probed.get(board) ?? 0) < PROBE_MS) return keys.length > 0;
  probed.set(board, Date.now());
  // Jira has no feed of deleted issues. A board holding fewer issues than the mirror lost some (deleted or moved off it): resync it.
  const { total } = await jira<{ total: number }>(
    `/rest/agile/1.0/board/${board}/issue?maxResults=1&fields=key`,
  );
  const mirrored = db
    .query<{ n: number }, [number]>("SELECT count(*) AS n FROM issues WHERE board = ?")
    .get(board)!.n;
  if (total < mirrored) return (await fullSync(board), true);
  return keys.length > 0;
}

// `bun --hot` re-runs this module on every edit; the loops and the open tabs live on globalThis so they survive it.
const g = globalThis as { syncing?: boolean; live?: { clients: Set<Client>; wake: () => void } };
type Client = { issue?: string; send: () => void };
const live = (g.live ??= { clients: new Set(), wake: () => {} });
/** An open, visible tab, and the issue it shows. Jira is polled fast while one is connected; the first one syncs at once. Returns the disconnect. */
export function watch(client: Client) {
  live.clients.add(client);
  live.wake();
  return () => void live.clients.delete(client);
}
/** Tells every open tab the mirror changed, so it refetches now instead of on its timer. */
const notify = () => {
  for (const client of live.clients) client.send();
};

async function loop() {
  for (;;) {
    const changed = await Promise.all(
      BOARDS.map((b) =>
        syncBoard(b).catch((e) => (console.error(`[sync] board ${b}:`, e.message), false)),
      ),
    );
    if (changed.includes(true)) notify();
    await enrichProjects();
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
      const row = db
        .query<{ board: number; updated: string }, [string]>(
          "SELECT board, json_extract(slim,'$.updated') AS updated FROM issues WHERE key = ?",
        )
        .get(key);
      if (!row) continue;
      try {
        const { fields } = await jira(
          `/rest/api/3/issue/${encodeURIComponent(key)}?fields=updated`,
        );
        if (fields.updated === row.updated) continue;
        save(
          row.board,
          [await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`)],
          Date.now(),
        );
        console.log(`[sync] open issue ${key}`);
        changed = true;
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          db.query("DELETE FROM issues WHERE key = ?").run(key);
          changed = true;
        } else console.error(`[sync] ${key}:`, String(error).slice(0, 200));
      }
    }
    if (changed) notify();
  }
}

if (!g.syncing) {
  g.syncing = true;
  loop();
  watchOpenIssues();
}

// --- reads (the UI only ever reads from here) ---

export const boards = () =>
  BOARDS.map((b) => JSON.parse(getMeta(`config:${b}`) ?? "null")).filter(Boolean);

/** All issues on both boards, slim. ~3k rows, ~1MB: the UI keeps them all in memory for instant search. */
export const issues = () =>
  // Rows of boards dropped from the config stay in the cache; the app only knows configured boards.
  `[${db
    .query<{ slim: string }, []>(`SELECT slim FROM issues WHERE board IN (${BOARDS.join(",")})`)
    .all()
    .map((r) => r.slim)
    .join(",")}]`;

const details = detailCache(db, async (key) => {
  // The Agile endpoint returns legacy strings. API v3 preserves Jira's rich ADF tree.
  const detail = await jira(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description,comment,reporter,created,updated,attachment`,
  );
  detail.fields.attachment ??= [];
  // Remote ("web") links someone added in Jira; the app shows them as link resources.
  detail.remotelinks = (
    await jira<any[]>(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`)
  ).flatMap((l) =>
    l.object?.url ? [{ url: l.object.url, title: l.object.title ?? l.object.url }] : [],
  );
  const comments = detail.fields.comment;
  if (comments?.total) {
    // The comment endpoint carries properties, where reply threads live (Jira comments are flat).
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
      comments: complete.map(({ properties, ...c }) => {
        const parentId = properties?.find((p: any) => p.key === THREAD_PROPERTY)?.value?.parentId;
        return typeof parentId === "string" ? { ...c, parentId } : c;
      }),
    };
  }
  return detail;
});
export const issue = details.read;
/** Re-read one issue from Jira after a write, so reads and the next client poll see Jira's truth. Null when it no longer exists. */
export async function refresh(
  key: string,
  board?: number,
): Promise<{ issue: any; full: any } | null> {
  const row = db
    .query<{ board: number }, [string]>("SELECT board FROM issues WHERE key = ?")
    .get(key);
  let raw: any;
  try {
    raw = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`);
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      db.query("DELETE FROM issues WHERE key = ?").run(key);
      return null;
    }
    throw error;
  }
  const target = board ?? row?.board ?? BOARDS[0]!;
  save(target, [raw], Date.now());
  db.query("DELETE FROM issue_details WHERE key = ?").run(raw.key);
  const full = await details.read(raw.key, true),
    issue = slim(raw, target);
  const w = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/watchers`);
  const watchers = (w.watchers ?? []).map((u: any) => ({
    id: u.accountId,
    name: u.displayName,
    avatar: u.avatarUrls?.["24x24"],
  }));
  const old = db
    .query<{ data: string; source_updated: string }, [string]>(
      "SELECT data,source_updated FROM issue_properties WHERE key = ?",
    )
    .get(key);
  const props = {
    ...(old ? JSON.parse(old.data) : {}),
    watchers,
    watchersComplete: watchers.length === w.watchCount,
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
    const profile = {
      id: user.accountId,
      name: user.displayName,
      avatar: user.avatarUrls?.["24x24"],
    };
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

async function enrichProjects() {
  const projects = db
    .query<{ key: string }, []>(
      "SELECT DISTINCT json_extract(slim,'$.project.key') AS key FROM issues",
    )
    .all();
  for (const { key } of projects) {
    if (!key) continue;
    const saved = getMeta(`project-info:${key}`);
    if (saved && Date.now() - JSON.parse(saved).synced < FULL_SYNC_EVERY_MS) continue;
    try {
      const project = await jira(`/rest/api/3/project/${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(30000),
      });
      const u = project.lead;
      setMeta(
        `project-info:${key}`,
        JSON.stringify({
          synced: Date.now(),
          lead: u
            ? { id: u.accountId, name: u.displayName, avatar: u.avatarUrls?.["24x24"] }
            : null,
        }),
      );
    } catch (e) {
      console.error(`[properties] project ${key}:`, String(e).slice(0, 200));
    }
  }
}

/** Extra reads never sit on the board's request path. Cache them across process restarts. */
async function enrichProperties() {
  if (enriching) return;
  const rows = db
    .query<{ key: string; full: string; slim: string }, [number, number]>(
      `SELECT i.key,i.full,i.slim FROM issues i LEFT JOIN issue_properties p ON p.key=i.key
    WHERE p.key IS NULL OR p.source_updated != json_extract(i.slim,'$.updated') OR p.synced < ?
      OR (json_array_length(p.data,'$.errors') > 0 AND p.synced < ?)`,
    )
    .all(Date.now() - FULL_SYNC_EVERY_MS, Date.now() - 15 * 60000);
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
              data.watchers = (w.watchers ?? []).map((u: any) => ({
                id: u.accountId,
                name: u.displayName,
                avatar: u.avatarUrls?.["24x24"],
              }));
              data.watchersComplete = data.watchers.length === w.watchCount;
              if (!data.watchersComplete)
                errors.push("Watcher list restricted by Jira permissions");
            } catch {
              data.watchersComplete = false;
              errors.push("Watcher list unavailable");
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

export function properties() {
  const rows = db
    .query<{ key: string; slim: string; data: string | null; source_updated: string | null }, []>(
      `SELECT i.key,i.slim,p.data,p.source_updated FROM issues i LEFT JOIN issue_properties p ON p.key=i.key WHERE i.board IN (${BOARDS.join(",")})`,
    )
    .all();
  let missing = 0,
    errors = 0;
  const projects = new Map<string, any>();
  const entries = Object.fromEntries(
    rows.map((r) => {
      const slim = JSON.parse(r.slim);
      const projectKey = slim.project?.key;
      if (projectKey && !projects.has(projectKey))
        projects.set(projectKey, JSON.parse(getMeta(`project-info:${projectKey}`) ?? "null"));
      const fresh = r.source_updated === slim.updated;
      if (!fresh) missing++;
      const data = fresh && r.data ? JSON.parse(r.data) : {};
      if (data.errors?.length) errors++;
      // The whole slim row rides along so edits made directly in Jira reach open clients.
      return [r.key, { ...slim, projectLead: projects.get(projectKey)?.lead, ...data }];
    }),
  );
  const pending = Math.max(propertyProgress.pending, missing);
  return {
    progress: { total: rows.length, pending, completed: rows.length - missing, errors },
    entries,
  };
}

/** Jira's choices for the property menus (priorities, assignable people, versions, labels). Cached for ten minutes. */
let optionCache: { at: number; value: Promise<any> } | undefined;
export function options() {
  if (optionCache && Date.now() - optionCache.at < 600_000) return optionCache.value;
  const value = (async () => {
    const projects = db
      .query<{ key: string }, []>(
        "SELECT DISTINCT json_extract(slim,'$.project.key') AS key FROM issues",
      )
      .all()
      .map((r) => r.key)
      .filter(Boolean);
    const user = (u: any) => ({
      id: u.accountId,
      name: u.displayName,
      avatar: u.avatarUrls?.["24x24"],
    });
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
      users: users.filter((u) => u.accountType === "atlassian" && u.active !== false).map(user),
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
