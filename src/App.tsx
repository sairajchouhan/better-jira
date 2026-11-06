import "@fontsource-variable/inter";
import "./index.css";
import {useHotkey} from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Adf, adfToText } from "./adf";
import { normalizeDocument, type AdfDocument } from "./document";
import { Icon, Label, PriorityIcon, StatusIcon, TypeDot } from "./icons";
import {
  ME, actions, boardOf, get, load, loadFull, navigate, set, timed, ui, useStore, dismissRecoveryNotice,
  openSavedView, beginCreate, changeDisplay, changePreferences, downloadLocalBackup, flushLocalChanges, issueURL, isLocalIssue, retryLocalStorage, toggleFavorite, undoEdit, redoEdit, usePreferences, type Board, type Column, type Issue, type User,
} from "./store";

import { BoardControls, FilterChips } from "./view-controls";
import { buckets, columnInScope, draftForGroup, rankBetween, listRows, navigationIssues, selectIssues, statusDuration, type Bucket, type Display, type Grouping, type Property } from "./view-model";
import { BoardDetails, CreateIssue, Favorites, GroupMenu, IssueOptions, Modal, PersonalIssueDetails, PropertyPicker, Relations, SavedViews, SaveViewButton } from "./personal-controls";
import { RichEditor } from "./rich-editor-loader";
import {HelpMenu,ShortcutHelp,runShortcut,shortcutLabel,shortcuts,useLinearHotkeys} from "./shortcuts";
import { issueAnchor } from "./menu-surface";
import { createActor } from "xstate";
import { autosaveMachine, inspector } from "./machines";

/** The active board's visible columns, for keyboard navigation and the issue page's ↑ ↓ stepping. */
const nav = { cols: [] as Issue[][] };
const flatNav=()=>navigationIssues(nav.cols);

const statusOf = (i: Issue) => boardOf(i.key)?.columns.flatMap((c) => c.statuses).find((s) => s.id === i.status);
const colLook = (c: Column) => ({ name: c.name, category: c.statuses[0]?.category ?? "new" });

export function App() {
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const overlay = useStore((s) => s.overlay);
  const open = useStore((s) => (s.panel && s.selected ? s.issues.get(s.selected) : undefined));
  const current = useStore((s) => (s.selected ? s.issues.get(s.selected) : undefined));
  const loadError=useStore(s=>s.loadError);
  const visited=useRef(new Set<number>());visited.current.add(boardId);

  useEffect(() => void load(), []);
  useLinearHotkeys(()=>nav.cols);

  if (!boards.length) return <div className="p-6 text-fg-3">{loadError?<div role="alert"><p>{loadError}</p><button className="mt-3 rounded bg-sel px-3 py-2 text-fg" onClick={()=>void load()}>Retry loading</button></div>:"Loading your Jira mirror…"}</div>;
  const page = !!open && view === "page";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
      <Sidebar boards={boards} />
      <main className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[0.5px] border-frame bg-panel shadow-(--frame-shadow)">
        {!page && <BoardHeader />}
        <div className="flex min-h-0 flex-1">
          {/* Retain visited boards for scroll restoration; do not render unopened boards. */}
          {boards.filter(b=>visited.current.has(b.id)).map((b) => (
            <BoardView key={b.id} board={b} active={b.id === boardId} shown={!page && b.id === boardId} selected={selected} />
          ))}
          {open && <IssueView key={open.key} issue={open} page={page} />}
        </div>
      </main>
      </div>
      <StorageNotice/><StatusBar /><Toast/>
      {(overlay === "palette"||overlay==="search") && <Palette searchOnly={overlay==="search"}/> }
      {overlay==="shortcuts"&&<ShortcutHelp/>}
      {overlay==="help"&&<HelpMenu/>}
      {(overlay==="favorites"||overlay==="views"||overlay==="boards")&&<QuickNavigation kind={overlay}/>}
      {overlay === "assign" && selected && <AssignPicker issueKey={selected} />}
      {overlay === "status" && selected && <StatusPicker issueKey={selected} />}
      {overlay === "create" && <CreateIssue />}
      {current && (overlay === "priority" || overlay === "labels" || overlay === "project" || overlay === "milestone" || overlay === "due") && <PropertyPicker issue={current} field={overlay}/>}
      {open && overlay === "options" && <IssueOptions issue={open}/>}
      {current && overlay === "relations" && <Relations issue={current}/>}
    </div>
  );
}

