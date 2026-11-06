import { useSyncExternalStore } from "react";
import { adfToText, textToAdf } from "./adf";
import { defaultPreferences, parsePreferences, type Display, type Grouping, type Preferences } from "./view-model";
import { normalizeDocument, type AdfDocument } from "./document";
import { emptyLocalState,LocalDatabase,type LocalState,type Snapshot,type LocalEdit } from "./local-data";

export type User = { id: string; name: string; avatar?: string };
export type Issue = {
  key: string;
  board: number;
  summary: string;
  status: string;
  type?: string;
  priority?: string;
  assignee: User | null;
  labels: string[];
  parent?: string;
  rank?: string;
  comments: number;
  updated: string;
  resolved: string | null;
  created?: string;
  creator?: User | null;
  due?: string | null;
  project?: { key: string; name: string } | null;
  description?: string;
  links?: string[];
  relations?: { key: string; kind: string }[];
  milestones?: { id: string; name: string }[];
  prCount?: number;
  statusSince?: string;
  started?: string;
  watchers?: User[];
  watchersComplete?: boolean;
  estimate?: number;
  projectLead?: User | null;
  attachments?: {id:string;name:string;url:string;type:string;size:number;missing?:boolean}[];
  reactions?: string[];
  descriptionHistory?: {text:string;document?:AdfDocument;at:string}[];
};
export type Status = { id: string; name: string; category: string };
export type Column = { name: string; statuses: Status[] };
export type Board = { id: number; name: string; columns: Column[] };
/** Raw Jira issue: { key, fields: { description, comment, reporter, created, ... } } */
export type Full = { key: string; fields: any };
type Overlay = null | "palette" | "assign" | "status" | "create" | "priority" | "labels" | "project" | "milestone" | "due" | "options" | "relations";
export type IssueDraft = Partial<Pick<Issue,"status"|"assignee"|"priority"|"labels"|"project"|"milestones"|"due"|"parent"|"type"|"attachments">> & {description?:string;descriptionDoc?:AdfDocument};
export type View = "side" | "page";
export type SavedView={id:string;board:number;name:string;preferences:Preferences;mine:boolean};

export const ME: User = { id: "", name: "Me" };

type State = {
  boards: Board[];
  issues: Map<string, Issue>;
  full: Map<string, Full>;
  board: number;
  selected: string | null;
  panel: boolean;
  /** Open issues in a side panel or as a full page. */
  view: View;
  mine: boolean;
  query: string;
  overlay: Overlay;
  editDesc: boolean;
  perf: string;
  preferences: Record<number, Preferences>;
  defaults: Record<number, Display>;
  toolbar: "display" | "filter" | "advanced" | null;
  propertySync: {total:number;pending:number;completed:number;errors:number};
  clock: number;
  details: boolean;
  draft: IssueDraft;
  undoCount: number;
  redoCount: number;
  fullErrors: Map<string,string>;
  savedViews:SavedView[];
  favorites:string[];
  site:string;
  namespace:string;
  loadError:string;
  canEdit:boolean;
  storage:{status:"loading"|"saving"|"saved"|"error";message?:string;recovered?:boolean};
};

