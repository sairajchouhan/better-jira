import type {Database} from "bun:sqlite";
export const DETAIL_CACHE_VERSION="3";

/** Rich issue details have their own schema version; Jira's updated timestamp cannot invalidate old projections. */
export function detailCache(db:Database,load:(key:string)=>Promise<any>) {
  db.run("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS issue_details (key TEXT PRIMARY KEY, source_updated TEXT NOT NULL, data TEXT NOT NULL)");
  db.transaction(()=>{
    const version=db.query<{v:string},[]>("SELECT v FROM meta WHERE k = 'details-version'").get()?.v;
    if(version!==DETAIL_CACHE_VERSION){
      db.run("DELETE FROM issue_details");
      db.query("INSERT OR REPLACE INTO meta VALUES ('details-version', ?)").run(DETAIL_CACHE_VERSION);
    }
  })();
  const pending=new Map<string,Promise<string|undefined>>();
  const parsed=new Map<string,{updated:string;value:any}>();
  async function readDetails(key:string) {
    const base=db.query<{full:string;slim:string},[string]>("SELECT full,slim FROM issues WHERE key = ?").get(key);
    if(!base)return;
    const updated=JSON.parse(base.slim).updated;
    const cached=db.query<{source_updated:string;data:string},[string]>("SELECT source_updated,data FROM issue_details WHERE key = ?").get(key);
    if(cached&&cached.source_updated===updated)return cached.data;
    const detail=await load(key),original=JSON.parse(base.full);
    const data=JSON.stringify({...original,...detail,fields:{...original.fields,...detail.fields}});
    db.query("INSERT OR REPLACE INTO issue_details VALUES (?,?,?)").run(key,updated,data);
    parsed.delete(key);return data;
  }
  /** `fresh` waits out a read already in flight (it may predate a write) and reads again. */
  function read(key:string,fresh=false):Promise<string|undefined> {
    const existing=pending.get(key);if(existing&&!fresh)return existing;
    const request=(existing?existing.catch(()=>undefined).then(()=>readDetails(key)):readDetails(key)).finally(()=>{if(pending.get(key)===request)pending.delete(key);});
    pending.set(key,request);return request;
  }
  async function readParsed(key:string):Promise<any|undefined> {
    const revision=db.query<{updated:string},[string]>("SELECT json_extract(slim,'$.updated') AS updated FROM issues WHERE key = ?").get(key);
    if(!revision){parsed.delete(key);return;}
    const cached=parsed.get(key);if(cached?.updated===revision.updated){parsed.delete(key);parsed.set(key,cached);return cached.value;}
    const raw=await read(key);if(!raw)return;
    const value=JSON.parse(raw);parsed.set(key,{updated:revision.updated,value});
    if(parsed.size>32)parsed.delete(parsed.keys().next().value!);
    return value;
  }
  return {read,readParsed};
}
