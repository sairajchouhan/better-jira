import { viewRepository } from "./view-repository";
import { Database } from "bun:sqlite";
import { jira, JiraError } from "./jira";
import { boardFromInput, withoutAddedBoard } from "./config";
import { detailCache } from "./detail-cache";
import { historyCache, readHistory } from "./issue-history";
import { recentlyTouched, storeRemoteLinks } from "./remote-links";
import { attachmentGateway, jiraAttachmentReader } from "@/shared/attachment-media";
import { saveAddedBoard, serverAuth } from "./server-config";
import { threadParent } from "@/shared/jira-ops";
import { statusDates, type History } from "@/shared/issue-properties";
import {
  issueProjection,
  SLIM_VERSION,
  type IssueProjection,
  jiraUser,
  propertyEntries,
  remoteLinkUrls,
  watcherList,
  type PropertyRow,
} from "./issue-projection";
import { serverConfiguration } from "./server-config";
import { unseenChanged } from "./notifications";
import { writeLedger } from "./write-ledger";
import { avatarProxy } from "@/shared/avatar-proxy";

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
const FULL_SYNC_EVERY_MS = 6 * 3600_000; // full sync also sweeps out issues that left a board
const PAGE = 100;
const PARALLEL = 4;

const db = new Database(configuration.cachePath, { create: true, strict: true });
export const views = viewRepository(db);
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
export const ledger = writeLedger(db);
db.run(
  "CREATE TABLE IF NOT EXISTS avatars (url TEXT PRIMARY KEY, type TEXT NOT NULL, body BLOB NOT NULL, at INTEGER NOT NULL)",
);
/** Avatar images, at most 512KB each; the newest 2,000 are kept. */
export const avatar = avatarProxy({
  site: configuration.site,
  auth: serverAuth(),
  cache: {
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
  },
});

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
      slim: JSON.stringify(projection.slim(i, board)),
      full: JSON.stringify(i),
    });
  }
  return changed;
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

type Client = { issue?: string; send: (kind?: "changed" | "inbox" | "boards") => void };
const live = (g.live ??= { clients: new Set(), wake: () => {} });
/** An open, visible tab, and the issue it shows. Jira is polled fast while one is connected; the first one syncs at once. Returns the disconnect. */
export function watch(client: Client) {
  live.clients.add(client);
  live.wake();
  return () => void live.clients.delete(client);
}
/** Tells every open tab the mirror changed, so it refetches now instead of on its timer. */
const notify = (kind?: "inbox" | "boards") => {
  for (const client of live.clients) client.send(kind);
};

async function loop() {
  for (;;) {
    const changed = await Promise.all(
      BOARDS.map((b) =>
        syncBoard(b).catch((e) => (console.error(`[sync] board ${b}:`, e.message), false)),
      ),
    );
    if (changed.includes(true)) notify();
    if (live.clients.size)
      void unseenChanged().then(
        (moved) => moved && notify("inbox"),
        (e) => console.error("[inbox]", String(e).slice(0, 200)),
      );
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
        const [{ fields }, remote] = await Promise.all([
          jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=updated`),
          jira<any[]>(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`),
        ]);
        if (
          storeRemoteLinks(
            db,
            key,
            remoteLinkUrls(remote),
          )
        ) {
          db.query("DELETE FROM issue_details WHERE key = ?").run(key); // the panel's web links too
          changed = true;
        }
        if (fields.updated === row.updated) continue;
        save(
          row.board,
          [await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${projection.fields}`)],
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
        .query<{ key: string; board: number; full: string }, []>(
          "SELECT key, board, full FROM issues",
        )
        .all();
      const update = db.query("UPDATE issues SET slim = ? WHERE key = ?");
      for (const row of rows)
        update.run(JSON.stringify(projection.slim(JSON.parse(row.full), row.board)), row.key);
      setMeta("slim-version", SLIM_VERSION);
    })();
  }
  if (!g.syncing) {
    g.syncing = true;
    loop();
    watchOpenIssues();
  }
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
    await fullSync(id);
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

/** Removes a board added in the app from this site's sidebar (BJ-24). Setup's boards stay; cached rows stay, unread. */
export async function removeBoard(id: number) {
  if (!BOARDS.includes(id) || configuration.setupBoards.includes(id))
    throw new Error("Only a board added in the app can be removed.");
  await saveAddedBoard(id, withoutAddedBoard);
  BOARDS.splice(BOARDS.indexOf(id), 1);
  notify("boards");
}

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
      detail.remotelinks.map((l: { url: string }) => l.url),
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
export const issue = details.read;
/** The issue's whole Jira changelog for its Activity, read apart from the details so it never holds up their first paint. */
export const history = historyCache(
  db,
  (key) => readHistory(jira, key),
  (key) =>
    db
      .query<{ updated: string }, [string]>(
        "SELECT json_extract(slim,'$.updated') AS updated FROM issues WHERE key = ?",
      )
      .get(key)?.updated,
);
/** Re-read one issue from Jira after a write, so reads and the next client poll see Jira's truth. Null when it no longer exists. */
export async function refresh(
  key: string,
  board?: number,
): Promise<{ issue: any; full: any } | null> {
  const row = db
    .query<{ board: number }, [string]>("SELECT board FROM issues WHERE key = ?")
    .get(key);
  // Watchers are read alongside, so a write settles in two Jira round trips, not four (R2-create-D2).
  const watching = jira(`/rest/api/3/issue/${encodeURIComponent(key)}/watchers`);
  watching.catch(() => {});
  let raw: any;
  try {
    raw = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${projection.fields}`);
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
  const [full, w] = await Promise.all([details.read(raw.key, true), watching]),
    issue = projection.slim(raw, target);
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
          lead: u ? jiraUser(u) : null,
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
  const recent = recentlyTouched(db);
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
              data.remoteLinks = remoteLinkUrls(
                await jira<any[]>(`/rest/api/3/issue/${encodeURIComponent(row.key)}/remotelink`, {
                  signal: AbortSignal.timeout(30000),
                }),
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

export const properties = () =>
  propertyEntries(
    db
      .query<PropertyRow, []>(
        `SELECT i.key,i.slim,p.data,p.source_updated FROM issues i LEFT JOIN issue_properties p ON p.key=i.key WHERE i.board IN (${BOARDS.join(",")})`,
      )
      .all(),
    (key) => JSON.parse(getMeta(`project-info:${key}`) ?? "null"),
    propertyProgress.pending,
  );

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
    const projects = db
      .query<{ key: string }, []>(
        "SELECT DISTINCT json_extract(slim,'$.project.key') AS key FROM issues",
      )
      .all()
      .map((r) => r.key)
      .filter(Boolean);
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