function BoardView({ board, active, shown, selected }: { board: Board; active: boolean; shown: boolean; selected: string | null }) {
  const issues = useStore(s=>s.issues);
  const mine = useStore(s=>s.mine);
  const query = useStore(s=>s.query);
  const details=useStore(s=>s.details);
  const panel=useStore(s=>s.panel);
  const prefs = usePreferences(board.id);
  const d = prefs.display;
  const [expanded,setExpanded] = useState<string[]>([]);
  const [hiddenOpen,setHiddenOpen] = useState(true);
  const all = useMemo(()=>[...issues.values()],[issues]);
  const visible = useMemo(()=>selectIssues(all,board,prefs,mine,query,ME.id),[all,board,prefs,mine,query]);
  const universe = useMemo(()=>all.filter(i=>i.board===board.id),[all,board]);
  const columns = useMemo(()=>buckets(visible,d.columns,board,universe,d.groupDescending).filter(c=>d.columns!=="status"||columnInScope(board.columns.find(x=>x.name===c.id),prefs.scope)),[visible,d,board,universe,prefs.scope]);
  const hiddenIds=prefs.hidden[d.columns]??[];
  const collapsed=prefs.collapsed[d.columns]??[];
  const hidden = columns.filter(c=>hiddenIds.includes(c.id)||!d.emptyGroups&&!c.issues.length&&!expanded.includes(c.id));
  const show = columns.filter(c=>!hidden.includes(c));
  const rows = useMemo(()=>buckets(visible,d.rows,board,visible),[visible,d.rows,board]);
  const navColumns = d.layout === "list" ? [show.filter(c=>!collapsed.includes(c.id)).flatMap(c=>buckets(c.issues,d.rows,board,c.issues).flatMap(r=>listRows(r.issues,universe,d.subIssues?d.nested:"none").map(row=>row.issue)))] : show.map(c=>rows.flatMap(r=>c.issues.filter(i=>r.issues.includes(i))));
  if (active) nav.cols = navColumns.map(c=>[...new Map(c.map(i=>[i.key,i])).values()]);
  useEffect(()=>setExpanded([]),[d.emptyGroups,d.columns]);
  useEffect(() => {
    if (!active || !selected) return;
    if(!get().fullErrors.get(selected))loadFull(selected);
    const flat = navColumns.flat();
    const i = flat.findIndex((x) => x.key === selected);
    if (i >= 0) for (const offset of [-2, -1, 1, 2]) flat[i+offset] && loadFull(flat[i+offset]!.key);
  }, [active, selected, visible]);

  const hide=(id:string)=>changePreferences(board.id,{hidden:{...prefs.hidden,[d.columns]:[...hiddenIds,id]}});
  const reveal=(id:string)=>{changePreferences(board.id,{hidden:{...prefs.hidden,[d.columns]:hiddenIds.filter(x=>x!==id)}});setExpanded([...expanded,id]);};
  const collapse=(id:string)=>changePreferences(board.id,{collapsed:{...prefs.collapsed,[d.columns]:collapsed.includes(id)?collapsed.filter(x=>x!==id):[...collapsed,id]}});
  const createIn=(bucket:Bucket,row?:Bucket)=>beginCreate({...draftForGroup(d.columns,bucket.id,board,universe,prefs.scope),...(row?draftForGroup(d.rows,row.id,board,universe,prefs.scope):{})});
  return <div className={`${shown?"flex":"hidden"} min-w-0 min-h-0 flex-1`}><div className="flex min-w-0 min-h-0 flex-1 flex-col" data-layout={d.layout}>
    {!visible.length&&<div role="status" className="flex shrink-0 items-center justify-center gap-3 py-8 text-fg-3">No issues match this view.<button onClick={()=>ui.send({type:"toolbar.open",toolbar:"filter"})} className="text-fg-2">Edit filters</button></div>}
    {d.layout === "list" ? <div className="flex-1 overflow-auto py-1">
      {show.map(c=><section key={c.id} className="mb-2">
        <GroupHeading bucket={c} collapsed={collapsed.includes(c.id)} toggle={()=>collapse(c.id)} create={()=>createIn(c)}/>
        {!collapsed.includes(c.id)&&buckets(c.issues,d.rows,board,c.issues).filter(r=>r.issues.length).map(r=><div key={r.id}>
          {d.rows!=="none"&&<div className="border-b border-line bg-col px-8 py-2 text-[12px] text-fg-3">{r.name} <span className="ml-2">{r.issues.length}</span></div>}
          <IssueList issues={r.issues} universe={universe} display={d} selected={selected}/>
        </div>)}
      </section>)}
    </div> : <div className="flex min-h-0 flex-1"><div className="min-h-0 min-w-0 flex-1 overflow-auto px-2 pt-1">
      {d.rows!=="none"&&<div className="sticky top-0 z-10 flex w-max gap-4 bg-panel">{show.map(col=><div key={col.id} className="w-[340px] shrink-0 rounded-t-[5px] bg-(--col-top)"><ColumnHeading bucket={col} count={col.issues.length} display={d} hide={()=>hide(col.id)} create={()=>createIn(col)}/></div>)}</div>}
      {rows.filter(r=>d.rows==="none"||r.issues.length).map(row=><div key={row.id} className={d.rows === "none"?"flex h-full min-h-0 gap-4":"mb-4"}>
        {d.rows!=="none"&&<div className="sticky left-0 mb-2 flex items-center gap-2 px-2 py-2 text-fg-3"><span>{row.name}</span><span>{row.issues.length}</span></div>}
        <div className={d.rows === "none"?"contents":"flex gap-4"}>
          {show.map(col=><ColumnView key={col.id} bucket={col} issues={d.rows==="none"?col.issues:col.issues.filter(i=>row.issues.includes(i))} selected={selected} display={d} scroll={d.rows==="none"} header={d.rows==="none"} hide={()=>hide(col.id)} create={()=>createIn(col,d.rows==="none"?undefined:row)} onDrop={(key,before)=>actions.drop(key,board.id,[{by:d.columns,id:col.id},...(d.rows!=="none"?[{by:d.rows,id:row.id}]:[])],d.ordering==="manual"?dropRank((d.rows==="none"?col.issues:col.issues.filter(i=>row.issues.includes(i))).filter(i=>i.key!==key),before,d.descending):undefined)}/>)}
        </div>
      </div>)}
    </div>{d.rows==="none"&&hidden.length>0&&<HiddenColumns columns={hidden} open={hiddenOpen} toggle={()=>setHiddenOpen(!hiddenOpen)} reveal={reveal}/>}</div>}
    {hidden.length>0&&d.layout==="board"&&d.rows==="none"?null:hidden.length>0&&<details open className="shrink-0 border-t border-line px-4 py-2 text-[12px] text-fg-3"><summary className="cursor-pointer">Hidden {d.layout==="board"?"columns":"groups"}</summary><div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{hidden.map(c=><button key={c.id} aria-label={`Show ${c.name}`} className="flex h-8 items-center gap-2 rounded-lg bg-card px-3 text-fg-2 hover:bg-hover" onClick={()=>reveal(c.id)}>{c.status&&<StatusIcon status={c.status}/>}<span>{c.name}</span><span className="text-fg-3">{c.issues.length}</span></button>)}</div></details>}
  </div>{active&&shown&&details&&!panel&&<BoardDetails board={board} issues={visible}/>}</div>;
}

/** The rank for a card dropped before `before` (or at the end) in a column shown in `list` order. */
function dropRank(list:Issue[],before:string|undefined,descending:boolean) {
  const i=list.findIndex(x=>x.key===before),at=i<0?list.length:i,prev=list[at-1]?.rank,next=list[at]?.rank;
  return descending?rankBetween(next,prev):rankBetween(prev,next);
}

/** Linear's "Hidden columns" list: pinned right, 338px, 50px header on the panel colour, 37px rows 10px apart. */
function HiddenColumns({columns,open,toggle,reveal}:{columns:Bucket[];open:boolean;toggle:()=>void;reveal:(id:string)=>void}) {
  return <aside aria-label="Hidden columns" className="mr-3 w-[338px] shrink-0 overflow-y-auto border-l border-line pl-3">
    <div className="flex h-[50px] items-center">
      <button aria-expanded={open} onClick={toggle} className="ml-px flex h-6 items-center gap-1 rounded-full border-[0.5px] border-transparent pr-2 pl-1 text-[12px] font-medium text-fg-2 hover:bg-hover">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" className={`text-fg-3 transition-transform ${open?"rotate-90":""}`}><path d="M6.75194 10.6239C6.41861 10.8183 6 10.5779 6 10.192V5.80802C6 5.42212 6.41861 5.18169 6.75194 5.37613L10.5096 7.56811C10.8404 7.76105 10.8404 8.23895 10.5096 8.43189L6.75194 10.6239Z"/></svg>
        Hidden columns
      </button>
    </div>
    {open&&<div className="flex flex-col gap-2.5 pb-12">{columns.map(c=><button key={c.id} aria-label={`Show ${c.name}`} onClick={()=>reveal(c.id)} className="flex h-[37px] shrink-0 items-center gap-3.5 rounded-lg border-[0.5px] border-hidden-line bg-card px-3 text-left text-[13px] font-medium text-fg shadow-(--hidden-shadow) hover:bg-card-hover">
      {c.status?<StatusIcon status={c.status}/>:<Icon name="layers"/>}<span className="flex-1 truncate">{c.name}</span><span className="font-[450] text-card-fg-3">{c.issues.length}</span>
    </button>)}</div>}
  </aside>;
}

