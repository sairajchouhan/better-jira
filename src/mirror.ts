import { Database } from "bun:sqlite";
import { jira } from "./jira";
import { pullRequestCount, statusDates, type History } from "./issue-properties";

export const BOARDS = [4142, 1344];
const FIELDS =
  "summary,status,issuetype,priority,assignee,reporter,creator,created,updated,resolutiondate,duedate,project,issuelinks,labels,parent,description,comment,fixVersions,watches,customfield_10000,customfield_10022,customfield_10023,customfield_10016";
const POLL_MS = 15_000;
const FULL_SYNC_EVERY_MS = 6 * 3600_000; // full sync also sweeps out issues that left a board
const PAGE = 100;
const PARALLEL = 4;

const db = new Database("cache.db", { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS issues (
  key TEXT PRIMARY KEY, board INTEGER NOT NULL, seen INTEGER NOT NULL, slim TEXT NOT NULL, full TEXT NOT NULL)`);
db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
db.run("CREATE TABLE IF NOT EXISTS issue_properties (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, synced INTEGER NOT NULL, data TEXT NOT NULL)");

const getMeta = (k: string) => db.query<{ v: string }, [string]>("SELECT v FROM meta WHERE k = ?").get(k)?.v;
const setMeta = (k: string, v: string) => db.query("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(k, v);
const upsert = db.query(
  "INSERT OR REPLACE INTO issues (key, board, seen, slim, full) VALUES ($key, $board, $seen, $slim, $full)",
);

/** What the board and search need for every issue; description and comments stay in `full`. */
function slim(i: any, board: number) {
  const f = i.fields;
  const text = (n: any): string => typeof n === "string" ? n : [n?.text ?? "", ...(n?.content ?? []).map(text)].join(" ");
  const user = (u: any) => u ? {id:u.accountId,name:u.displayName,avatar:u.avatarUrls?.["24x24"]} : null;
  const links = new Set<string>();
  const collectLinks = (n: any) => {
    for (const m of n?.marks ?? []) if (m.type === "link" && m.attrs?.href) links.add(m.attrs.href);
    if (n?.type === "inlineCard" && n.attrs?.url) links.add(n.attrs.url);
    for (const child of n?.content ?? []) collectLinks(child);
  };
  collectLinks(f.description);
  for(const url of text(f.description).match(/https?:\/\/[^\s<>"\])]+/g)??[])links.add(url);
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
    created: f.created,
    creator: user(f.creator ?? f.reporter),
    due: f.duedate ?? null,
    project: f.project ? {key:f.project.key,name:f.project.name} : {key:i.key.split("-")[0],name:i.key.split("-")[0]},
    description: text(f.description),
    milestones: f.fixVersions?.map((v: any) => ({id:v.id,name:v.name})),
    prCount: pullRequestCount(f.customfield_10000),
    estimate: typeof f.customfield_10023 === "number"?f.customfield_10023:typeof f.customfield_10016 === "number"?f.customfield_10016:undefined,
    links: [...links],
    relations: (f.issuelinks ?? []).map((r: any) => ({
      key: (r.outwardIssue ?? r.inwardIssue)?.key,
      kind: /block/i.test(r.type?.name ?? "") ? r.outwardIssue ? "blocking" : "blocked" : /duplicat/i.test(r.type?.name ?? "") ? "duplicate" : "related",
    })).filter((r: any)=>r.key),
  };
}

const save = db.transaction((board: number, issues: any[], seen: number) => {
  for (const i of issues)
    upsert.run({ key: i.key, board, seen, slim: JSON.stringify(slim(i, board)), full: JSON.stringify(i) });
});

// Expand existing cached rows immediately; a subsequent full sync fetches newly requested fields.
if (getMeta("slim-version") !== "6") {
  db.transaction(() => {
    const rows = db.query<{key:string;board:number;full:string},[]>("SELECT key, board, full FROM issues").all();
    const update = db.query("UPDATE issues SET slim = ? WHERE key = ?");
    for (const row of rows) update.run(JSON.stringify(slim(JSON.parse(row.full),row.board)),row.key);
    setMeta("slim-version","6");
  })();
}

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
  setMeta(`fields:${board}`, "4");
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
  if (getMeta(`fields:${board}`) !== "4" || Date.now() - lastFull > FULL_SYNC_EVERY_MS) return void (await fullSync(board));
  const keys = await incrementalSync(board);
  if (keys.length) console.log(`[sync] board ${board}: ${keys.join(" ")}`);
}

async function loop() {
  for (;;) {
    await Promise.all(BOARDS.map((b) => syncBoard(b).catch((e) => console.error(`[sync] board ${b}:`, e.message))));
    await enrichProjects();
    void enrichProperties().catch(e=>console.error("[properties]",String(e).slice(0,200)));
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

export const viewDefaults = () => Object.fromEntries(BOARDS.flatMap(id => {
  const value = getMeta(`view-default:${id}`);
  return value ? [[id, JSON.parse(value)]] : [];
}));
export const saveViewDefault = (id: number, display: object) => setMeta(`view-default:${id}`,JSON.stringify(display));

let enriching = false;
let propertyProgress = {pending:0,completed:0,errors:0};

async function enrichProjects() {
  const projects=db.query<{key:string},[]>("SELECT DISTINCT json_extract(slim,'$.project.key') AS key FROM issues").all();
  for(const {key} of projects) {
    if(!key)continue;
    const saved=getMeta(`project-info:${key}`);
    if(saved&&Date.now()-JSON.parse(saved).synced<FULL_SYNC_EVERY_MS)continue;
    try {
      const project=await jira(`/rest/api/3/project/${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(30000)});
      const u=project.lead;
      setMeta(`project-info:${key}`,JSON.stringify({synced:Date.now(),lead:u?{id:u.accountId,name:u.displayName,avatar:u.avatarUrls?.["24x24"]}:null}));
    }catch(e){console.error(`[properties] project ${key}:`,String(e).slice(0,200));}
  }
}