const PREF_KEY = "better-jira:views:v1";
let preferenceNamespace="";
const preferenceKey=(key:string)=>preferenceNamespace?`${key}:${preferenceNamespace}`:key;
function savedValue(key:string):string|null {try{return localStorage.getItem(preferenceKey(key));}catch{return null;}}
function readPreferences(): Record<number, Preferences> {
  try {
    const saved = JSON.parse(savedValue(PREF_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(saved).map(([id, p]) => [id, parsePreferences(p)]));
  } catch { return {}; }
}

let state: State = {
  boards: [],
  issues: new Map(),
  full: new Map(),
  board: Number(savedValue("board")) || 0,
  selected: null,
  panel: false,
  view: savedValue("view") === "page" ? "page" : "side",
  mine: false,
  query: "",
  overlay: null,
  editDesc: false,
  perf: "",
  preferences: readPreferences(),
  defaults: {},
  toolbar: null,
  propertySync: {total:0,pending:0,completed:0,errors:0},
  clock: Date.now(),
  details:false, draft:{}, undoCount:0, redoCount:0, fullErrors:new Map(),
  savedViews:readSavedViews(),
  favorites:readFavorites(),
  site:"",namespace:"",loadError:"",canEdit:true,storage:{status:"loading"},
};

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const get = () => state;
export function set(patch: Partial<State>) {
  if (patch.overlay || ((patch.view ?? state.view) === "page" && (patch.panel ?? state.panel))) patch.toolbar=null;
  if (patch.board && patch.board !== state.board) {
    patch.toolbar = null;
    patch.query = "";
    patch.mine = false;
    patch.draft = {};
    const prefs = state.preferences[patch.board];
    patch.view = prefs?.display.openIn ?? state.defaults[patch.board]?.openIn ?? "side";
  }
  if (patch.view && patch.view !== state.view) {
    const id = patch.board ?? state.board;
    const prefs = patch.preferences?.[id] ?? state.preferences[id] ?? defaultPreferences();
    patch.preferences = { ...(patch.preferences ?? state.preferences), [id]: { ...prefs, display: { ...prefs.display, openIn: patch.view } } };
  }
  state = { ...state, ...patch };
  try {if (patch.board) localStorage.setItem(preferenceKey("board"), String(patch.board));if (patch.view) localStorage.setItem(preferenceKey("view"), patch.view);}catch{/* Preference failure is separate from durable issue storage. */}
  if (patch.preferences) {
    try { localStorage.setItem(preferenceKey(PREF_KEY), JSON.stringify(patch.preferences)); }
    catch { state = {...state, perf: "Could not save view preferences in this browser"}; }
  }
  if(patch.savedViews)try{localStorage.setItem(preferenceKey("better-jira:saved-views:v1"),JSON.stringify(patch.savedViews));}catch{state={...state,perf:"Could not save views in this browser"};}
  if(patch.favorites)try{localStorage.setItem(preferenceKey("better-jira:favorites:v1"),JSON.stringify(patch.favorites));}catch{state={...state,perf:"Could not save favorites in this browser"};}
  if(navigationReady&&!restoringNavigation&&(patch.board!==undefined||patch.selected!==undefined||patch.panel!==undefined||patch.view!==undefined))syncNavigation();
  listeners.forEach((l) => l());
}
/** Selector must return a stable reference (a state field or a Map entry), never a fresh object. */
export const useStore = <T>(sel: (s: State) => T) => useSyncExternalStore(subscribe, () => sel(state));

const fallbackPreferences = defaultPreferences();
export const preferencesFor = (board: number) => state.preferences[board] ?? fallbackPreferences;
export const usePreferences = (board: number) => useStore(s => s.preferences[board] ?? fallbackPreferences);
export function changePreferences(board: number, patch: Partial<Preferences>) {
  const prefs = { ...preferencesFor(board), ...patch };
  set({ preferences: {...state.preferences, [board]:prefs}, ...(board === state.board ? {view:prefs.display.openIn} : {}) });
}
export function changeDisplay(board: number, patch: Partial<Display>) {
  const display={...preferencesFor(board).display,...patch};
  if(display.layout === "board" && display.columns === "none")display.columns="status";
  if(display.rows === display.columns)display.rows="none";
  changePreferences(board, {display});
}
export async function saveDefault(board: number) {
  const display = preferencesFor(board).display;
  try {
    const defaults={...state.defaults,[board]:structuredClone(display)};
    localStorage.setItem(preferenceKey("better-jira:defaults:v1"),JSON.stringify(defaults));
    set({defaults,perf:"Saved your default in this browser"});
  } catch { set({perf:"Could not save your default in this browser"}); }
}

let loading:Promise<void>|undefined,loaded=false;
export function load():Promise<void> {if(loaded)return Promise.resolve();return loading??=loadApplication().finally(()=>{loading=undefined;});}
async function json<T>(path:string):Promise<T> {const response=await fetch(path);if(!response.ok)throw new Error(`Could not load ${path}`);return response.json();}
function migratePreferences(namespace:string) {
  preferenceNamespace=namespace;
  try {
    const owner=localStorage.getItem("better-jira:preferences-owner");
    if(!owner)localStorage.setItem("better-jira:preferences-owner",namespace);
    if(!owner||owner===namespace)for(const key of [PREF_KEY,"board","view","better-jira:saved-views:v1","better-jira:favorites:v1","better-jira:defaults:v1"]){const old=localStorage.getItem(key);if(old!==null&&localStorage.getItem(preferenceKey(key))===null)localStorage.setItem(preferenceKey(key),old);}
  }catch{/* The mirror can still load if browser preferences are unavailable. */}
}
async function loadApplication() {
  set({loadError:""});
  try {
  const client=await json<{site:string;user:User}>("/api/client");
  if(!client.site||!client.user?.id||!client.user.name)throw new Error("Jira account setup is incomplete");
  Object.assign(ME,client.user);
  const namespace=`${client.site}/${client.user.id}`;
  migratePreferences(namespace);
  const [boards, remote]=await Promise.all([json<Board[]>("/api/boards"),json<Issue[]>("/api/issues")]);
  if(!boards.length)throw new Error("The Jira mirror is still syncing your boards. Retry in a moment.");
  let local=emptyLocalState(),storage:State["storage"]={status:"saved"},canEdit=true;
  try {
    database?.close();database=await LocalDatabase.open(namespace);
    const result=await database.load();local=result.state;canEdit=!result.readOnly;
    storage=result.readOnly?{status:"error",message:"Saved data uses an unsupported version. Local editing is paused; existing data has been preserved."}:{status:"saved",recovered:result.recovered||result.missingFiles>0,message:result.recovered?"Some local records needed recovery. A copy of the original data was kept.":result.missingFiles?"Some saved files could not be restored.":undefined};
  }catch {canEdit=false;storage={status:"error",message:"Could not read saved local data. Local editing is paused. Retry local storage; existing data has not been deleted."};}
  const defaults:Record<number,Display>=(()=>{try{const saved=JSON.parse(savedValue("better-jira:defaults:v1")??"{}");return saved&&typeof saved==="object"&&!Array.isArray(saved)?Object.fromEntries(Object.entries(saved).map(([id,display])=>[id,parsePreferences({display}).display])):{};}catch{return {};}})();
  const preferences=readPreferences();
  for (const b of boards) if (!preferences[b.id]) {
    const display = parsePreferences({display:defaults[b.id]}).display;
    if (!defaults[b.id]) display.openIn = savedValue("view")==="page"?"page":"side";
    preferences[b.id] = {...defaultPreferences(), display};
  }
  const savedBoard=Number(savedValue("board"));
  const board=boards.some(b=>b.id===savedBoard)?savedBoard:boards[0]!.id;
  const issues=new Map(remote.map(i=>[i.key,i])),full=new Map<string,Full>();
  changedKeys.clear();createdKeys.clear();localFields.clear();fullFields.clear();needsFullRefresh.clear();
  for(const change of local.changes) {
    changedKeys.add(change.key);if(change.created)createdKeys.add(change.key);
    localFields.set(change.key,new Set(change.issueFields));fullFields.set(change.key,new Set(change.fullFields));
    if(change.issue===null)issues.delete(change.key);
    else if(change.created||!issues.has(change.key))issues.set(change.key,change.issue);
    else {const base=issues.get(change.key)!;const patch=Object.fromEntries(change.issueFields.map(field=>[field,(change.issue as any)[field]]));if(change.fullFields.includes("comment"))patch.comments=base.comments+(change.full?.fields.comment?.comments??[]).filter((c:any)=>String(c.id).startsWith("local-")).length;issues.set(change.key,{...base,...patch});}
    if(change.full){full.set(change.key,change.full);if(!change.created)needsFullRefresh.add(change.key);}
  }
  undo.splice(0,undo.length,...local.undo);redo.splice(0,redo.length,...local.redo);localSeq=local.sequence;
  set({boards,board,site:client.site,namespace,issues,full,defaults,preferences,view:preferences[board]?.display.openIn??"side",savedViews:readSavedViews(),favorites:readFavorites(),canEdit,storage,undoCount:undo.length,redoCount:redo.length});
  if(!navigationReady){restoreNavigation();navigationReady=true;syncNavigation(true);window.addEventListener("popstate",restoreNavigation);}
  if(!loaded)window.addEventListener("beforeunload",event=>{if(unsaved){event.preventDefault();event.returnValue="";}});
  void loadProperties();
  clockTimer??=setInterval(()=>set({clock:Date.now()}),60000);
  loaded=true;
  }catch(error){set({loadError:error instanceof Error?error.message:"Could not load the Jira mirror. Retry."});}
}

let clockTimer: ReturnType<typeof setInterval> | undefined;
let propertyTimer: ReturnType<typeof setTimeout> | undefined;
const lastProperties=new Map<string,string>();
async function loadProperties() {
  clearTimeout(propertyTimer);
  try {
    const res=await fetch("/api/properties");
    if(!res.ok)throw new Error("Properties unavailable");
    const data=await res.json();
    const issues=new Map(state.issues);
    let changed=false;
    for(const [key,entry] of Object.entries(data.entries) as [string,any][]) {
      const issue=issues.get(key);
      const signature=JSON.stringify(entry);
      if(!issue||lastProperties.get(key)===signature)continue;
      lastProperties.set(key,signature);
      const {status,errors,...extra}=entry;
      for(const field of localFields.get(key)??[])delete extra[field];
      if(status!==issue.status) {delete extra.statusSince;delete extra.started;}
      issues.set(key,{...issue,...extra});changed=true;
    }
    set({propertySync:data.progress,...(changed?{issues}:{})});
    // Continue lightweight refreshes after warm-up so updated Jira histories are picked up too.
    propertyTimer=setTimeout(()=>void loadProperties(),data.progress.pending?3000:30000);
  } catch {
    propertyTimer=setTimeout(()=>void loadProperties(),10000);
  }
}

const pendingFull=new Set<string>();
export async function loadFull(key: string,force=false) {
  if (createdKeys.has(key)||state.full.has(key)&&!needsFullRefresh.has(key)&&!force||pendingFull.has(key)) return;
  pendingFull.add(key);
  set({fullErrors:new Map(state.fullErrors).set(key,"")});
  try {
    const res = await fetch(`/api/issues/${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error("Could not load issue details");
    let full = await res.json();
    const local=state.full.get(key);
    if(local)for(const field of fullFields.get(key)??[]){
      if(field==="comment") {const comments=[...(full.fields.comment?.comments??[]),...(local.fields.comment?.comments??[]).filter((c:any)=>String(c.id).startsWith("local-"))];full={...full,fields:{...full.fields,comment:{...full.fields.comment,comments,total:comments.length}}};}
      else full={...full,fields:{...full.fields,[field]:local.fields[field]}};
    }
    needsFullRefresh.delete(key);
    const issue=state.issues.get(key);
    if(issue)set({full:new Map(state.full).set(key,full),issues:new Map(state.issues).set(key,{...issue,...(full.fields.comment?{comments:full.fields.comment.total}:{}),...(!localFields.get(key)?.has("description")?{description:adfToText(full.fields.description)}:{})})});
  } catch { set({fullErrors:new Map(state.fullErrors).set(key,"Could not load issue details")}); }
  finally {pendingFull.delete(key);}
}

/** Time from the action to the next painted frame, shown in the header. */
export function timed(label: string, fn: () => void) {
  const t0 = performance.now();
  fn();
  requestAnimationFrame(() => setTimeout(() => set({ perf: `${label} · ${(performance.now() - t0).toFixed(1)}ms` })));
}

const now = () => new Date().toISOString();
let navigationReady=false,restoringNavigation=false;
function syncNavigation(replace=false) {
  const url=new URL(location.href);url.searchParams.set("board",String(state.board));
  if(state.panel&&state.selected){url.searchParams.set("issue",state.selected);url.searchParams.set("view",state.view);}else{url.searchParams.delete("issue");url.searchParams.delete("view");}
  if(url.href!==location.href)history[replace?"replaceState":"pushState"]({},"",url);
}
function restoreNavigation() {
  const params=new URL(location.href).searchParams,issue=state.issues.get(params.get("issue")??"");
  const board=issue?.board??Number(params.get("board"));
  restoringNavigation=true;
  set({...(state.boards.some(b=>b.id===board)?{board}:{}),selected:issue?.key??null,panel:!!issue,...(params.get("view")==="page"||params.get("view")==="side"?{view:params.get("view") as View}:{})});
  restoringNavigation=false;
}
const localFields=new Map<string,Set<string>>(),fullFields=new Map<string,Set<string>>();
const changedKeys=new Set<string>(),createdKeys=new Set<string>(),needsFullRefresh=new Set<string>();
const undo:LocalEdit[]=[],redo:LocalEdit[]=[];
let database:LocalDatabase|undefined,pendingSave:LocalState|undefined,saving:Promise<void>|undefined,unsaved=false;
function localSnapshot():LocalState {
  return {version:1,sequence:localSeq,changes:[...changedKeys].filter(key=>createdKeys.has(key)||!state.issues.has(key)||localFields.get(key)?.size||fullFields.get(key)?.size).map(key=>({key,issue:state.issues.get(key)??null,full:state.full.get(key),issueFields:[...(localFields.get(key)??[])],fullFields:[...(fullFields.get(key)??[])],created:createdKeys.has(key)})),undo:[...undo],redo:[...redo]};
}
function queueSave() {
  if(!database||!loaded||!state.canEdit)return;
  pendingSave=localSnapshot();unsaved=true;
  set({storage:{...state.storage,status:"saving"}});
  saving??=flushSaves().finally(()=>{saving=undefined;});
}
async function flushSaves() {
  try {
    while(pendingSave){const snapshot=pendingSave;pendingSave=undefined;await database!.save(snapshot);}
    unsaved=false;set({storage:{...state.storage,status:"saved",message:state.storage.recovered?state.storage.message:undefined}});
  }catch(error){set({storage:{status:"error",message:error instanceof Error?error.message:"Local changes could not be saved. Keep this tab open and retry."}});}
}
export async function flushLocalChanges() {await saving;}
export async function retryLocalStorage() {
  if(!state.canEdit){loaded=false;await load();}else{queueSave();await saving;}
}
export async function addLocalFile(file:File) {if(!database||!state.canEdit)throw new Error("Local file storage is unavailable. Retry local storage first.");return database.addFile(file);}
export async function downloadLocalBackup() {
  try {
    const data={version:1,namespace:state.namespace,state:localSnapshot(),recovery:await database?.recoveryCopies(),files:await database?.exportFiles()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="better-jira-local-backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{set({perf:"Could not export the local backup"});}
}
export function jiraIssueURL(key:string) {return `${state.site}/browse/${encodeURIComponent(key)}`;}
export function issueURL(issue:Issue) {if(createdKeys.has(issue.key)&&typeof location!=="undefined"){const url=new URL(location.origin);url.searchParams.set("board",String(issue.board));url.searchParams.set("issue",issue.key);return url.href;}return jiraIssueURL(issue.key);}
export const isLocalIssue=(key:string)=>createdKeys.has(key);
const snapshot=(key:string):Snapshot=>({issue:state.issues.get(key),full:state.full.get(key),issueFields:[...(localFields.get(key)??[])],fullFields:[...(fullFields.get(key)??[])]});
let transaction:{label:string;before:Map<string,Snapshot>}|null=null;
function record(key:string|string[],label:string,fn:()=>void) {
  if(!state.canEdit){set({perf:"Local editing is paused until saved data is available"});return;}
  const keys=typeof key==="string"?[key]:key;
  const nested=transaction!==null;
  transaction??={label,before:new Map()};
  for(const key of keys)if(!transaction.before.has(key))transaction.before.set(key,snapshot(key));
  if(nested){fn();return;}
  try {
    fn();
    const changed=[...transaction.before.keys()].filter(key=>{const before=transaction!.before.get(key)!,after=snapshot(key);return before.issue!==after.issue||before.full!==after.full;});
    if(!changed.length)return;
    for(const key of changed)changedKeys.add(key);
    undo.push({keys:changed,label,before:changed.map(key=>transaction!.before.get(key)!),after:changed.map(snapshot)});
    if(undo.length>100)undo.shift();
    redo.length=0;
    set({undoCount:undo.length,redoCount:0});
    queueSave();
  } finally {transaction=null;}
}
function restore(edit:LocalEdit,snapshots:Snapshot[]) {
  const issues=new Map(state.issues),full=new Map(state.full);
  edit.keys.forEach((key,index)=>{
    const snapshot=snapshots[index]!;
    if(snapshot.issue)issues.set(key,snapshot.issue);else issues.delete(key);
    if(snapshot.full)full.set(key,snapshot.full);else full.delete(key);
    if(snapshot.issueFields)localFields.set(key,new Set(snapshot.issueFields));
    if(snapshot.fullFields)fullFields.set(key,new Set(snapshot.fullFields));
    if(snapshot.issue&&!createdKeys.has(key))needsFullRefresh.add(key);
  });
  set({issues,full,overlay:null,...(state.selected&&!issues.has(state.selected)?{selected:null,panel:false}:{})});
}
export function undoEdit() {
  const edit=undo.pop();if(!edit)return;
  restore(edit,edit.before);redo.push(edit);
  set({undoCount:undo.length,redoCount:redo.length,perf:`Undid ${edit.label}`});
  queueSave();
}
export function redoEdit() {
  const edit=redo.pop();if(!edit)return;
  restore(edit,edit.after);undo.push(edit);
  set({undoCount:undo.length,redoCount:redo.length,perf:`Redid ${edit.label}`});
  queueSave();
}
export function beginCreate(draft:IssueDraft={}) {
  if(!state.canEdit){set({perf:"Retry local storage before creating an issue"});return;}
  const prefs=preferencesFor(state.board),board=state.boards.find(b=>b.id===state.board);
  const status=prefs.scope==="active"?board?.columns.find(c=>!/backlog/i.test(c.name)&&c.statuses.some(s=>s.category!=="done"))?.statuses.find(s=>s.category!=="done")?.id:undefined;
  set({draft:{...(status?{status}:{}),...(state.mine?{assignee:ME}:{}),...draft},overlay:"create"});
}
function readSavedViews():SavedView[] {
  try {
    const items=JSON.parse(savedValue("better-jira:saved-views:v1")??"[]");
    return Array.isArray(items)?items.filter(v=>v&&typeof v.id==="string"&&typeof v.name==="string"&&v.name.trim()&&typeof v.board==="number").map(v=>({...v,preferences:parsePreferences(v.preferences),mine:v.mine===true})):[];
  }catch{return [];}
}
function readFavorites():string[] {try{const values=JSON.parse(savedValue("better-jira:favorites:v1")??"[]");return Array.isArray(values)?values.filter(v=>typeof v==="string"):[];}catch{return [];}}
export function toggleFavorite(id:string) {set({favorites:state.favorites.includes(id)?state.favorites.filter(v=>v!==id):[...state.favorites,id]});}
export function saveView(name:string) {
  if(!name.trim())return;
  const view:SavedView={id:crypto.randomUUID(),name:name.trim(),board:state.board,preferences:structuredClone(preferencesFor(state.board)),mine:state.mine};
  set({savedViews:[...state.savedViews,view],perf:`Saved view ${view.name}`});
}
export function openSavedView(view:SavedView) {
  set({board:view.board,preferences:{...state.preferences,[view.board]:structuredClone(view.preferences)},selected:null,panel:false,toolbar:null});
  set({mine:view.mine,view:view.preferences.display.openIn});
}

function patchIssue(key: string, patch: Partial<Issue>) {
  const i = state.issues.get(key);
  if (i) {
    localFields.set(key,new Set([...(localFields.get(key)??[]),...Object.keys(patch),"updated"]));
    set({ issues: new Map(state.issues).set(key, { ...i, ...patch, updated: now() }) });
  }
}

function patchFields(key: string, fn: (fields: any) => object) {
  const f = state.full.get(key);
  if (f) {const patch=fn(f.fields);fullFields.set(key,new Set([...(fullFields.get(key)??[]),...Object.keys(patch)]));set({full:new Map(state.full).set(key,{...f,fields:{...f.fields,...patch}})});}
}

export const boardOf = (key: string) => state.boards.find((b) => b.id === state.issues.get(key)?.board);

let localSeq = 0;

// Local overrides are saved separately from the read-only Jira mirror.
export const actions = {
  async restoreJira(key:string) {
    if(createdKeys.has(key)||!state.canEdit)return;
    try {
      const [remote,full]=await Promise.all([json<Issue[]>("/api/issues"),json<Full>(`/api/issues/${encodeURIComponent(key)}`)]);
      const issue=remote.find(i=>i.key===key);if(!issue)throw new Error("Issue is no longer in the Jira mirror");
      record(key,`restore Jira version of ${key}`,()=>{
        localFields.set(key,new Set());fullFields.set(key,new Set());needsFullRefresh.delete(key);
        set({issues:new Map(state.issues).set(key,issue),full:new Map(state.full).set(key,full),overlay:null,perf:`Restored mirrored Jira version of ${key}`});
      });
    }catch{set({perf:"Could not read the Jira version. Your local changes are still here."});}
  },
  patch(key: string, patch: IssueDraft & Partial<Pick<Issue,"links"|"relations"|"reactions"|"watchers"|"watchersComplete">>) {
    timed(`edit ${key}`,()=>record(key,`edit ${key}`,()=>patchIssue(key,patch)));
  },
  drop(key:string,boardId:number,groups:{by:Grouping;id:string}[]) {
    const issue=state.issues.get(key),board=state.boards.find(b=>b.id===boardId);
    if(!issue||!board||issue.board!==boardId)return;
    // One drag, including its column and row changes, is one undoable edit.
    record(key,`move ${key}`,()=>{
      for(const {by,id} of groups) {
        const current=state.issues.get(key)!;
        if(by==="status") {
          const col=board.columns.findIndex(c=>c.name===id);if(col>=0)actions.move(key,col);
        }else if(by==="category") {
          const status=board.columns.flatMap(c=>c.statuses).find(s=>s.category===id);if(status)actions.status(key,status.id);
        }else if(by==="assignee")actions.assign(key,id==="$none"?null:id===ME.id?ME:[...state.issues.values()].find(i=>i.assignee?.id===id)?.assignee??null);
        else if(by==="project")actions.patch(key,{project:[...state.issues.values()].find(i=>i.project?.key===id)?.project??null,milestones:[]});
        else if(by==="priority"||by==="type")actions.patch(key,{[by]:id==="$none"?undefined:id});
        else if(by==="label")actions.patch(key,{labels:id==="$none"?[]:[...new Set([...current.labels,id])]});
        else if(by==="parent") {
          let ancestor=id;const seen=new Set([key]);let cycle=false;
          while(ancestor&&ancestor!=="$none"){if(seen.has(ancestor)){cycle=true;break;}seen.add(ancestor);ancestor=state.issues.get(ancestor)?.parent??"";}
          if(!cycle)actions.patch(key,{parent:id==="$none"?undefined:id});
        }
      }
    });
  },
  /** Move to a column's first status; no-op if the issue is already in that column. */
  move(key: string, col: number) {
    const c = boardOf(key)?.columns[col];
    if (c?.statuses[0] && !c.statuses.some((x) => x.id === state.issues.get(key)?.status)) actions.status(key, c.statuses[0].id);
  },
  status(key: string, id: string) {
    const i = state.issues.get(key);
    const s = boardOf(key)?.columns.flatMap((c) => c.statuses).find((x) => x.id === id);
    set({ overlay: null });
    if (!i || !s || i.status === id) return;
    timed(`move ${key} → ${s.name}`, () =>
      record(key,`move ${key}`,()=>patchIssue(key, { status: s.id, statusSince:now(), started:i.started??(s.category === "indeterminate"?now():undefined), resolved: s.category === "done" ? (i.resolved ?? now()) : null })),
    );
  },
  assign(key: string, user: User | null) {
    timed(`assign ${key} → ${user?.name ?? "Unassigned"}`, () => {
      record(key,`assign ${key}`,()=>patchIssue(key, { assignee: user }));
      set({ overlay: null });
    });
  },
  summary(key: string, summary: string) {
    if (summary.trim() && summary !== state.issues.get(key)?.summary)
      timed(`edit ${key} summary`, () => record(key,`rename ${key}`,()=>patchIssue(key, { summary: summary.trim() })));
  },
  description(key: string, value: string|AdfDocument) {
    const previous=normalizeDocument(state.full.get(key)?.fields.description);
    const document=normalizeDocument(value);
    if(JSON.stringify(document)===JSON.stringify(previous)){set({editDesc:false});return;}
    timed(`edit ${key} description`, () => record(key,`description on ${key}`,() => {
      patchFields(key, () => ({ description:document }));
      patchIssue(key, {description:adfToText(document),descriptionHistory:[...(state.issues.get(key)?.descriptionHistory??[]),{text:adfToText(previous),document:previous,at:now()}]});
      set({ editDesc: false });
    }));
  },
  comment(key: string, text: string) {
    if (!text.trim()) return;
    if(!state.full.has(key))return;
    timed(`comment on ${key}`, () => record(key,`comment on ${key}`,() => {
      const c = {
        id: `local-${++localSeq}`,
        author: { accountId: ME.id, displayName: ME.name, avatarUrls: { "24x24": ME.avatar } },
        body: textToAdf(text),
        created: now(),
      };
      patchFields(key, (f) => ({ comment: { ...f.comment, comments: [...f.comment.comments, c], total: f.comment.total + 1 } }));
      patchIssue(key, { comments: (state.issues.get(key)?.comments ?? 0) + 1 });
    }));
  },
  create(summary: string, draft:IssueDraft={}, more=false) {
    if(!state.canEdit)return;
    const board = state.boards.find((b) => b.id === state.board);
    const statuses=board?.columns.flatMap(c=>c.statuses)??[];
    const status = statuses.find(s=>s.id===draft.status)??statuses[0];
    if (!board || !status || !summary.trim()) return;
    const prefix = [...state.issues.values()].find((i) => i.board === board.id)?.key.split("-")[0]??"LOCAL";
    const key = `${prefix}-NEW${++localSeq}`;
    createdKeys.add(key);
    const {descriptionDoc,...fields}=draft;
    const document=normalizeDocument(descriptionDoc??draft.description??"");
    timed(`create ${key}`, () => record(key,`create ${key}`,() => {
      const issue: Issue = {
        key, board: board.id, summary: summary.trim(), type: "Task", priority: "Normal",
        assignee: null, labels: [], rank: "0", comments: 0, updated: now(),
        created: now(), statusSince:now(), creator: ME, milestones:[],prCount:0,watchers:[],watchersComplete:true, project: [...state.issues.values()].find(i=>i.board === board.id)?.project,
        ...fields,description:adfToText(document),status:status.id, resolved:status.category==="done"?now():null,
      };
      const full: Full = {
        key,
        fields: {
          description: document, created: now(), comment: { comments: [], total: 0 },
          reporter: { accountId: ME.id, displayName: ME.name, avatarUrls: { "24x24": ME.avatar } },
        },
      };
      set({
        issues: new Map(state.issues).set(key, issue),
        full: new Map(state.full).set(key, full),
        ...(more?{perf:`Created ${key}`,overlay:"create" as const}:{selected: key, panel: true, overlay: null}),
      });
    }));
    return key;
  },
  remove(key:string) {
    const related=[...state.issues.values()].filter(i=>i.parent===key||i.relations?.some(r=>r.key===key));
    record([key,...related.map(i=>i.key)],`delete ${key}`,()=> {
      for(const issue of related)patchIssue(issue.key,{...(issue.parent===key?{parent:undefined}:{}),relations:issue.relations?.filter(r=>r.key!==key)});
      const issues=new Map(state.issues),full=new Map(state.full);issues.delete(key);full.delete(key);
      set({issues,full,selected:null,panel:false,overlay:null,perf:`Deleted ${key}. Undo to restore.`});
    });
  },
  duplicate(key:string) {
    const issue=state.issues.get(key);if(!issue)return;
    set({board:issue.board});
    return actions.create(`${issue.summary} (copy)`,{status:issue.status,assignee:issue.assignee,priority:issue.priority,labels:[...issue.labels],project:issue.project,milestones:issue.milestones,due:issue.due,parent:issue.parent,type:issue.type,descriptionDoc:normalizeDocument(state.full.get(key)?.fields.description??issue.description)});
  },
  relate(key:string,target:string,kind:string,remove=false) {
    if(key===target)return;
    const inverse=kind==="blocked"?"blocking":kind==="blocking"?"blocked":kind;
    record([key,target],`${remove?"remove":"add"} relation`,()=>{
      for(const [from,to,relation] of [[key,target,kind],[target,key,inverse]] as const) {
        const issue=state.issues.get(from);if(!issue)continue;
        const relations=(issue.relations??[]).filter(r=>r.key!==to||r.kind!==relation);
        if(!remove)relations.push({key:to,kind:relation});
        patchIssue(from,{relations});
      }
    });
  },
};