function GroupHeading({bucket,collapsed,toggle,create}:{bucket:Bucket;collapsed:boolean;toggle:()=>void;create:()=>void}) {
  return <div className="flex h-10 items-center gap-2 border-y border-line bg-col px-5 text-[12px] font-medium text-fg-2"><button aria-label={`${collapsed?"Expand":"Collapse"} ${bucket.name}`} aria-expanded={!collapsed} onClick={toggle} className="flex flex-1 items-center gap-2 text-left"><Icon name={collapsed?"chevron":"down"}/>{bucket.status&&<StatusIcon status={bucket.status}/>}<span>{bucket.name}</span><span className="text-fg-3">{bucket.issues.length}</span></button><button aria-label={`New issue in ${bucket.name}`} onClick={create} className={COL_BTN}><Icon name="plus"/></button></div>;
}

function IssueList({issues,universe,display,selected}:{issues:Issue[];universe:Issue[];display:Display;selected:string|null}) {
  return listRows(issues,universe,display.subIssues?display.nested:"none").map(({issue,depth})=><Card key={issue.key} issue={issue} selected={selected === issue.key} display={display} list depth={depth}/>);
}

// --- keyboard ---

function QuickNavigation({kind}:{kind:"favorites"|"views"|"boards"}) {
  const state=useStore(s=>s);
  const close=()=>ui.send({type:"overlay.close"});
  const title=kind==="views"?"Open view":kind==="boards"?"Open a team / board":"Open a favorite";
  const choices=kind==="boards"
    ?state.boards.map(board=>({id:String(board.id),name:board.name,run:()=>navigate({board:board.id,selected:null,panel:false})}))
    :kind==="views"
      ?state.savedViews.map(view=>({id:view.id,name:view.name,run:()=>openSavedView(view)}))
      :state.favorites.flatMap(id=>{
        const issue=state.issues.get(id),[,boardId,scope]=id.split(":"),board=state.boards.find(b=>b.id===Number(boardId));
        if(issue)return [{id,name:`${id} ${issue.summary}`,run:()=>navigate({board:issue.board,selected:issue.key,panel:true})}];
        if(!board)return [];
        return [{id,name:`${board.name}${scope?` · ${scope}`:""}`,run:()=>{
          navigate({board:board.id,selected:null,panel:false});
          if(scope)changePreferences(board.id,{scope:scope==="active"?"active":scope==="backlog"?"backlog":"all"});
        }}];
      });
  return <Modal label={title} close={close}>
    <Command loop>
      <Command.Input autoFocus aria-label="Find view or favorite" placeholder="Search…" className="w-full bg-transparent p-3 outline-none"/>
      <Command.List>
        <Command.Empty className="p-3 text-fg-3">No saved {kind}</Command.Empty>
        {choices.map(choice=><Command.Item key={choice.id} value={choice.name} onSelect={()=>{close();choice.run();}} className="p-2 data-[selected=true]:bg-sel">{choice.name}</Command.Item>)}
      </Command.List>
    </Command>
  </Modal>;
}

// --- chrome ---

function Sidebar({ boards }: { boards: Board[] }) {
  const boardId = useStore((s) => s.board);
  const mine = useStore((s) => s.mine);
  const hidden=useStore(s=>s.sidebarHidden);
  if(hidden)return null;
  return (
    <nav className="flex w-[244px] shrink-0 flex-col gap-px overflow-y-auto p-2 font-medium max-md:hidden">
      <div className="mb-1 flex h-11 items-center gap-2 px-2 text-fg">
        <span className="grid size-[18px] place-items-center rounded-[5px] bg-accent text-[10px] font-semibold text-white">bj</span>
        better-jira
      </div>
      <SideItem onClick={() => runShortcut("search")}>
        <Icon name="search" /> Search <kbd className="ml-auto">/</kbd>
      </SideItem>
      <SideItem onClick={() => beginCreate()}>
        <Icon name="plus" /> New issue <kbd className="ml-auto">C</kbd>
      </SideItem>
      {/* Like Linear, My issues is a sidebar view rather than a tab beside Active/Backlog/All. */}
      <SideItem active={mine} onClick={() => timed("only mine", () => ui.send({ type: "mine.set", mine: !mine }))}>
        <Icon name="user" /> My issues <kbd className="ml-auto">{shortcutLabel("mine")}</kbd>
      </SideItem>

      <div className="mt-5 mb-1 px-2 text-[12px] text-fg-3">Boards</div>
      {boards.map((b) => (
        <SideItem key={b.id} active={b.id === boardId} onClick={() => timed("switch board", () => navigate({ board: b.id, selected: null, panel: false }))}>
          <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-sel text-[9px] font-semibold text-fg-2">{b.name[0]}</span>
          <span className="truncate">{b.name}</span>
        </SideItem>
      ))}
      <SavedViews/>
      <Favorites/>
      <button id="help-menu" aria-label="Open Help menu" onClick={()=>runShortcut("help")} className="mt-auto flex items-center justify-between rounded-lg px-2 py-2 text-fg-3 hover:bg-hover">Help <kbd>?</kbd></button>
    </nav>
  );
}

/** Linear's 28px bottom bar under the sidebar and panel; ours carries the perf readout and the local-only note. */
function Toast() {
  const toast=useStore(s=>s.toast);
  if(!toast)return null;
  return <div aria-live="polite" data-toast className="fixed right-4 bottom-10 z-50 flex items-center gap-3 rounded-lg border border-line-2 bg-card px-3 py-2 text-[13px] text-fg shadow-lg">{toast.text}{toast.key&&<button onClick={()=>(ui.send({type:"toast.dismiss"}),navigate({selected:toast.key,panel:true}))} className="text-accent hover:underline">View issue</button>}</div>;
}

function StatusBar() {
  const perf = useStore((s) => s.perf);
  const undo=useStore(s=>s.undoCount),redo=useStore(s=>s.redoCount);
  const storage=useStore(s=>s.storage);
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 px-4 pb-2 text-[11px] whitespace-nowrap">
      <span title="Issue changes, files, and view preferences are saved in this browser." className="flex min-w-0 items-center gap-1.5 text-amber-500"><span className="size-1.5 shrink-0 rounded-full bg-amber-500" /><span className="truncate">Local only: nothing is sent to Jira</span></span>
      <span role="status" aria-label="Local save status" data-storage-status={storage.status} className="text-fg-3">{storage.status==="saving"?"Saving…":storage.status==="saved"?"Saved locally":storage.status==="loading"?"Opening local data…":"Not saved"}</span>
      <span className="-ml-2 flex">
        <button aria-label="Undo" disabled={!undo} onClick={undoEdit} title="Undo (⌘Z)" className={FOOT_BTN}><Icon name="undo"/></button>
        <button aria-label="Redo" disabled={!redo} onClick={redoEdit} title="Redo (⌘⇧Z)" className={FOOT_BTN}><Icon name="redo"/></button>
        <button aria-label="Download backup" title="Download your local changes and files" onClick={()=>void downloadLocalBackup()} className={FOOT_BTN}><Icon name="download"/></button>
      </span>
      <span className="ml-auto truncate font-mono text-emerald-500">{perf}</span>
    </footer>
  );
}

