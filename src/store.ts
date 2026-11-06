import { useSyncExternalStore } from "react";
import { textToAdf } from "./adf";
import { defaultPreferences, parsePreferences, type Display, type Preferences } from "./view-model";

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
};
export type Status = { id: string; name: string; category: string };
export type Column = { name: string; statuses: Status[] };
export type Board = { id: number; name: string; columns: Column[] };
/** Raw Jira issue: { key, fields: { description, comment, reporter, created, ... } } */
export type Full = { key: string; fields: any };
type Overlay = null | "palette" | "assign" | "status" | "create";
export type View = "side" | "page";

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
    const res = await fetch(`/api/view-defaults/${board}`, {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(display)});
    if (!res.ok) throw new Error("save failed");
    set({defaults:{...state.defaults,[board]:display},perf:"Saved default for everyone using this BetterJira server"});
  } catch { set({perf:"Could not save the default. Your personal view is still saved."}); }
}

export async function load() {
  const [boards, issues, defaults]: [Board[], Issue[], Record<number, Display>] = await Promise.all([
    fetch("/api/boards").then((r) => r.json()),
    fetch("/api/issues").then((r) => r.json()),
    fetch("/api/view-defaults").then(r=>r.ok?r.json():{}).catch(()=>({})),
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

export async function loadFull(key: string) {
  if (state.full.has(key)) return;
  const res = await fetch(`/api/issues/${key}`);
  if (!res.ok) return;
  const full = await res.json(); // await before copying state.full, or parallel prefetches overwrite each other
  if (!state.full.has(key)) set({ full: new Map(state.full).set(key, full) });
}

/** Time from the action to the next painted frame, shown in the header. */
export function timed(label: string, fn: () => void) {
  const t0 = performance.now();
  fn();
  requestAnimationFrame(() => setTimeout(() => set({ perf: `${label} · ${(performance.now() - t0).toFixed(1)}ms` })));
}

const now = () => new Date().toISOString();

function patchIssue(key: string, patch: Partial<Issue>) {
  const i = state.issues.get(key);
  if (i) set({ issues: new Map(state.issues).set(key, { ...i, ...patch, updated: now() }) });
}

function patchFields(key: string, fn: (fields: any) => object) {
  const f = state.full.get(key);
  if (f) set({ full: new Map(state.full).set(key, { ...f, fields: { ...f.fields, ...fn(f.fields) } }) });
}

export const boardOf = (key: string) => state.boards.find((b) => b.id === state.issues.get(key)?.board);

let localSeq = 0;

// ponytail: writes are local only (lost on reload). Step 2 sends each one to Jira and reverts on failure.
export const actions = {
  patch(key: string, patch: Partial<Pick<Issue,"priority" | "type" | "labels" | "parent">>) {
    timed(`edit ${key}`,()=>patchIssue(key,patch));
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
      patchIssue(key, { status: s.id, statusSince:now(), started:i.started??(s.category === "indeterminate"?now():undefined), resolved: s.category === "done" ? (i.resolved ?? now()) : null }),
    );
  },
  assign(key: string, user: User | null) {
    timed(`assign ${key} → ${user?.name ?? "Unassigned"}`, () => {
      patchIssue(key, { assignee: user });
      set({ overlay: null });
    });
  },
  summary(key: string, summary: string) {
    if (summary.trim() && summary !== state.issues.get(key)?.summary)
      timed(`edit ${key} summary`, () => patchIssue(key, { summary: summary.trim() }));
  },
  description(key: string, text: string) {
    timed(`edit ${key} description`, () => {
      patchFields(key, () => ({ description: text.trim() ? textToAdf(text) : null }));
      patchIssue(key, {description:text.trim()});
      set({ editDesc: false });
    });
  },
  comment(key: string, text: string) {
    if (!text.trim()) return;
    timed(`comment on ${key}`, () => {
      const c = {
        id: `local-${++localSeq}`,
        author: { accountId: ME.id, displayName: ME.name, avatarUrls: { "24x24": ME.avatar } },
        body: textToAdf(text),
        created: now(),
      };
      patchFields(key, (f) => ({ comment: { ...f.comment, comments: [...f.comment.comments, c], total: f.comment.total + 1 } }));
      patchIssue(key, { comments: (state.issues.get(key)?.comments ?? 0) + 1 });
    });
  },
  create(summary: string) {
    const board = state.boards.find((b) => b.id === state.board);
    const status = board?.columns[0]?.statuses[0];
    if (!board || !status || !summary.trim()) return;
    const prefix = [...state.issues.values()].find((i) => i.board === board.id)?.key.split("-")[0];
    const key = `${prefix}-NEW${++localSeq}`;
    timed(`create ${key}`, () => {
      const issue: Issue = {
        key, board: board.id, summary: summary.trim(), status: status.id, type: "Task", priority: "Normal",
        assignee: null, labels: [], rank: "0", comments: 0, updated: now(), resolved: null,
        created: now(), statusSince:now(), creator: ME, milestones:[],prCount:0,watchers:[],watchersComplete:true, project: [...state.issues.values()].find(i=>i.board === board.id)?.project,
      };
      const full: Full = {
        key,
        fields: {
          description: null, created: now(), comment: { comments: [], total: 0 },
          reporter: { accountId: ME.id, displayName: ME.name, avatarUrls: { "24x24": ME.avatar } },
        },
      };
      set({
        issues: new Map(state.issues).set(key, issue),
        full: new Map(state.full).set(key, full),
        selected: key, panel: true, overlay: null,
      });
    });
  },
};
