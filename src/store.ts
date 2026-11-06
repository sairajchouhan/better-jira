import { useSyncExternalStore } from "react";
import { adfToText, textToAdf } from "./adf";
import { defaultPreferences, parsePreferences, type Display, type Grouping, type Preferences } from "./view-model";

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
  attachments?: {id:string;name:string;url:string;type:string;size:number}[];
  reactions?: string[];
  descriptionHistory?: {text:string;at:string}[];
};
export type Status = { id: string; name: string; category: string };
export type Column = { name: string; statuses: Status[] };
export type Board = { id: number; name: string; columns: Column[] };
/** Raw Jira issue: { key, fields: { description, comment, reporter, created, ... } } */
export type Full = { key: string; fields: any };
type Overlay = null | "palette" | "assign" | "status" | "create" | "priority" | "labels" | "project" | "milestone" | "due" | "options" | "relations";
export type IssueDraft = Partial<Pick<Issue,"status"|"assignee"|"priority"|"labels"|"project"|"milestones"|"due"|"parent"|"type"|"attachments">> & {description?:string};
export type View = "side" | "page";
export type SavedView={id:string;board:number;name:string;preferences:Preferences;mine:boolean};

export const ME: User = { id: "63d764b982eeee78a4cd2b56", name: "Sairaj Chouhan" };

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
};

const PREF_KEY = "better-jira:views:v1";
function readPreferences(): Record<number, Preferences> {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(saved).map(([id, p]) => [id, parsePreferences(p)]));
  } catch { return {}; }
}

let state: State = {
  boards: [],
  issues: new Map(),
  full: new Map(),
  board: Number(localStorage.getItem("board")) || 4142,
  selected: null,
  panel: false,
  view: localStorage.getItem("view") === "page" ? "page" : "side",
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
  if (patch.board) localStorage.setItem("board", String(patch.board));
  if (patch.view) localStorage.setItem("view", patch.view);
  if (patch.preferences) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(patch.preferences)); }
    catch { state = {...state, perf: "Could not save view preferences in this browser"}; }
  }
  if(patch.savedViews)try{localStorage.setItem("better-jira:saved-views:v1",JSON.stringify(patch.savedViews));}catch{state={...state,perf:"Could not save views in this browser"};}
  if(patch.favorites)try{localStorage.setItem("better-jira:favorites:v1",JSON.stringify(patch.favorites));}catch{state={...state,perf:"Could not save favorites in this browser"};}
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
    localStorage.setItem("better-jira:defaults:v1",JSON.stringify(defaults));
    set({defaults,perf:"Saved your default in this browser"});
  } catch { set({perf:"Could not save your default in this browser"}); }
}