function StorageNotice() {
  const storage=useStore(s=>s.storage);
  if(storage.status!=="error"&&!storage.recovered)return null;
  return <div role={storage.status==="error"?"alert":"status"} className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-[12px] text-fg-2"><span className="mr-auto">{storage.message}</span>{storage.status==="error"&&<button onClick={()=>void retryLocalStorage()} className="text-accent">Retry local storage</button>}<button onClick={()=>void downloadLocalBackup()} className="text-accent">Download local backup</button>{storage.recovered&&storage.status!=="error"&&<button aria-label="Dismiss local recovery notice" onClick={dismissRecoveryNotice}><Icon name="close"/></button>}</div>;
}

const SideItem = ({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} aria-current={active||undefined} className={`flex h-7 items-center gap-2 rounded-lg pr-[9px] pl-2 text-left ${active ? "bg-sel text-fg" : "text-fg-2 hover:bg-hover"}`}>
    {children}
  </button>
);

// Linear's pill button: 28px, 0.5px ring drawn as a shadow, 12px/500.
const PILL = "flex h-7 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-transparent px-2.5 text-[12px] font-medium";
const CIRCLE = "flex h-7 min-w-7 shrink-0 items-center rounded-full bg-btn text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg-2";

function BoardHeader() {
  const board = useStore((s) => s.boards.find((b) => b.id === s.board));
  const query = useStore((s) => s.query);
  const details=useStore(s=>s.details);
  const prefs=usePreferences(board!.id);
  const finding=useStore(s=>s.findInView);const findRef=useRef<HTMLInputElement>(null);
  useHotkey("Escape",()=>{set({findInView:false});ui.send({type:"query.set",query:""});findRef.current?.blur();},{target:findRef,ignoreInputs:false});
  const favoriteId=`board:${board!.id}`;
  const favorite=useStore(s=>s.favorites.includes(favoriteId));
  return (
    <header className="shrink-0">
      <div className="flex h-11 items-center justify-between border-b-[0.5px] border-frame px-2">
        <div className="flex items-center px-2 text-[13px] font-medium text-fg-2">
          <span className="mr-2.5 grid size-4 place-items-center rounded-[4px] bg-accent text-[9px] font-semibold text-white">{board?.name[0]}</span>
          <span className="truncate">{board?.name}</span>
          <span className="mx-2 -mt-0.5 text-fg-3">›</span>
          <span>Issues</span>
          <button role="switch" aria-label={favorite?"Remove from favorites":"Add to favorites"} aria-checked={favorite} onClick={()=>toggleFavorite(favoriteId)} className={`ml-2 grid size-7 place-items-center rounded-full hover:bg-hover ${favorite?"text-[#f2c94c]":"text-fg-3 hover:text-fg-2"}`}><Icon name={favorite?"starred":"star"} size={16}/></button>
        </div>
        <button aria-label="Search issues" onClick={()=>runShortcut("search")} className={`${COL_BTN} ml-auto md:hidden`}><Icon name="search"/></button>
        <button onClick={() => beginCreate()} className={`${PILL} pr-2.5 pl-2 text-fg-3 hover:bg-hover hover:text-fg-2`}>
          <Icon name="plus" /> New issue
        </button>
      </div>
      <div className="flex min-h-[43.5px] flex-wrap items-center gap-1 px-2 py-1">
        {(["active","backlog","all"] as const).map(scope=><button key={scope} aria-pressed={prefs.scope===scope} onClick={()=>changePreferences(board!.id,{scope})} className={`${PILL} ${prefs.scope===scope?"bg-tab-on text-fg shadow-(--tab-on-shadow)":"bg-tab text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg-2"}`}>{scope==="active"?"Active":scope==="backlog"?"Backlog":"All issues"}</button>)}
        <SaveViewButton/>
        <div className="ml-auto flex items-center gap-1"><BoardControls board={board!}/></div>
        <button aria-label={details?"Close details":"Open details"} aria-expanded={details} title="Board details" onClick={() => (set({details:!details}),navigate({panel:false}))} className={`${CIRCLE} justify-center`}>
          <Icon name="side" />
        </button>
      </div>
      {finding&&<input id="find-in-view" ref={findRef} aria-label="Find in view" autoFocus value={query} onChange={e=>ui.send({type:"query.set",query:e.target.value})} placeholder="Find in view…" className="mx-3 mb-2 rounded border border-line-2 bg-card px-3 py-1.5 outline-none"/>}
      {board&&<FilterChips board={board}/>}
    </header>
  );
}

// --- board ---

// Linear's bottom-bar button: 28px, radius 8, fg-3.
const FOOT_BTN = "grid size-7 place-items-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg-2 disabled:opacity-30 disabled:hover:bg-transparent";
const COL_BTN = "grid size-6 place-items-center rounded-full text-fg-3 hover:bg-hover hover:text-fg";

function ColumnHeading({bucket,count,display,hide,create}:{bucket:Bucket;count:number;display:Display;hide:()=>void;create:()=>void}) {
  return <h2 className="flex h-[46px] shrink-0 items-center gap-2 pr-2 pl-3.5 text-[13px]">
    {bucket.status?<StatusIcon status={bucket.status}/>:display.columns === "priority"?<PriorityIcon name={bucket.name}/>:<Icon name="layers"/>}
    <span className="ml-0.5 truncate font-medium text-fg-2">{bucket.name}</span><span className="text-fg-3">{count}</span>
    <GroupMenu name={bucket.name} hide={hide}/>
    <button aria-label={`New issue in ${bucket.name}`} onClick={create} className={`-ml-1.5 ${COL_BTN}`}><Icon name="plus"/></button>
  </h2>;
}

/** `header={false}` in swimlanes: Linear shows one sticky header row above all lanes. */
function ColumnView({ bucket, issues, selected, display, scroll, onDrop,hide,create,header=true }: { bucket:Bucket; issues:Issue[]; selected:string|null; display:Display; scroll:boolean; onDrop:(key:string,before?:string)=>void;hide:()=>void;create:()=>void;header?:boolean }) {
  const [over,setOver] = useState(false);
  return <section
    onDragOver={e=>{e.preventDefault();setOver(true);}}
    onDragLeave={e=>!e.currentTarget.contains(e.relatedTarget as Node)&&setOver(false)}
    onDrop={e=>{e.preventDefault();setOver(false);const key=e.dataTransfer.getData("text/plain");onDrop(key,[...e.currentTarget.querySelectorAll<HTMLElement>("[data-key]")].find(c=>{const r=c.getBoundingClientRect();return c.dataset.key!==key&&r.top+r.height/2>e.clientY;})?.dataset.key);}}
    className={`flex w-[340px] shrink-0 flex-col rounded-t-[5px] bg-[linear-gradient(var(--col-top),var(--col-top)_46px,var(--col-bottom))] ${over?"ring-1 ring-accent":""}`}
  >
    {header&&<ColumnHeading bucket={bucket} count={issues.length} display={display} hide={hide} create={create}/>}
    <div className={`flex-1 px-[9px] pt-[9px] ${scroll?"overflow-y-auto":""}`}>
      {issues.map(i=><Card key={i.key} issue={i} selected={i.key===selected} display={display}/>)}
    </div>
  </section>;
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });
// Linear's card chip: 24px pill, 0.5px border, 12px/450 muted text after a 14px icon.
const CHIP = "flex h-6 max-w-[224px] shrink-0 items-center rounded-full border-[0.5px] border-chip-line bg-card px-2 text-[12px] font-[450] text-card-fg-3";

