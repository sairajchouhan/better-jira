import { useSyncExternalStore } from "react";
import { adfToText, textToAdf } from "./adf";
import { defaultPreferences, parsePreferences, type Display, type Grouping, type Preferences } from "./view-model";
import { documentHasMedia, normalizeDocument, type AdfDocument } from "./document";
import { emptyLocalState,LocalDatabase,type LocalState,type Snapshot,type LocalEdit } from "./local-data";
import { createActor, fromPromise, waitFor } from "xstate";
import { appMachine, detailMachine, inspector, storageMachine, syncMachine, uiMachine, type UiContext } from "./machines";

import type {MediaEdit} from "./media-edits";

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
  mediaEdits?:Record<string,MediaEdit>;
  descriptionHistory?: {text:string;document?:AdfDocument;at:string}[];
};
export type Status = { id: string; name: string; category: string };
export type Column = { name: string; statuses: Status[] };
export type Board = { id: number; name: string; columns: Column[] };
/** Raw Jira issue: { key, fields: { description, comment, reporter, created, ... } } */
export type Full = { key: string; fields: any };
export type Overlay = null | "palette" | "assign" | "status" | "create" | "priority" | "labels" | "project" | "milestone" | "due" | "options" | "relations" | "shortcuts" | "help" | "search" | "favorites" | "views" | "boards" | "subscribers";
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
  /** A transient confirmation, e.g. after creating an issue. */
  toast: {text:string;key?:string}|null;
  preferences: Record<number, Preferences>;
  defaults: Record<number, Display>;
  toolbar: "display" | "filter" | "advanced" | null;
  propertySync: {total:number;pending:number;completed:number;errors:number};
  clock: number;
  details: boolean;
  issuePropertiesHidden:boolean;
  findInView:boolean;
  sidebarHidden:boolean;
  relationKind:string;
  issueOptionsStart:"link"|null;
  createExpanded:boolean;
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
  toast: null,
  preferences: readPreferences(),
  defaults: {},
  toolbar: null,
  propertySync: {total:0,pending:0,completed:0,errors:0},
  clock: Date.now(),
  details:false,issuePropertiesHidden:false,findInView:false,sidebarHidden:false,relationKind:"related",issueOptionsStart:null,createExpanded:false, draft:{}, undoCount:0, redoCount:0, fullErrors:new Map(),
  savedViews:readSavedViews(),
  favorites:readFavorites(),
  site:"",namespace:"",loadError:"",canEdit:true,storage:{status:"loading"},
};

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const get = () => state;
type UiKey = keyof UiContext;
/** Data changes. Screen state (board, issue, overlay, toolbar…) changes only through `ui.send`; see machines.ts. */
export function set(patch: Partial<Omit<State, UiKey|"loadError"|"storage"|"canEdit">>) {commit(patch);}
function commit(patch: Partial<State>) {
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

// The running machines. Each mirrors its state onto `state` so components read it with useStore.
export const ui = createActor(uiMachine, { input: { board: state.board, view: state.view }, inspect: inspector("ui") }).start();
ui.subscribe(({ context }) => {
  const patch: Partial<State> = {};
  for (const key of Object.keys(context) as UiKey[]) if (context[key] !== state[key]) Object.assign(patch, { [key]: context[key] });
  if (!Object.keys(patch).length) return;
  if (patch.view) { // Each board remembers how its issues open.
    const id = context.board, prefs = state.preferences[id] ?? defaultPreferences();
    patch.preferences = { ...state.preferences, [id]: { ...prefs, display: { ...prefs.display, openIn: patch.view } } };
  }
  commit(patch);
});
/** Sends `navigate`, filling in a new board's remembered issue view. */
export function navigate(to: { board?: number; view?: View; selected?: string | null; panel?: boolean }) {
  const view = to.view ?? (to.board !== undefined && to.board !== state.board ? state.preferences[to.board]?.display.openIn ?? state.defaults[to.board]?.openIn ?? "side" : undefined);
  ui.send({ type: "navigate", ...to, ...(view ? { view } : {}) });
}
const app = createActor(appMachine.provide({ actors: { load: fromPromise(loadApplication) } }), { inspect: inspector("app") }).start();
app.subscribe(({ context }) => { if (context.error !== state.loadError) commit({ loadError: context.error }); });
const storage = createActor(storageMachine.provide({ actors: { save: fromPromise(async () => database!.save(localSnapshot())) } }), { inspect: inspector("storage") }).start();
storage.subscribe(s => {
  const status = s.matches("failed") || s.matches("blocked") ? "error" : s.value as "loading" | "saving" | "saved";
  commit({ canEdit: !s.matches("blocked"), storage: { status, ...(s.context.message ? { message: s.context.message } : {}), ...(s.context.recovered ? { recovered: true } : {}) } });
});
const sync = createActor(syncMachine.provide({ actors: { fetch: fromPromise(fetchProperties) } }), { inspect: inspector("sync") }).start();
const details = new Map<string, ReturnType<typeof createActor<typeof detailMachine>>>();
const detailLoader = detailMachine.provide({ actors: { fetch: fromPromise<void, { key: string }>(({ input }) => fetchFull(input.key)) } });
if (typeof window !== "undefined") Object.assign(window, { machines: { ui, app, storage, sync, details } });

const fallbackPreferences = defaultPreferences();
export const preferencesFor = (board: number) => state.preferences[board] ?? fallbackPreferences;
export const usePreferences = (board: number) => useStore(s => s.preferences[board] ?? fallbackPreferences);
export function changePreferences(board: number, patch: Partial<Preferences>) {
  const prefs = { ...preferencesFor(board), ...patch };
  set({ preferences: {...state.preferences, [board]:prefs} });
  if (board === state.board) navigate({ view: prefs.display.openIn });
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

const settled = (s: ReturnType<typeof app.getSnapshot>) => s.matches("ready") || s.matches("failed");
export async function load() {app.send({type:"load"});await waitFor(app,settled);}
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
  const client=await json<{site:string;user:User}>("/api/client");
  if(!client.site||!client.user?.id||!client.user.name)throw new Error("Jira account setup is incomplete");
  Object.assign(ME,client.user);
  const namespace=`${client.site}/${client.user.id}`;
  migratePreferences(namespace);
  const [boards, remote]=await Promise.all([json<Board[]>("/api/boards"),json<Issue[]>("/api/issues")]);
  if(!boards.length)throw new Error("The Jira mirror is still syncing your boards. Retry in a moment.");
  let local=emptyLocalState(),opened:{type:"opened";message?:string;recovered?:boolean}|{type:"blocked";message:string};
  try {
    database?.close();database=await LocalDatabase.open(namespace);
    const result=await database.load();local=result.state;
    opened=result.readOnly?{type:"blocked",message:"Saved data uses an unsupported version. Local editing is paused; existing data has been preserved."}:{type:"opened",recovered:result.recovered||result.missingFiles>0,message:result.recovered?"Some local records needed recovery. A copy of the original data was kept.":result.missingFiles?"Some saved files could not be restored.":undefined};
  }catch {opened={type:"blocked",message:"Could not read saved local data. Local editing is paused. Retry local storage; existing data has not been deleted."};}
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
  set({boards,site:client.site,namespace,issues,full,defaults,preferences,savedViews:readSavedViews(),favorites:readFavorites(),undoCount:undo.length,redoCount:redo.length});
  navigate({board,view:preferences[board]?.display.openIn??"side"});
  storage.send(opened);
  if(!navigationReady){
    restoreNavigation();navigationReady=true;syncNavigation(true);window.addEventListener("popstate",restoreNavigation);
    window.addEventListener("beforeunload",event=>{const s=storage.getSnapshot();if(s.matches("saving")||s.matches("failed")){event.preventDefault();event.returnValue="";}});
  }
  sync.send({type:"start"});
  clockTimer??=setInterval(()=>set({clock:Date.now()}),60000);
}

let clockTimer: ReturnType<typeof setInterval> | undefined;
const lastProperties=new Map<string,string>();
/** One poll of the sync machine; it schedules the next. */
async function fetchProperties():Promise<{pending:number}> {
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
    return data.progress;
}

export async function loadFull(key: string,force=false) {
  if (createdKeys.has(key)||state.full.has(key)&&!needsFullRefresh.has(key)&&!force) return;
  let detail=details.get(key);
  if(!detail){
    detail=createActor(detailLoader,{input:{key},inspect:inspector(`detail ${key}`)}).start();
    detail.subscribe(({context})=>{if(state.fullErrors.get(key)!==context.error)set({fullErrors:new Map(state.fullErrors).set(key,context.error)});});
    details.set(key,detail);
  }
  detail.send({type:"load"});
  await waitFor(detail,s=>!s.matches("loading"));
}
/** The detail machine's fetch: loads the Jira record and keeps local field edits on top. */
async function fetchFull(key:string) {
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
  const params=new URL(location.href).searchParams,wanted=params.get("issue"),issue=state.issues.get(wanted??"");
  const board=issue?.board??Number(params.get("board"));
  restoringNavigation=true;
  navigate({...(state.boards.some(b=>b.id===board)?{board}:{}),selected:issue?.key??null,panel:!!issue,...(params.get("view")==="page"||params.get("view")==="side"?{view:params.get("view") as View}:{})});
  restoringNavigation=false;
  if(wanted&&!issue)ui.send({type:"toast.show",text:`Issue ${wanted} not found`});
}
const localFields=new Map<string,Set<string>>(),fullFields=new Map<string,Set<string>>();
const changedKeys=new Set<string>(),createdKeys=new Set<string>(),needsFullRefresh=new Set<string>();
const undo:LocalEdit[]=[],redo:LocalEdit[]=[];
let database:LocalDatabase|undefined;
function localSnapshot():LocalState {
  return {version:1,sequence:localSeq,changes:[...changedKeys].filter(key=>createdKeys.has(key)||!state.issues.has(key)||localFields.get(key)?.size||fullFields.get(key)?.size).map(key=>({key,issue:state.issues.get(key)??null,full:state.full.get(key),issueFields:[...(localFields.get(key)??[])],fullFields:[...(fullFields.get(key)??[])],created:createdKeys.has(key)})),undo:[...undo],redo:[...redo]};
}
/** Ignored until storage has opened, and while it is blocked; see storageMachine. */
const queueSave=()=>storage.send({type:"change"});
export const dismissRecoveryNotice=()=>storage.send({type:"dismiss"});
export async function flushLocalChanges() {await waitFor(storage,s=>!s.matches("saving"));}
export async function retryLocalStorage() {
  if(storage.getSnapshot().matches("blocked")){app.send({type:"reload"});await waitFor(app,settled);}
  else{queueSave();await flushLocalChanges();}
}
export async function addLocalFiles(files:File[]) {if(!database||!state.canEdit)throw new Error("Local file storage is unavailable. Retry local storage first.");return database.addFiles(files);}
export async function addLocalFile(file:File) {return (await addLocalFiles([file]))[0]!;}
export async function addIssueFiles(key:string,files:File[]) {
  if(!database||!state.canEdit)throw new Error("Local file storage is unavailable. Retry local storage first.");
  const saved=await database.addFiles(files),issue=state.issues.get(key);
  if(issue)record(key,`attached files to ${key}`,()=>patchIssue(key,{attachments:[...(issue.attachments??[]),...saved]}));
  return saved;
}
export async function downloadLocalBackup() {
  try {
    const {backupArchive}=await import('./backup-archive');
    const data={version:2,namespace:state.namespace,state:localSnapshot(),recovery:await database?.recoveryCopies()};
    const url=URL.createObjectURL(backupArchive(data,await database?.fileBlobs()??[])),a=document.createElement("a");a.href=url;a.download="better-jira-local-backup.tar";a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
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
  set({issues,full});ui.send({type:"overlay.close"});
  if(state.selected&&!issues.has(state.selected))navigate({selected:null,panel:false});
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
  ui.send({type:"overlay.open",overlay:"create",draft:{...(status?{status}:{}),...(state.mine?{assignee:ME}:{}),...draft}});
}
function readSavedViews():SavedView[] {
  try {
    const items=JSON.parse(savedValue("better-jira:saved-views:v1")??"[]");
    return Array.isArray(items)?items.filter(v=>v&&typeof v.id==="string"&&typeof v.name==="string"&&v.name.trim()&&typeof v.board==="number").map(v=>({...v,preferences:parsePreferences(v.preferences),mine:v.mine===true})):[];
  }catch{return [];}
}
/** Boards are favourited once, not per tab; older `board:<id>:<tab>` entries collapse into `board:<id>`. */
function readFavorites():string[] {try{const values=JSON.parse(savedValue("better-jira:favorites:v1")??"[]");return Array.isArray(values)?[...new Set(values.filter(v=>typeof v==="string").map(v=>v.replace(/^(board:\d+):.*$/,"$1")))]:[];}catch{return [];}}
export function toggleFavorite(id:string) {set({favorites:state.favorites.includes(id)?state.favorites.filter(v=>v!==id):[...state.favorites,id]});}
export function saveView(name:string) {
  if(!name.trim())return;
  const view:SavedView={id:crypto.randomUUID(),name:name.trim(),board:state.board,preferences:structuredClone(preferencesFor(state.board)),mine:state.mine};
  set({savedViews:[...state.savedViews,view],perf:`Saved view ${view.name}`});
}
export function openSavedView(view:SavedView) {
  set({preferences:{...state.preferences,[view.board]:structuredClone(view.preferences)}});
  navigate({board:view.board,selected:null,panel:false,view:view.preferences.display.openIn});
  ui.send({type:"toolbar.close"});ui.send({type:"mine.set",mine:view.mine});
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
        set({issues:new Map(state.issues).set(key,issue),full:new Map(state.full).set(key,full),perf:`Restored mirrored Jira version of ${key}`});ui.send({type:"overlay.close"});
      });
    }catch{set({perf:"Could not read the Jira version. Your local changes are still here."});}
  },
  patch(key: string, patch: IssueDraft & Partial<Pick<Issue,"links"|"relations"|"reactions"|"watchers"|"watchersComplete">>) {
    timed(`edit ${key}`,()=>record(key,`edit ${key}`,()=>patchIssue(key,patch)));
  },
  /** `rank` places the card where it was dropped (manual ordering). */
  drop(key:string,boardId:number,groups:{by:Grouping;id:string}[],rank?:string) {
    const issue=state.issues.get(key),board=state.boards.find(b=>b.id===boardId);
    if(!issue||!board||issue.board!==boardId)return;
    // One drag, including its column and row changes, is one undoable edit.
    record(key,`move ${key}`,()=>{
      if(rank!==undefined)patchIssue(key,{rank});
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
    ui.send({ type: "overlay.close" });
    if (!i || !s || i.status === id) return;
    timed(`move ${key} → ${s.name}`, () =>
      record(key,`move ${key}`,()=>patchIssue(key, { status: s.id, statusSince:now(), started:i.started??(s.category === "indeterminate"?now():undefined), resolved: s.category === "done" ? (i.resolved ?? now()) : null })),
    );
  },
  assign(key: string, user: User | null) {
    timed(`assign ${key} → ${user?.name ?? "Unassigned"}`, () => {
      record(key,`assign ${key}`,()=>patchIssue(key, { assignee: user }));
      ui.send({ type: "overlay.close" });
    });
  },
  summary(key: string, summary: string) {
    if (summary.trim() && summary !== state.issues.get(key)?.summary)
      timed(`edit ${key} summary`, () => record(key,`rename ${key}`,()=>patchIssue(key, { summary: summary.trim() })));
  },
  mediaEdit(key:string,id:string,edit:MediaEdit){
    const issue=state.issues.get(key);if(issue)record(key,`image edit on ${key}`,()=>patchIssue(key,{mediaEdits:{...issue.mediaEdits,[id]:edit}}));
  },
  description(key: string, value: string|AdfDocument) {
    const previous=normalizeDocument(state.full.get(key)?.fields.description);
    const document=normalizeDocument(value);
    if(JSON.stringify(document)===JSON.stringify(previous)){ui.send({type:"description.editDone"});return;}
    timed(`edit ${key} description`, () => record(key,`description on ${key}`,() => {
      patchFields(key, () => ({ description:document }));
      // Autosave writes often; one history entry per minute of editing keeps the revision list readable.
      const history=state.issues.get(key)?.descriptionHistory??[],last=history.at(-1),recent=!!last&&Date.now()-Date.parse(last.at)<60_000;
      patchIssue(key, {description:adfToText(document),descriptionHistory:recent?history:[...history,{text:adfToText(previous),document:previous,at:now()}]});
      ui.send({ type: "description.editDone" });
    }));
  },
  comment(key: string, value: string|AdfDocument):boolean {
    const body=typeof value==="string"?textToAdf(value):normalizeDocument(value);
    if ((!adfToText(body).trim()&&!documentHasMedia(body))||!state.full.has(key)||!state.canEdit) return false;
    timed(`comment on ${key}`, () => record(key,`comment on ${key}`,() => {
      const c = {
        id: `local-${++localSeq}`,
        author: { accountId: ME.id, displayName: ME.name, avatarUrls: { "24x24": ME.avatar } },
        body,
        created: now(),
      };
      patchFields(key, (f) => ({ comment: { ...f.comment, comments: [...f.comment.comments, c], total: f.comment.total + 1 } }));
      patchIssue(key, { comments: (state.issues.get(key)?.comments ?? 0) + 1 });
    }));
    return true;
  },
  /** Only local comments can change: Jira writes are disabled, so remote ones are read-only. */
  editComment(key:string,id:string,value:AdfDocument) {
    const body=normalizeDocument(value);
    if(!id.startsWith("local-")||(!adfToText(body).trim()&&!documentHasMedia(body)))return;
    record(key,`edit comment on ${key}`,()=>patchFields(key,f=>({comment:{...f.comment,comments:f.comment.comments.map((c:any)=>c.id===id?{...c,body,updated:now()}:c)}})));
  },
  deleteComment(key:string,id:string) {
    if(!id.startsWith("local-"))return;
    record(key,`delete comment on ${key}`,()=>{
      patchFields(key,f=>({comment:{...f.comment,comments:f.comment.comments.filter((c:any)=>c.id!==id),total:Math.max(0,f.comment.total-1)}}));
      patchIssue(key,{comments:Math.max(0,(state.issues.get(key)?.comments??1)-1)});
    });
  },
  /** Like Linear, creating from the composer stays on the board and confirms with a toast; `open` shows the new issue instead. */
  create(summary: string, draft:IssueDraft={}, more=false, open=false) {
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
      set({ issues: new Map(state.issues).set(key, issue), full: new Map(state.full).set(key, full), ...(more?{perf:`Created ${key}`}:{}) });
      // "Create more" keeps the composer open; otherwise open the issue, or stay on the board with a toast.
      if(!more){navigate(open?{selected:key,panel:true}:{selected:key});ui.send({type:"overlay.close"});if(!open)ui.send({type:"toast.show",text:`Created ${key}`,key});}
    }));
    return key;
  },
  remove(key:string) {
    const related=[...state.issues.values()].filter(i=>i.parent===key||i.relations?.some(r=>r.key===key));
    record([key,...related.map(i=>i.key)],`delete ${key}`,()=> {
      for(const issue of related)patchIssue(issue.key,{...(issue.parent===key?{parent:undefined}:{}),relations:issue.relations?.filter(r=>r.key!==key)});
      const issues=new Map(state.issues),full=new Map(state.full);issues.delete(key);full.delete(key);
      set({issues,full,perf:`Deleted ${key}. Undo to restore.`});navigate({selected:null,panel:false});ui.send({type:"overlay.close"});
    });
  },
  duplicate(key:string) {
    const issue=state.issues.get(key);if(!issue)return;
    navigate({board:issue.board});
    return actions.create(`${issue.summary} (copy)`,{status:issue.status,assignee:issue.assignee,priority:issue.priority,labels:[...issue.labels],project:issue.project,milestones:issue.milestones,due:issue.due,parent:issue.parent,type:issue.type,descriptionDoc:normalizeDocument(state.full.get(key)?.fields.description??issue.description)},false,true);
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