export async function load() {
  const [boards, issues, defaults]: [Board[], Issue[], Record<number, Display>] = await Promise.all([
    fetch("/api/boards").then((r) => r.json()),
    fetch("/api/issues").then((r) => r.json()),
    Promise.resolve().then(()=>{try{const saved=JSON.parse(localStorage.getItem("better-jira:defaults:v1")??"{}");return saved&&typeof saved==="object"&&!Array.isArray(saved)?Object.fromEntries(Object.entries(saved).map(([id,display])=>[id,parsePreferences({display}).display])):{};}catch{return {};}}),
  ]);
  ME.avatar = issues.find((i) => i.assignee?.id === ME.id)?.assignee?.avatar;
  const preferences = {...state.preferences};
  for (const b of boards) if (!preferences[b.id]) {
    const display = parsePreferences({display:defaults[b.id]}).display;
    if (!defaults[b.id]) display.openIn = state.view;
    preferences[b.id] = {...defaultPreferences(), display};
  }
  const board=boards.some(b=>b.id===state.board)?state.board:boards[0]?.id??state.board;
  set({ boards, board, issues: new Map(issues.map((i) => [i.key, i])), defaults, preferences, view:preferences[board]?.display.openIn ?? "side" });
  if(!navigationReady){restoreNavigation();navigationReady=true;syncNavigation(true);window.addEventListener("popstate",restoreNavigation);}
  void loadProperties();
  clockTimer??=setInterval(()=>set({clock:Date.now()}),60000);
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
export async function loadFull(key: string) {
  if (state.full.has(key)||pendingFull.has(key)) return;
  pendingFull.add(key);
  set({fullErrors:new Map(state.fullErrors).set(key,"")});
  try {
    const res = await fetch(`/api/issues/${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error("Could not load issue details");
    const full = await res.json();
    if (!state.full.has(key)&&state.issues.has(key)) set({ full: new Map(state.full).set(key, full) });
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
const localFields=new Map<string,Set<string>>();
type Snapshot={issue?:Issue;full?:Full};
type Edit={keys:string[];label:string;before:Snapshot[];after:Snapshot[]};
const undo:Edit[]=[],redo:Edit[]=[];
const snapshot=(key:string):Snapshot=>({issue:state.issues.get(key),full:state.full.get(key)});
let transaction:{label:string;before:Map<string,Snapshot>}|null=null;
function record(key:string|string[],label:string,fn:()=>void) {
  const keys=typeof key==="string"?[key]:key;
  const nested=transaction!==null;
  transaction??={label,before:new Map()};
  for(const key of keys)if(!transaction.before.has(key))transaction.before.set(key,snapshot(key));
  if(nested){fn();return;}
  try {
    fn();
    const changed=[...transaction.before.keys()].filter(key=>{const before=transaction!.before.get(key)!,after=snapshot(key);return before.issue!==after.issue||before.full!==after.full;});
    if(!changed.length)return;
    undo.push({keys:changed,label,before:changed.map(key=>transaction!.before.get(key)!),after:changed.map(snapshot)});
    if(undo.length>100)undo.shift();
    redo.length=0;
    set({undoCount:undo.length,redoCount:0});
  } finally {transaction=null;}
}
function restore(edit:Edit,snapshots:Snapshot[]) {
  const issues=new Map(state.issues),full=new Map(state.full);
  edit.keys.forEach((key,index)=>{
    const snapshot=snapshots[index]!;
    if(snapshot.issue)issues.set(key,snapshot.issue);else issues.delete(key);
    if(snapshot.full)full.set(key,snapshot.full);else full.delete(key);
  });
  set({issues,full,overlay:null,...(state.selected&&!issues.has(state.selected)?{selected:null,panel:false}:{})});
}
export function undoEdit() {
  const edit=undo.pop();if(!edit)return;
  restore(edit,edit.before);redo.push(edit);
  set({undoCount:undo.length,redoCount:redo.length,perf:`Undid ${edit.label}`});
}
export function redoEdit() {
  const edit=redo.pop();if(!edit)return;
  restore(edit,edit.after);undo.push(edit);
  set({undoCount:undo.length,redoCount:redo.length,perf:`Redid ${edit.label}`});
}
export function beginCreate(draft:IssueDraft={}) {
  const prefs=preferencesFor(state.board),board=state.boards.find(b=>b.id===state.board);
  const status=prefs.scope==="active"?board?.columns.find(c=>!/backlog/i.test(c.name)&&c.statuses.some(s=>s.category!=="done"))?.statuses.find(s=>s.category!=="done")?.id:undefined;
  set({draft:{...(status?{status}:{}),...(state.mine?{assignee:ME}:{}),...draft},overlay:"create"});
}
function readSavedViews():SavedView[] {
  try {
    const items=JSON.parse(localStorage.getItem("better-jira:saved-views:v1")??"[]");
    return Array.isArray(items)?items.filter(v=>v&&typeof v.id==="string"&&typeof v.name==="string"&&v.name.trim()&&typeof v.board==="number").map(v=>({...v,preferences:parsePreferences(v.preferences),mine:v.mine===true})):[];
  }catch{return [];}
}
function readFavorites():string[] {try{const values=JSON.parse(localStorage.getItem("better-jira:favorites:v1")??"[]");return Array.isArray(values)?values.filter(v=>typeof v==="string"):[];}catch{return [];}}
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
    localFields.set(key,new Set([...(localFields.get(key)??[]),...Object.keys(patch)]));
    set({ issues: new Map(state.issues).set(key, { ...i, ...patch, updated: now() }) });
  }
}

function patchFields(key: string, fn: (fields: any) => object) {
  const f = state.full.get(key);
  if (f) set({ full: new Map(state.full).set(key, { ...f, fields: { ...f.fields, ...fn(f.fields) } }) });
}

export const boardOf = (key: string) => state.boards.find((b) => b.id === state.issues.get(key)?.board);

let localSeq = 0;

// Issue edits stay in this browser session and reset on reload.
export const actions = {
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
  description(key: string, text: string) {
    const previous=adfToText(state.full.get(key)?.fields.description);
    if(text.trim()===previous.trim()){set({editDesc:false});return;}
    timed(`edit ${key} description`, () => record(key,`description on ${key}`,() => {
      patchFields(key, () => ({ description: text.trim() ? textToAdf(text) : null }));
      patchIssue(key, {description:text.trim(),descriptionHistory:[...(state.issues.get(key)?.descriptionHistory??[]),{text:previous,at:now()}]});
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
    const board = state.boards.find((b) => b.id === state.board);
    const statuses=board?.columns.flatMap(c=>c.statuses)??[];
    const status = statuses.find(s=>s.id===draft.status)??statuses[0];
    if (!board || !status || !summary.trim()) return;
    const prefix = [...state.issues.values()].find((i) => i.board === board.id)?.key.split("-")[0]??"LOCAL";
    const key = `${prefix}-NEW${++localSeq}`;
    timed(`create ${key}`, () => record(key,`create ${key}`,() => {
      const issue: Issue = {
        key, board: board.id, summary: summary.trim(), type: "Task", priority: "Normal",
        assignee: null, labels: [], rank: "0", comments: 0, updated: now(),
        created: now(), statusSince:now(), creator: ME, milestones:[],prCount:0,watchers:[],watchersComplete:true, project: [...state.issues.values()].find(i=>i.board === board.id)?.project,
        ...draft, status:status.id, resolved:status.category==="done"?now():null,
      };
      const full: Full = {
        key,
        fields: {
          description: draft.description?.trim()?textToAdf(draft.description):null, created: now(), comment: { comments: [], total: 0 },
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
    return actions.create(`${issue.summary} (copy)`,{status:issue.status,assignee:issue.assignee,priority:issue.priority,labels:[...issue.labels],project:issue.project,milestones:issue.milestones,due:issue.due,parent:issue.parent,type:issue.type,description:issue.description??adfToText(state.full.get(key)?.fields.description)});
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