const Card = memo(function Card({issue,selected,display:d,list=false,depth=0}:{issue:Issue;selected:boolean;display:Display;list?:boolean;depth?:number}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>void(selected&&ref.current?.scrollIntoView({block:"nearest"})),[selected]);
  const show = (p:Property) => d.properties.includes(p);
  const clock=useStore(s=>d.properties.includes("statusAge")?s.clock:0);
  const status = statusOf(issue);
  const properties = <>
    {show("priority")&&<span title={issue.priority??"No priority"} className={list?"text-fg-3":`${CHIP} px-[4.5px]`}><PriorityIcon name={issue.priority}/></span>}
    {show("type")&&issue.type&&<span className={CHIP}><TypeDot type={issue.type}/><span className="ml-1.5">{issue.type}</span></span>}
    {show("project")&&issue.project&&<span title={issue.project.name} className={CHIP}><Icon name="layers"/><span className="ml-1.5 truncate">{issue.project.name}</span></span>}
    {show("labels")&&issue.labels.slice(0,list?1:2).map(l=><Label key={l} name={l}/>)}
    {show("labels")&&issue.labels.length>(list?1:2)&&<span title={issue.labels.join(", ")} className={CHIP}>+{issue.labels.length-(list?1:2)}</span>}
    {show("comments")&&issue.comments>0&&<span className={CHIP}><Icon name="comment"/><span className="ml-1.5">{issue.comments}</span></span>}
    {show("links")&&!!issue.links?.length&&<span title={issue.links.join("\n")} className={CHIP}><Icon name="external"/><span className="ml-1.5">{issue.links.length}</span></span>}
    {show("creator")&&issue.creator&&<span title={`Created by ${issue.creator.name}`}><Avatar user={issue.creator} size={18}/></span>}
    {show("due")&&issue.due&&<span className={CHIP}><Icon name="calendar"/><span className="ml-1.5">{issue.due}</span></span>}
    {show("milestone")&&issue.milestones?.map(v=><span key={v.id} title={`Jira fix version: ${v.name}`} className={CHIP}><Icon name="layers"/><span className="ml-1.5 truncate">{v.name}</span></span>)}
    {show("statusAge")&&issue.statusSince&&<span className={CHIP} title={`In current status since ${new Date(issue.statusSince).toLocaleString()}`}><Icon name="calendar"/><span className="ml-1.5">{statusDuration(issue.statusSince,Math.max(clock,Date.now()))} in status</span></span>}
    {show("pullRequests")&&<span className={CHIP} title={issue.prCount === undefined?"Pull-request counts have not been shared by Jira":"Pull requests reported by Jira's development summary"}><Icon name="external"/><span className="ml-1.5">{issue.prCount??"—"} PRs</span></span>}
  </>;
  const dates = <>{show("created")&&issue.created&&<span title={`Created ${issue.created}`}>Created {MONTH.format(new Date(issue.created))}</span>}{show("updated")&&<span title={`Updated ${issue.updated}`}>{list?"":"Updated "}{MONTH.format(new Date(issue.updated))}</span>}</>;
  return <div className={list?"[content-visibility:auto] [contain-intrinsic-size:auto_44px]":"pb-2 [contain-intrinsic-size:auto_124px] [content-visibility:auto] [overflow-clip-margin:4px]"}>
    <div ref={ref} data-key={issue.key} data-selected={selected||undefined} role="button" aria-label={`${issue.key} ${issue.summary}`} tabIndex={0} draggable
      onDragStart={e=>e.dataTransfer.setData("text/plain",issue.key)}
      onKeyDown={e=>{if(e.key === "Enter"||e.key === " "){e.preventDefault();e.stopPropagation();navigate({selected:issue.key,panel:true,view:e.key==="Enter"?"page":"side"});}}}
      onClick={()=>timed(`open ${issue.key}`,()=>navigate({selected:issue.key,panel:true}))}
      className={list?`flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-5 outline-none focus-visible:ring-1 focus-visible:ring-accent ${selected?"bg-hover shadow-[inset_2px_0_0_var(--accent)]":"hover:bg-hover"}`:`relative flex min-h-[42px] cursor-pointer flex-col rounded-lg p-2 shadow-(--card-shadow) outline-none focus-visible:ring-1 focus-visible:ring-accent ${selected?"bg-card-hover ring-1 ring-accent":"bg-card hover:bg-card-hover"}`}
      style={list&&depth?{paddingLeft:20+depth*20}:undefined}>
      {list?<>
        {show("id")&&<span className="w-[85px] shrink-0 text-[12px] text-fg-3 tabular-nums">{depth>0&&"↳ "}{issue.key}</span>}
        {show("status")&&status&&<span title={status.name}><StatusIcon status={status}/></span>}
        <span className="min-w-32 flex-1 truncate font-medium">{issue.summary}</span>
        <span className="flex max-w-[45%] shrink-0 items-center gap-2 overflow-hidden">{properties}</span>
        {show("assignee")&&<Avatar user={issue.assignee} size={18}/>}
        <span className="flex shrink-0 gap-2 text-[11px] text-fg-3">{dates}</span>
      </>:<>
        <div className="flex flex-col gap-1.5 pr-[34px] pl-1">
          {show("id")&&<span className="truncate text-[12px] leading-[normal] font-[450] tracking-[-0.24px] text-card-fg-3 tabular-nums">{issue.key}</span>}
          <div className="flex items-start gap-1.5">{show("status")&&status&&<span className="mt-px" title={status.name}><StatusIcon status={status}/></span>}<span className="line-clamp-2 text-[13px] leading-4 font-medium [overflow-wrap:anywhere]">{issue.summary}</span></div>
        </div>
        {show("assignee")&&<span className="absolute top-2 right-2"><Avatar user={issue.assignee} size={18}/></span>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1 overflow-hidden">{properties}</div>
        {(show("updated")||show("created"))&&<div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-3 pl-px text-[12px] font-[450] text-card-fg-3">{dates}</div>}
      </>}
    </div>
  </div>;
});

function Avatar({ user, size = 20 }: { user: User | null; size?: number }) {
  const [broken, setBroken] = useState(false); // Jira's default avatars need a Jira login, so they fail here
  useEffect(()=>setBroken(false),[user?.avatar]);
  const box = { width: size, height: size };
  if (!user) return <span title="Unassigned" className="inline-block shrink-0 rounded-full border border-dashed border-fg-4" style={box} />;
  if (!user.avatar || broken)
    return <span title={user.name} className="inline-grid shrink-0 place-items-center rounded-full bg-sel text-[10px] text-fg-2" style={box}>{user.name[0]}</span>;
  return <img src={user.avatar} onError={() => setBroken(true)} title={user.name} alt="" width={size} height={size} className="inline-block shrink-0 rounded-full" />;
}

const ago = (iso: string) => {
  const m = (Date.parse(iso) - Date.now()) / 60_000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (m > -60) return rtf.format(Math.round(m), "minute");
  if (m > -1440) return rtf.format(Math.round(m / 60), "hour");
  if (m > -43200) return rtf.format(Math.round(m / 1440), "day");
  return new Date(iso).toLocaleDateString();
};

const author = (a: any): User | null => a && { id: a.accountId, name: a.displayName, avatar: a.avatarUrls?.["24x24"] };

// --- issue view: side panel or full page ---

const ICON_BTN = "grid size-7 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg";

function IssueView({ issue, page }: { issue: Issue; page: boolean }) {
  const f = useStore((s) => s.full.get(issue.key))?.fields;
  const favorite=useStore(s=>s.favorites.includes(issue.key));
  const propertiesHidden=useStore(s=>s.issuePropertiesHidden);
  const bar = (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3 text-[12px] text-fg-3">
      <TypeDot type={issue.type} />
      {page && <span className="truncate">{boardOf(issue.key)?.name} ›</span>}
      <a className="tracking-[-0.24px] text-fg-2 hover:text-fg" href={issueURL(issue)} target="_blank" rel="noreferrer">{issue.key}</a>
      {issue.parent && <span className="truncate">· parent {issue.parent}</span>}
      <span className="flex-1" />
      <button role="switch" aria-label={favorite?"Remove issue from favorites":"Add issue to favorites"} aria-checked={favorite} onClick={()=>toggleFavorite(issue.key)} className={`${ICON_BTN} ${favorite?"text-[#f2c94c]!":""}`}><Icon name={favorite?"starred":"star"} size={16}/></button>
      <button id="issue-options" aria-label="Issue options" onClick={()=>ui.send({type:"overlay.open",overlay:"options"})} className={ICON_BTN}><Icon name="dots"/></button>
      <Stepper issueKey={issue.key} />
      <button title={page ? "Open in side panel" : "Open as full page"} onClick={() => navigate({ view: page ? "side" : "page" })} className={ICON_BTN}>
        <Icon name={page ? "side" : "expand"} />
      </button>
      <button title="Close (esc)" onClick={() => navigate({ panel: false })} className={ICON_BTN}><Icon name="close" /></button>
    </div>
  );

  if (!page)
    return (
      <aside className="flex w-[520px] max-w-full shrink-0 flex-col border-l border-line bg-panel max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full">
        {bar}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Title issue={issue} className="text-[17px]" />
          {!propertiesHidden&&<div className="mt-3"><Properties issue={issue} /></div>}
          <Description issue={issue} f={f} />
          <PersonalIssueDetails issue={issue}/>
          <Activity issue={issue} f={f} />
        </div>
      </aside>
    );
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {bar}
      <div className="flex min-h-0 flex-1 max-md:flex-col max-md:overflow-y-auto">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-10 py-8">
            <Title issue={issue} className="text-[24px]" />
            <Description issue={issue} f={f} />
            <PersonalIssueDetails issue={issue}/>
            <Activity issue={issue} f={f} />
          </div>
        </div>
        {!propertiesHidden&&<div className="w-[300px] shrink-0 overflow-y-auto border-l border-line p-3 max-md:w-full"><Properties issue={issue} /></div>}
      </div>
    </div>
  );
}