/** Extra reads never sit on the board's request path. Cache them across process restarts. */
async function enrichProperties() {
  if (enriching) return;
  const rows = db.query<{key:string;full:string;slim:string},[number,number]>(`SELECT i.key,i.full,i.slim FROM issues i LEFT JOIN issue_properties p ON p.key=i.key
    WHERE p.key IS NULL OR p.source_updated != json_extract(i.slim,'$.updated') OR p.synced < ?
      OR (json_array_length(p.data,'$.errors') > 0 AND p.synced < ?)`).all(Date.now()-FULL_SYNC_EVERY_MS,Date.now()-15*60000);
  if (!rows.length) return;
  enriching=true;
  propertyProgress={pending:rows.length,completed:0,errors:0};
  const byStatus = new Map(boards().flatMap((b:any)=>b.columns.flatMap((c:any)=>c.statuses.map((s:any)=>[s.id,s.category]))));
  try {
    for(let offset=0;offset<rows.length;offset+=500) {
      const batch=rows.slice(offset,offset+500).map(r=>({...r,raw:JSON.parse(r.full),issue:JSON.parse(r.slim)}));
      const histories=new Map<string,History[]>();
      let historyError=false;
      try {
        let nextPageToken: string | undefined;
        do {
          // POST is Jira's documented bulk READ endpoint. It changes no issues.
          const page=await jira("/rest/api/3/changelog/bulkfetch",{method:"POST",signal:AbortSignal.timeout(30000),body:JSON.stringify({issueIdsOrKeys:batch.map(r=>r.key),fieldIds:["status"],maxResults:1000,...(nextPageToken?{nextPageToken}:{})})});
          for(const entry of page.issueChangeLogs??[])histories.set(entry.issueId,[...(histories.get(entry.issueId)??[]),...entry.changeHistories]);
          nextPageToken=page.nextPageToken;
        } while(nextPageToken);
      } catch(e) { historyError=true; console.error("[properties] status history:",String(e).slice(0,200)); }
      const queue=[...batch];
      await Promise.all(Array.from({length:4},async()=>{
        for(let row;(row=queue.shift());) {
          const errors:string[]=[];
          const data:any={status:row.issue.status};
          if(historyError)errors.push("Status history unavailable");
          else Object.assign(data,statusDates(row.raw.fields.created,row.issue.status,histories.get(row.raw.id)??[],id=>byStatus.get(id) as string|undefined));
          try {
            const watches=row.raw.fields.watches;
            const w=watches?.watchCount===0?{watchCount:0,watchers:[]}:await jira(`/rest/api/3/issue/${encodeURIComponent(row.key)}/watchers`,{signal:AbortSignal.timeout(30000)});
            data.watchers=(w.watchers??[]).map((u:any)=>({id:u.accountId,name:u.displayName,avatar:u.avatarUrls?.["24x24"]}));
            data.watchersComplete=data.watchers.length===w.watchCount;
            if(!data.watchersComplete)errors.push("Watcher list restricted by Jira permissions");
          }catch { data.watchersComplete=false;errors.push("Watcher list unavailable"); }
          if(errors.length) {data.errors=errors;propertyProgress.errors++;}
          db.query("INSERT OR REPLACE INTO issue_properties VALUES (?,?,?,?)").run(row.key,row.issue.updated,Date.now(),JSON.stringify(data));
          propertyProgress.completed++;propertyProgress.pending--;
        }
      }));
    }
  }finally {enriching=false;}
}

export function properties() {
  const rows=db.query<{key:string;slim:string;data:string|null;source_updated:string|null},[]>("SELECT i.key,i.slim,p.data,p.source_updated FROM issues i LEFT JOIN issue_properties p ON p.key=i.key").all();
  let missing=0,errors=0;
  const projects=new Map<string,any>();
  const entries=Object.fromEntries(rows.map(r=>{
    const slim=JSON.parse(r.slim);
    const projectKey=slim.project?.key;
    if(projectKey&&!projects.has(projectKey))projects.set(projectKey,JSON.parse(getMeta(`project-info:${projectKey}`)??"null"));
    const fresh=r.source_updated===slim.updated;
    if(!fresh)missing++;
    const data=fresh&&r.data?JSON.parse(r.data):{};
    if(data.errors?.length)errors++;
    return [r.key,{milestones:slim.milestones,prCount:slim.prCount,estimate:slim.estimate,projectLead:projects.get(projectKey)?.lead,...data}];
  }));
  const pending=Math.max(propertyProgress.pending,missing);
  return {progress:{total:rows.length,pending,completed:rows.length-missing,errors},entries};
}