/** ↑ ↓ (or j / k) step through the board's visible issues without leaving the issue, like Linear (no "n / total"). */
function Stepper({ issueKey }: { issueKey: string }) {
  useStore((s) => s.issues); // re-render when the list changes; nav.cols is rebuilt by the board in the same render
  useStore((s) => s.mine);
  useStore((s) => s.query);
  useStore((s) => s.preferences);
  const flat = flatNav();
  const i = flat.findIndex((x) => x.key === issueKey);
  return (
    <div className="mr-1 flex items-center gap-0.5">
      <button disabled={i<=0} title="Previous (K / ↑)" onClick={() => runShortcut("up")} className={`${ICON_BTN} disabled:opacity-30`}><Icon name="up" /></button>
      <button disabled={i<0||i>=flat.length-1} title="Next (J / ↓)" onClick={() => runShortcut("down")} className={`${ICON_BTN} disabled:opacity-30`}><Icon name="down" /></button>
    </div>
  );
}

function Title({ issue, className }: { issue: Issue; className: string }) {
  return (
    <textarea
      id="summary"
      aria-label="Issue title"
      key={issue.summary}
      defaultValue={issue.summary}
      rows={1}
      onBlur={(e) => actions.summary(issue.key, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.preventDefault(), e.currentTarget.blur());
        if (e.key === "Escape") {e.currentTarget.value = issue.summary;e.currentTarget.blur();}
      }}
      className={`w-full resize-none rounded-md bg-transparent font-semibold leading-snug text-fg outline-none [field-sizing:content] focus:bg-hover ${className}`}
    />
  );
}

/** Linear's property list: unlabelled 13px/500 rows under section headings, no box and no Reporter/Created/Updated rows. */
function Properties({ issue }: { issue: Issue }) {
  const status = statusOf(issue);
  const btn = (id: string, hint: string, overlay: "status" | "assign" | "priority" | "labels" | "project" | "milestone" | "due", label: string, body: ReactNode) => (
    <button id={id} title={`${label}${({status:"status",assign:"assign",priority:"priority",labels:"labels",project:"project",milestone:"milestone",due:"due"} as Record<string,string>)[overlay]?` (${shortcutLabel(overlay==="assign"?"assign":overlay)})`:""}`} onClick={() => ui.send({ type: "overlay.open", overlay })} className="group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-fg-2 hover:bg-hover hover:text-fg">
      {body}
      <kbd className="ml-auto opacity-0 group-hover:opacity-100">{hint}</kbd>
    </button>
  );
  const section = (name: string, rows: ReactNode) => <section className="mb-3"><h3 className="flex h-7 items-center px-2 text-[12px] font-medium text-fg-3">{name}</h3>{rows}</section>;
  return (
    <div data-properties className="text-[13px] font-medium">
      {section("Properties", <>
        {btn("prop-status", "S", "status", "Status", <>{status && <StatusIcon status={status} />}<span className="truncate">{status?.name}</span></>)}
        {btn("prop-priority", "P", "priority", "Priority", <><PriorityIcon name={issue.priority}/>{issue.priority ?? "No priority"}</>)}
        {btn("prop-assignee", "A", "assign", "Assignee", <><Avatar user={issue.assignee} size={18} /><span className="truncate">{issue.assignee?.name ?? "Unassigned"}</span></>)}
        {btn("prop-due", "", "due", "Due date", <><Icon name="calendar"/><span className={issue.due ? "" : "text-fg-3"}>{issue.due ?? "Set due date"}</span></>)}
      </>)}
      {section("Labels", btn("prop-labels", "L", "labels", "Labels", <><Icon name="label"/><span className={`truncate ${issue.labels.length ? "" : "text-fg-3"}`}>{issue.labels.join(", ") || "Add label"}</span></>))}
      {section("Project", <>
        {btn("prop-project", "", "project", "Project", <><Icon name="layers"/><span className="truncate">{issue.project?.name ?? "Add to project"}</span></>)}
        {btn("prop-milestone", "", "milestone", "Milestone", <><Icon name="calendar"/><span className={`truncate ${issue.milestones?.length ? "" : "text-fg-3"}`}>{issue.milestones?.map(m => m.name).join(", ") || "Set milestone"}</span></>)}
      </>)}
    </div>
  );
}

/** Edited in place like Linear: changes save 600ms after typing stops and on blur, so a reload never loses them. */
function Description({ issue, f }: { issue: Issue; f: any }) {
  const focus = useStore((s) => s.editDesc);
  const error=useStore(s=>s.fullErrors.get(issue.key));
  const stored=f?JSON.stringify(normalizeDocument(f.description??"")):"";
  const shown=useRef(stored);
  const [revision,setRevision]=useState(0);
  const draftKey=`better-jira:description-draft:${get().namespace}:${issue.key}`;
  const [autosave]=useState(()=>createActor(autosaveMachine.provide({actions:{
    keepDraft:(_,doc)=>{try{localStorage.setItem(draftKey,JSON.stringify(doc));}catch{/* autosave still runs */}},
    commit:(_,doc)=>{
      if(!doc)return;
      shown.current=JSON.stringify(normalizeDocument(doc));actions.description(issue.key,doc);
      void flushLocalChanges().then(()=>{try{if(autosave.getSnapshot().matches("clean"))localStorage.removeItem(draftKey);}catch{/* best effort */}});
    },
  }}),{inspect:inspector(`autosave ${issue.key}`)}).start());
  // Undo, redo or a restored revision replaces the document under the editor, so show the stored version.
  useEffect(()=>{if(stored&&stored!==shown.current){shown.current=stored;setRevision(r=>r+1);}},[stored]);
  // A reload in the autosave window leaves the typed draft in localStorage; save it now.
  useEffect(()=>{if(!f)return;try{const draft=localStorage.getItem(draftKey);if(draft){autosave.send({type:"change",doc:JSON.parse(draft)});autosave.send({type:"flush"});setRevision(r=>r+1);}}catch{/* ignore a broken draft */}},[!!f]);
  useEffect(()=>()=>autosave.send({type:"flush"}),[]);
  useEffect(()=>{
    if(!focus||!f)return;ui.send({type:"description.editDone"});
    let tries=0;const go=()=>{const editor=document.getElementById("description");if(editor)editor.focus();else if(tries++<60)requestAnimationFrame(go);};go();
  },[focus,!!f]);
  return (
    <section className="mt-5 leading-[1.6] text-fg-2">
      {!f ? <p role="status" className="text-fg-4">{error?<>{error}. <button onClick={()=>void loadFull(issue.key)} className="text-accent">Retry</button></>:"Loading…"}</p>
        : <RichEditor key={revision} id="description" inline initial={f.description} placeholder="Add description…"
            onChange={doc=>autosave.send({type:"change",doc})}
            onBlur={()=>autosave.send({type:"flush"})}/>}
    </section>
  );
}

function Activity({ issue, f }: { issue: Issue; f: any }) {
  const [composer,setComposer]=useState(0),[editing,setEditing]=useState<string|null>(null);
  if (!f) return null;
  return (
    <section className="mt-8 border-t border-line pt-5">
      <h3 className="mb-3 font-medium text-fg">Activity</h3>
      <ol className="space-y-3">
        <li className="flex items-center gap-2 px-1 text-[12px] text-fg-3">
          <Avatar user={author(f.reporter)} size={16} />
          <span className="text-fg-2">{f.reporter?.displayName}</span> created the issue · {ago(f.created)}
        </li>
        {f.comment.comments.map((c: any) => (
          <li key={c.id} data-comment={c.id} className="rounded-lg border border-line-2 bg-card px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12px]">
              <Avatar user={author(c.author)} size={18} />
              <span className="font-medium text-fg">{c.author?.displayName}</span>
              <span className="text-fg-3">{ago(c.created)}{c.updated&&" · edited"}</span>
              {String(c.id).startsWith("local-")&&editing!==c.id&&<span className="ml-auto flex gap-1"><button aria-label="Edit comment" onClick={()=>setEditing(c.id)} className="rounded px-1.5 text-fg-3 hover:bg-hover hover:text-fg">Edit</button><button aria-label="Delete comment" onClick={()=>actions.deleteComment(issue.key,c.id)} className="rounded px-1.5 text-fg-3 hover:bg-hover hover:text-fg">Delete</button></span>}
            </div>
            <div className="mt-1.5 leading-[1.6] text-fg-2">{editing===c.id
              ?<RichEditor id={`edit-${c.id}`} label="Edit comment" autoFocus initial={c.body} saveLabel="Save comment" onSave={doc=>{actions.editComment(issue.key,c.id,doc);setEditing(null);}} onCancel={()=>setEditing(null)}/>
              :<Adf node={c.body} />}</div>
          </li>
        ))}
      </ol>
      <div className="mt-3">
        {/* A new key clears the box after sending; autoFocus keeps the caret in it. */}
        <RichEditor key={composer} initial="" id="comment" label="Leave a comment…" placeholder="Leave a comment…" autoFocus={composer>0} saveLabel="Submit comment" hint="⌘↵ send" onSave={doc=>{if(actions.comment(issue.key,doc))setComposer(n=>n+1);}}/>
      </div>
    </section>
  );
}

// --- overlays: palette, pickers next to their property, create ---

const MENU =
  "overflow-hidden rounded-xl border border-line-2 bg-card text-fg-2 shadow-[0_12px_40px_rgb(0_0_0/0.35)] " +
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-fg-3 " +
  "[&_[cmdk-item]]:flex [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2 " +
  "[&_[cmdk-item][data-selected=true]]:bg-sel [&_[cmdk-item][data-selected=true]]:text-fg";
const MENU_INPUT = "h-11 w-full border-b border-line bg-transparent px-3.5 text-fg outline-none placeholder:text-fg-4";
const close = (e: React.MouseEvent) => e.target === e.currentTarget && ui.send({type:"overlay.close"});

function Overlay({ children,label="Search issues and commands" }: { children: ReactNode;label?:string }) {
  return <Modal label={label} close={()=>ui.send({type:"overlay.close"})}>{children}</Modal>;
}

/** Opens under the property in the issue view, else under the selected card, else centered. */
function Popover({ issueKey, prop, children }: { issueKey: string; prop: string; children: ReactNode }) {
  return <Modal label={prop==="status"?"Change status":"Assign issue"} close={()=>ui.send({type:"overlay.close"})} anchor={issueAnchor(`prop-${prop}`,issueKey)} width={340}>{children}</Modal>;
}

function StatusPicker({ issueKey }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(issueKey));
  const board = boardOf(issueKey);
  if (!issue || !board) return null;
  return (
    <Popover issueKey={issueKey} prop="status">
      <Command
        loop
        defaultValue={statusOf(issue)?.name}
        className={MENU}
      >
        <Command.Input autoFocus placeholder="Change status…" className={MENU_INPUT} />
        <Command.List className="max-h-[340px] overflow-y-auto p-1">
          <Command.Empty className="p-3 text-fg-3">No status</Command.Empty>
          {board.columns.map((c, ci) =>
            c.statuses.map((s, si) => (
              <Command.Item key={s.id} value={s.name} keywords={[c.name]} onSelect={() => actions.status(issueKey, s.id)}>
                <StatusIcon status={s} />
                <span className="flex-1 truncate">{s.name}</span>
                {s.id === issue.status && <Icon name="check" />}
                <kbd className={si ? "invisible" : ""}>{ci + 1}</kbd>
              </Command.Item>
            )),
          )}
        </Command.List>
      </Command>
    </Popover>
  );
}

function AssignPicker({ issueKey }: { issueKey: string }) {
  const issues = useStore((s) => s.issues);
  const current = issues.get(issueKey)?.assignee;
  const users = useMemo(() => {
    const m = new Map<string, User>([[ME.id, ME]]);
    for (const i of issues.values()) if (i.assignee && !m.has(i.assignee.id)) m.set(i.assignee.id, i.assignee);
    return [...m.values()].sort((a, b) => (a.id === ME.id ? -1 : b.id === ME.id ? 1 : a.name.localeCompare(b.name)));
  }, [issues]);
  const value = (u: User) => `${u.name} ${u.id}`;
  return (
    <Popover issueKey={issueKey} prop="assignee">
      <Command loop defaultValue={current ? value(current) : "Unassigned"} className={MENU}>
        <Command.Input autoFocus placeholder="Assign to…" className={MENU_INPUT} />
        <Command.List className="max-h-[340px] overflow-y-auto p-1">
          <Command.Empty className="p-3 text-fg-3">No one found</Command.Empty>
          <Command.Item value="Unassigned" onSelect={() => actions.assign(issueKey, null)}>
            <Avatar user={null} size={18} /><span className="flex-1">Unassigned</span>{!current && <Icon name="check" />}
          </Command.Item>
          {users.map((u) => (
            <Command.Item key={u.id} value={value(u)} onSelect={() => actions.assign(issueKey, u)}>
              <Avatar user={u} size={18} />
              <span className="flex-1 truncate">{u.name}{u.id === ME.id && <span className="text-fg-3"> (me)</span>}</span>
              {current?.id === u.id && <Icon name="check" />}
              {u.id === ME.id && <kbd>I</kbd>}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </Popover>
  );
}

type Cmd = { name: string; hint?: string; icon?: ReactNode; run: () => void };
/** A palette command that runs a shortcut, so the hint shown is the key that does the same thing. */

function Palette({searchOnly=false}:{searchOnly?:boolean}) {
  const issues = useStore((s) => s.issues);
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const mine = useStore((s) => s.mine);
  const view = useStore((s) => s.view);
  const [scope, setScope] = useState(searchOnly?null:get().selected); // ⌘K acts on the selected issue; Backspace drops it
  const [q, setQ] = useState("");
  const scoped = scope ? issues.get(scope) : undefined;

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return searchOnly?[...issues.values()].sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,20):[];
    const exact = q.trim().toUpperCase();
    const hits = [...issues.values()].filter((i) => words.every((w) => `${i.key} ${i.summary}`.toLowerCase().includes(w)));
    hits.sort((a, b) => Number(b.key === exact) - Number(a.key === exact) || (a.updated < b.updated ? 1 : -1));
    return hits.slice(0, 50);
  }, [q, issues, searchOnly]);

  const command=(entry:typeof shortcuts[number]):Cmd=>({name:entry.name,hint:shortcutLabel(entry.id),run:()=>{ui.send({type:"overlay.close"});runShortcut(entry.id);}});
  const issueCmds:Cmd[]=scoped?shortcuts.filter(s=>s.issue).map(command):[];
  const general:Cmd[]=searchOnly?[]:[...shortcuts.filter((s,i,a)=>!s.issue&&s.id!=="commands"&&a.findIndex(other=>other.name===s.name)===i).map(command),...boards.filter(b=>b.id!==boardId).map((b):Cmd=>({name:`Switch to ${b.name}`,run:()=>{ui.send({type:"overlay.close"});navigate({board:b.id,selected:null,panel:false});}}))];
  const match = (c: Cmd) => c.name.toLowerCase().includes(q.trim().toLowerCase());
  const item = (c: Cmd) => (
    <Command.Item key={c.name} value={`cmd:${c.name}`} onSelect={c.run}>
      <span className="grid w-4 shrink-0 place-items-center text-fg-3">{c.icon}</span>
      <span className="flex-1 truncate">{c.name}</span>
      {c.hint && <kbd>{c.hint}</kbd>}
    </Command.Item>
  );

  return (
    <Overlay label={searchOnly?"Search issues":"Search issues and commands"}>
      <Command shouldFilter={false} loop className={`w-full ${MENU}`}>
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          {scoped && (
            <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-sel px-2 text-[12px] text-fg-2">
              <TypeDot type={scoped.type} />{scoped.key}
            </span>
          )}
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            onKeyDown={(e) => e.key === "Backspace" && !q && setScope(null)}
            placeholder={scoped ? "Type a command, or ⌫ to search everything…" : "Search issues or type a command…"}
            className="h-12 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
          />
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
          <Command.Empty className="p-3 text-fg-3">No results</Command.Empty>
          {issueCmds.some(match) && <Command.Group heading={scoped!.key}>{issueCmds.filter(match).map(item)}</Command.Group>}
          {general.some(match) && <Command.Group heading="General">{general.filter(match).map(item)}</Command.Group>}
          {results.length > 0 && (
            <Command.Group heading={`Issues (${results.length === 50 ? "top 50" : results.length})`}>
              {results.map((i) => (
                <Command.Item
                  key={i.key}
                  value={i.key}
                  onSelect={() => timed(`open ${i.key}`, () => (ui.send({type:"overlay.close"}),navigate({ board: i.board, selected: i.key, panel: true }),ui.send({type:"query.set",query:""})))}
                >
                  {(() => { const s = statusOf(i); return s ? <StatusIcon status={s} /> : <TypeDot type={i.type} />; })()}
                  <span className="w-[88px] shrink-0 text-[12px] tracking-[-0.24px] text-fg-3">{i.key}</span>
                  <span className="flex-1 truncate">{i.summary}</span>
                  <Avatar user={i.assignee} size={18} />
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  );
}


export default App;
