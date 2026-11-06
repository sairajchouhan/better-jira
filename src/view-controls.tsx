import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MenuSurface } from "./menu-surface";
import { PillSelect } from "./pill-select";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { changeDisplay, changePreferences, get, ME, preferencesFor, saveDefault, timed, ui, usePreferences, useStore, type Issue, type Board } from "./store";
import { defaultDisplay, defaultPreferences, filterCount, FIELDS, GROUPINGS, isDate, isNumeric, matchesFilters, matchesRule, newId, operatorsFor, ORDERINGS, PROPERTIES, selectIssues, updateFilter, type Display, type Field, type FilterGroup, type Rule } from "./view-model";

export const POPUP = "view-popup rounded-xl border border-line-2 bg-card text-fg-2 shadow-[0_12px_40px_rgb(0_0_0/0.35)]";
const ITEM = "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover";
const INPUT = "h-9 w-full border-b border-line-2 bg-transparent px-3 text-[13px] outline-none placeholder:text-fg-3";
const CIRCLE = "relative grid size-7 shrink-0 place-items-center rounded-full bg-btn text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg";

type Choice = { value: string; label: string; count?: number; icon?: ReactNode };
export function filterChoices(field: Field, board: Board, issues: Issue[]): Choice[] {
  const opts = new Map<string, Choice>();
  const add = (value: string, label: string, icon?: ReactNode) => opts.set(value,{value,label,icon,count:0});
  if (["assignee","creator","watchers"].includes(field)) { add("$none",field === "watchers"?"No subscribers":field === "assignee" ? "No assignee":"No creator"); add("$me","Current user"); }
  if(field === "milestone")add("$none","No milestone");
  if(field === "projectLead"){add("$none","No project lead");add("$me","Current user");}
  if (field === "labels") add("$none","No labels");
  if (field === "priority") add("$none","No priority");
  if (field === "project") add("$none","No project");
  if (field === "parent") add("$none","No parent");
  if (field === "status") board.columns.flatMap(c=>c.statuses).forEach(s=>add(s.id,s.name,<StatusIcon status={s}/>));
  if (field === "relations") return [["parent","Parent issues"],["child","Sub-issues"],["blocked","Blocked issues"],["blocking","Blocking issues"],["related","Issues with relations"],["duplicate","Duplicates"]].map(([value,label])=>({value:value!,label:label!}));
  for (const i of issues) {
    if (field === "assignee" || field === "creator") { const u = i[field]; if (u) add(u.id,u.name); }
    if (field === "labels") for (const l of i.labels) add(l,l);
    if (field === "priority" && i.priority) add(i.priority,i.priority,<PriorityIcon name={i.priority}/>);
    if (field === "project" && i.project) add(i.project.key,i.project.name);
    if (field === "type" && i.type) add(i.type,i.type);
    if (field === "parent" && i.parent) add(i.parent,i.parent);
    if(field === "milestone")for(const version of i.milestones??[])add(version.id,version.name);
    if(field === "watchers")for(const user of i.watchers??[])add(user.id,user.name);
    if(field === "projectLead"&&i.projectLead)add(i.projectLead.id,i.projectLead.name);
  }
  const out = [...opts.values()];
  if (field !== "status") out.sort((a,b)=>a.value.startsWith("$") ? b.value.startsWith("$") ? a.label.localeCompare(b.label) : -1 : b.value.startsWith("$") ? 1 : a.label.localeCompare(b.label));
  for (const o of out) o.count = issues.filter(i=>matchesRule(i,{id:"count",field,op:"is",values:[o.value]},issues,ME.id)).length;
  return out;
}

export function BoardControls({ board }: {board:Board}) {
  const toolbar = useStore(s=>s.toolbar);
  const preferences = usePreferences(board.id);
  const filterRef = useRef<HTMLButtonElement>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState({top:100,right:16});
  const ref = toolbar === "display" ? displayRef : filterRef;
  const count = filterCount(preferences.filters);
  useEffect(()=> {
    if (!toolbar) return;
    const position = () => { const r = ref.current?.getBoundingClientRect(); if (r) setRect({top:r.bottom+6,right:innerWidth-r.right}); };
    position();
    const focusFrame=requestAnimationFrame(()=>popup.current?.querySelector<HTMLElement>("input, [role=tab][aria-selected=true], button")?.focus());
    const outside = (e:PointerEvent) => { if (!popup.current?.contains(e.target as Node) && !filterRef.current?.contains(e.target as Node) && !displayRef.current?.contains(e.target as Node)) ui.send({type:"toolbar.close"}); };
    const key = (e:KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); ui.send({type:"toolbar.close"}); ref.current?.focus(); } };
    document.addEventListener("pointerdown",outside);
    window.addEventListener("keydown",key);
    window.addEventListener("resize",position);
    return ()=>{cancelAnimationFrame(focusFrame);document.removeEventListener("pointerdown",outside);window.removeEventListener("keydown",key);window.removeEventListener("resize",position);};
  },[toolbar,board.id]);
  return <>
    <button ref={filterRef} aria-label="Add filter" title="Filter (F)" aria-expanded={toolbar === "filter" || toolbar === "advanced"} onClick={()=>ui.send({type:"toolbar.toggle",toolbar:"filter"})} className={CIRCLE}>
      <Icon name="filter"/>{count>0 && <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-accent text-[9px] text-white">{count}</span>}
    </button>
    <button ref={displayRef} aria-label="Display options" title="Display options" aria-expanded={toolbar === "display"} onClick={()=>ui.send({type:"toolbar.toggle",toolbar:"display"})} className={CIRCLE}>
      <Icon name="display"/>{JSON.stringify(preferences.display)!==JSON.stringify(defaultDisplay())&&<span className="absolute top-0 right-0 size-1.5 rounded-full bg-accent"/>}
    </button>
    {toolbar && createPortal(<div ref={popup} className="fixed z-40 max-w-[calc(100vw-24px)]" style={{top:rect.top,right:rect.right}} onKeyDown={e=>{
      e.stopPropagation();
      if(e.key === "Escape"){ui.send({type:"toolbar.close"});ref.current?.focus();}
      if(e.key === "Tab") {
        const nodes=[...(popup.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')??[])].filter(n=>n.getClientRects().length);
        const first=nodes[0],last=nodes.at(-1);
        if(e.shiftKey&&document.activeElement === first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement === last){e.preventDefault();first?.focus();}
      }
    }}>
      {toolbar === "display" ? <DisplayMenu board={board}/> : toolbar === "advanced" ? <AdvancedMenu board={board}/> : <FilterMenu key={board.id} board={board}/>}
    </div>,document.body)}
  </>;
}

function Select({label,value,options,onChange,children}:{label:string;value:string;options:readonly (readonly [string,string])[];onChange:(value:string)=>void;children?:ReactNode}) {
  return <div className="flex min-h-8 items-center justify-between gap-2 text-[12px] text-fg-3">
    <span>{label}</span><span className="flex w-[170px] items-center gap-2">{children}<PillSelect label={label} value={value} options={options} onChange={onChange} className="flex h-6 min-w-0 flex-1 items-center rounded-md border border-line-2 bg-tab px-2 text-left text-[12px] text-fg-2 hover:bg-hover"/></span>
  </div>;
}
function Toggle({label,value,onChange}:{label:string;value:boolean;onChange:()=>void}) {
  return <label className="flex min-h-8 cursor-pointer items-center justify-between gap-4 text-[12px] text-fg-3"><span>{label}</span><input type="checkbox" role="switch" aria-label={label} checked={value} onChange={onChange} className="view-toggle"/></label>;
}
function DisplayMenu({board}:{board:Board}) {
  const {display:d} = usePreferences(board.id);
  const defaults = useStore(s=>s.defaults);
  const [saving,setSaving] = useState(false);
  const patch = (p:Partial<Display>) => timed("display",()=>changeDisplay(board.id,p));
  return <div role="dialog" aria-label="Display options" className={`${POPUP} w-[304px] max-h-[calc(100vh-140px)] overflow-y-auto p-3`}>
    <div role="tablist" aria-label="Layout" className="mb-4 grid grid-cols-2 gap-1">
      {(["list","board"] as const).map(layout=><button role="tab" aria-selected={d.layout===layout} key={layout} onClick={()=>patch({layout})} className={`flex h-7 items-center justify-center gap-2 rounded-full bg-tab text-[12px] shadow-(--tab-shadow) ${d.layout===layout ? "bg-tab-on text-fg":"text-fg-3"}`}><Icon name={layout}/>{layout === "list" ? "List":"Board"}</button>)}
    </div>
    <Select label={d.layout === "board" ? "Columns":"Grouping"} value={d.columns} options={GROUPINGS.filter(([v])=>d.layout === "list" || v !== "none")} onChange={v=>patch({columns:v as Display["columns"]})}>
      <button aria-label="Group ordering" title="Reverse group order" onClick={e=>{e.preventDefault();patch({groupDescending:!d.groupDescending});}} className="text-fg-2"><Icon name={d.groupDescending?"down":"up"}/></button>
    </Select>
    <Select label={d.layout === "board" ? "Rows":"Sub-grouping"} value={d.rows} options={GROUPINGS.filter(([v])=>v === "none" || v !== d.columns)} onChange={v=>patch({rows:v as Display["rows"]})}/>
    <Select label="Ordering" value={d.ordering} options={ORDERINGS} onChange={v=>patch({ordering:v as Display["ordering"]})}>
      <button aria-label="Direction" title="Reverse issue order" onClick={e=>{e.preventDefault();patch({descending:!d.descending});}} className="text-fg-2"><Icon name={d.descending?"down":"up"}/></button>
    </Select>
    <Toggle label="Order completed by recency" value={d.completedRecency} onChange={()=>patch({completedRecency:!d.completedRecency})}/>
    <div className="my-3 border-t border-line-2"/>
    <Toggle label="Show sub-issues" value={d.subIssues} onChange={()=>patch({subIssues:!d.subIssues})}/>
    <div className="my-3 border-t border-line-2"/>
    <div className="mb-1 text-[12px] font-medium">{d.layout === "board" ? "Board":"List"} options</div>
    {d.layout === "list" && <Select label="Nested sub-issues" value={d.nested} options={[["matching","Show matching"],["all","Show all"],["none","Don't nest"]]} onChange={v=>patch({nested:v as Display["nested"]})}/>}
    <Toggle label={d.layout === "board" ? "Show empty columns":"Show empty groups"} value={d.emptyGroups} onChange={()=>patch({emptyGroups:!d.emptyGroups})}/>
    <div className="mt-3 mb-2 text-[12px] text-fg-3">Display properties</div>
    <div className="flex flex-wrap gap-1">{PROPERTIES.filter(([p])=>d.layout === "list" || p !== "creator").map(([p,label])=><button key={p} aria-pressed={d.properties.includes(p)} onClick={()=>patch({properties:d.properties.includes(p)?d.properties.filter(v=>v!==p):[...d.properties,p]})} className={`rounded-full px-2 py-1 text-[11px] ${d.properties.includes(p)?"bg-tab-on text-fg-2":"bg-tab text-fg-3"}`}>{label}</button>)}
    </div>
    <PropertySyncNotice/>
    <div className="my-3 border-t border-line-2"/>
    <Select label="Open issues in" value={d.openIn} options={[["side","Side panel"],["page","Full page"]]} onChange={v=>patch({openIn:v as Display["openIn"]})}/>
    <div className="mt-3 flex justify-end gap-3 border-t border-line-2 pt-2 text-[11px]">
      <button title="Reset to the saved default for this board" onClick={()=>changeDisplay(board.id,defaults[board.id] ?? defaultDisplay())}>Reset</button>
      <button className="text-accent disabled:opacity-50" disabled={saving} title="Save your display default in this browser" onClick={async()=>{setSaving(true);await saveDefault(board.id);setSaving(false);}}>{saving?"Saving…":"Save my default"}</button>
    </div>
  </div>;
}

const UNAVAILABLE = "This field belongs to Linear and is not available on mirrored Jira issues.";
const CATEGORIES: {name:string;field?:Field;group?:string;icon:Parameters<typeof Icon>[0]["name"];reason?:string}[] = [
  {name:"Advanced filter",group:"advanced",icon:"filter"},
  {name:"Status",field:"status",icon:"layers"}, {name:"Assignee",field:"assignee",icon:"user"},
  {name:"Creator",field:"creator",icon:"user"}, {name:"Priority",field:"priority",icon:"layers"},
  {name:"Labels",field:"labels",icon:"label"},{name:"Relations",field:"relations",icon:"layers"},
  {name:"Dates",group:"dates",icon:"calendar"},
  {name:"Project",field:"project",icon:"layers"},{name:"Project properties",group:"project",icon:"layers"},
  {name:"Subscribers",field:"watchers",icon:"user"},
  {name:"External source",icon:"external",reason:UNAVAILABLE},{name:"Auto-closed",icon:"close",reason:UNAVAILABLE},
  {name:"Content",field:"content",icon:"pencil"},{name:"Links",field:"links",icon:"external"},
  {name:"Issue type",field:"type",icon:"layers"}, {name:"Parent issue",field:"parent",icon:"layers"},
  {name:"Pull requests",field:"pullRequests",icon:"external"},
  {name:"Estimate",field:"estimate",icon:"layers"},
];
type Submenu = {field?:Field;group?:string;name:string};
const DATES: [Field,string][] = [["due","Due date"],["created","Created date"],["updated","Updated date"],["started","Started date"],["resolved","Completed date"],["statusAge","Time in current status"]];
function FilterMenu({board}:{board:Board}) {
  const [submenu,setSubmenu] = useState<Submenu|null>(null);
  const [info,setInfo] = useState("");
  return <div className="flex flex-row-reverse items-start gap-1.5 max-[700px]:flex-col">
    {/* One level at a time, like Linear: a category replaces the root list, and Esc anywhere closes the menu. */}
    {!submenu&&<Command loop className={`${POPUP} filter-command w-[248px] max-h-[calc(100vh-140px)] overflow-y-auto`}>
      <Command.Input autoFocus aria-label="Add Filter…" placeholder="Add Filter…" className={INPUT}/>
      <Command.List className="p-1"><Command.Empty className="p-3 text-fg-3">No filters found</Command.Empty>
        {CATEGORIES.map(c=><Command.Item key={c.name} value={c.name} onSelect={()=>{if(c.reason){setInfo(c.reason);setSubmenu(null);}else if(c.group === "advanced"){ui.send({type:"toolbar.open",toolbar:"advanced"});}else {setInfo("");setSubmenu(c);}}} className={`${ITEM} ${c.reason?"text-fg-4":""}`}>
          <Icon name={c.icon}/><span className="flex-1">{c.name}</span>{c.group!=="advanced"&&<Icon name="chevron" size={11}/>}
        </Command.Item>)}
      </Command.List>
      <PropertySyncNotice/>
      {info&&<div role="status" className="border-t border-line-2 px-3 py-2 text-[12px] leading-5 text-fg-3">{info}</div>}
    </Command>}
    {submenu && (submenu.group === "project" ? <Command loop className={`${POPUP} filter-command w-[240px]`}><BackTo name={submenu.name} back={()=>setSubmenu(null)}/><Command.Input autoFocus placeholder="Filter…" className={INPUT}/><Command.List className="p-1"><Command.Item className={ITEM} onSelect={()=>setSubmenu({field:"projectLead",name:"Project lead"})}>Project lead <Icon name="chevron" size={11}/></Command.Item><Command.Item className={ITEM} onSelect={()=>setSubmenu({field:"milestone",name:"Milestone"})}>Milestone name <Icon name="chevron" size={11}/></Command.Item></Command.List><div className="px-3 pb-2 text-[11px] text-fg-3">Milestones use Jira fix versions.</div></Command> : submenu.group === "dates" ? <Command loop className={`${POPUP} filter-command w-[240px]`}>
      <BackTo name={submenu.name} back={()=>setSubmenu(null)}/><Command.Input autoFocus placeholder="Filter…" className={INPUT}/><Command.List className="p-1">{DATES.map(([field,name])=><Command.Item key={field} className={ITEM} onSelect={()=>setSubmenu({field,name})}><Icon name="calendar"/><span className="flex-1">{name}</span><Icon name="chevron" size={11}/></Command.Item>)}
      {["Auto-closed date","Triaged date"].map(name=><Command.Item key={name} className={`${ITEM} text-fg-4`} onSelect={()=>setInfo(`${name} is not available in the mirrored Jira data.`)}>{name}</Command.Item>)}
      </Command.List></Command> : submenu.field && <PropertyFilter key={submenu.field} field={submenu.field} name={submenu.name} board={board} onBack={()=>setSubmenu(null)}/>)}
  </div>;
}

const BackTo=({name,back}:{name:string;back:()=>void})=><button onClick={back} className="flex h-8 w-full items-center gap-2 px-3 text-[12px] text-fg-3"><span>‹</span>{name}</button>;

/** `inline`: opened from a filter chip, with the operator as pills and no back button. */
function PropertyFilter({field,name,board,onBack,inline=false}:{field:Field;name:string;board:Board;onBack:()=>void;inline?:boolean}) {
  const issuesMap = useStore(s=>s.issues);
  const prefs = usePreferences(board.id);
  const mine = useStore(s=>s.mine);
  const query = useStore(s=>s.query);
  const issues = useMemo(()=>{
    const candidates=[...issuesMap.values()];
    const base={...prefs,filters:{...prefs.filters,children:prefs.filters.children.filter(c=>"children" in c || c.field !== field)}};
    return selectIssues(candidates,board,base,mine,query,ME.id);
  },[issuesMap,board,mine,query,prefs,field]);
  const rule = prefs.filters.children.find((c):c is Rule=>!("children" in c)&&c.field === field);
  const [value,setValue] = useState(rule?.values[0] ?? "");
  const [op,setOp] = useState<Rule["op"]>(rule?.op??(field === "content" || field === "links"?"contains":"is"));
  const choices = useMemo(()=>filterChoices(field,board,issues),[field,board,issues]);
  function apply(values:string[], operator = rule?.op??"is") {
    const next:Rule = {id:rule?.id??newId(),field,op:operator,values};
    changePreferences(board.id,{filters:{...prefs.filters,children:rule ? prefs.filters.children.map(c=>c.id===rule.id?next:c) : [...prefs.filters.children,next]}});
  }
  const toggle = (v:string) => {
    const vals = rule?.values ?? [];
    const next = vals.includes(v)?vals.filter(x=>x!==v):[...vals,v];
    if (!next.length && rule) changePreferences(board.id,{filters:updateFilter(prefs.filters,rule.id,null)});
    else timed("filter",()=>apply(next));
  };
  const date = isDate(field);
  const numeric=isNumeric(field);
  const input = date || numeric || field === "content" || field === "links";
  return <div className={inline?"":`${POPUP} w-[270px] max-h-[calc(100vh-140px)] overflow-y-auto`}>
    {!inline?<BackTo name={name} back={onBack}/>:!input&&rule&&<div role="group" aria-label={`${name} operator`} className="flex flex-wrap gap-1 pb-2">{operatorsFor(field).map(([v,l])=><button key={v} aria-pressed={rule.op===v} onClick={()=>apply(rule.values,v)} className={`rounded-full px-2 py-0.5 text-[11px] ${rule.op===v?"bg-tab-on text-fg":"bg-tab text-fg-3 hover:text-fg-2"}`}>{l}</button>)}</div>}
    {input ? <form onSubmit={e=>{e.preventDefault();if(value.trim()||op === "empty"||op === "notEmpty") {apply(value?[value]:[],op);ui.send({type:"toolbar.close"});if(inline)onBack();}}} className="space-y-2 p-3 pt-0">
      <select aria-label={`${name} operator`} value={op} onChange={e=>setOp(e.target.value as Rule["op"])} className="view-select w-full">{operatorsFor(field).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>
      {!["empty","notEmpty"].includes(op)&&<input autoFocus aria-label={name} required value={value} onChange={e=>setValue(e.target.value)} type={numeric?"number":date ? ["within","next"].includes(op)?"number":"date":"text"} min={numeric||op === "within"||op === "next"?0:undefined} step={numeric?"any":undefined} className="view-select w-full" placeholder={field === "statusAge"?"Days in current status…":"Text to match…"}/>}
      {field === "statusAge"&&<div className="text-[11px] text-fg-3">Duration in days, including fractions.</div>}
      <button type="submit" className="h-7 w-full rounded-md bg-accent text-[12px] text-white">Apply filter</button>
      {date&&<div className="border-t border-line-2 pt-1">{(field === "due" ? [["Overdue","before",new Date().toLocaleDateString("en-CA")],["1 day from now","next","1"],["3 days from now","next","3"],["1 week from now","next","7"],["1 month from now","next","30"],["3 months from now","next","90"],["No due date","empty",""]] : [["Last 24 hours","within","1"],["Last 7 days","within","7"],["Last 30 days","within","30"],["No date","empty",""]]).map(([label,operator,v])=><button key={label} type="button" onClick={()=>{apply(v?[v]:[],operator as Rule["op"]);ui.send({type:"toolbar.close"});}} className={ITEM}>{label}</button>)}</div>}
    </form> : <Command loop className="filter-command"><Command.Input autoFocus placeholder="Filter…" aria-label={`Filter ${name}`} className={INPUT}/><Command.List className="max-h-[360px] overflow-y-auto p-1"><Command.Empty className="p-3 text-fg-3">No values found</Command.Empty>{choices.map(c=><Command.Item key={c.value} aria-checked={rule?.values.includes(c.value)??false} value={`${c.label} ${c.value}`} onSelect={()=>toggle(c.value)} className={ITEM}>
      <span aria-hidden className={`grid size-3.5 shrink-0 place-items-center rounded border ${rule?.values.includes(c.value)?"border-accent bg-accent text-white":"border-line-3"}`}>{rule?.values.includes(c.value)&&<Icon name="check" size={11}/>}</span>{c.icon}<span className="min-w-0 flex-1 truncate">{c.label}</span>{!!c.count&&<span className="text-[11px] text-fg-3">{c.count}</span>}
    </Command.Item>)}</Command.List></Command>}
  </div>;
}

export function FilterChips({board}:{board:Board}) {
  const {filters} = usePreferences(board.id);
  const issues = useStore(s=>s.issues);
  const labelFor = (field:Field,value:string) => {
    if(value === "$me")return "me";
    if(value === "$none")return "none";
    if(field === "statusAge")return `${value} days`;
    if(field === "status")return board.columns.flatMap(c=>c.statuses).find(s=>s.id===value)?.name??value;
    if(field === "assignee"||field === "creator")return [...issues.values()].find(i=>i[field]?.id===value)?.[field]?.name??value;
    if(field === "project")return [...issues.values()].find(i=>i.project?.key===value)?.project?.name??value;
    if(field === "milestone")return [...issues.values()].flatMap(i=>i.milestones??[]).find(v=>v.id===value)?.name??value;
    if(field === "watchers")return [...issues.values()].flatMap(i=>i.watchers??[]).find(u=>u.id===value)?.name??value;
    if(field === "projectLead")return [...issues.values()].find(i=>i.projectLead?.id===value)?.projectLead?.name??value;
    if(field === "relations")return ({parent:"Parent issues",child:"Sub-issues",blocked:"Blocked issues",blocking:"Blocking issues",related:"Issues with relations",duplicate:"Duplicates"} as Record<string,string>)[value]??value;
    return value;
  };
  const [edit,setEdit]=useState<{id:string;anchor:HTMLElement}|null>(null);
  const editing=filters.children.find((c):c is Rule=>!("children" in c)&&c.id===edit?.id);
  if (!filters.children.length) return null;
  return <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-3 py-1.5 text-[12px]">
    {/* Like Linear, a chip edits its own rule in a small picker under it; groups still open the advanced editor. */}
    {edit&&editing&&<MenuSurface label={`Edit ${FIELDS.find(([f])=>f===editing.field)?.[1]} filter`} anchor={edit.anchor} width={280} close={()=>setEdit(null)}><PropertyFilter inline field={editing.field} name={FIELDS.find(([f])=>f===editing.field)?.[1]??editing.field} board={board} onBack={()=>setEdit(null)}/></MenuSurface>}
    {filters.children.map(c=><div key={c.id} className="flex h-6 max-w-[320px] items-center overflow-hidden rounded-md border border-line-2 bg-tab">
      <button className="truncate px-2" onClick={e=>"children" in c?ui.send({type:"toolbar.open",toolbar:"advanced"}):setEdit({id:c.id,anchor:e.currentTarget.parentElement!})}>{"children" in c?`${c.join.toUpperCase()} group · ${filterCount(c)} rules`:`${FIELDS.find(([f])=>f===c.field)?.[1]} ${operatorsFor(c.field).find(([op])=>op===c.op)?.[1]} ${c.values.map(v=>labelFor(c.field,v)).join(", ")}`}</button>
      <button className="mr-1 rounded hover:bg-hover" aria-label={`Remove ${"children" in c?"filter group":c.field} filter`} onClick={()=>changePreferences(board.id,{filters:updateFilter(filters,c.id,null)})}><Icon name="close" size={12}/></button>
    </div>)}
    <button onClick={()=>ui.send({type:"toolbar.open",toolbar:"filter"})} className="grid size-6 place-items-center rounded hover:bg-hover" aria-label="Add another filter"><Icon name="plus"/></button>
    <button className="ml-1 text-fg-3" onClick={()=>changePreferences(board.id,{filters:{...filters,children:[]}})}>Clear</button>
  </div>;
}

function AdvancedMenu({board}:{board:Board}) {
  const preferences = usePreferences(board.id);
  const {filters}=preferences;
  const issues = useStore(s=>s.issues);
  const mine=useStore(s=>s.mine);
  const query=useStore(s=>s.query);
  const universe=useMemo(()=>[...issues.values()],[issues]);
  const all = useMemo(()=>selectIssues(universe,board,{...preferences,filters:defaultPreferences().filters},mine,query,ME.id),[universe,board,preferences,mine,query]);
  const patch = (id:string,change:Parameters<typeof updateFilter>[2]) => timed("filter",()=>changePreferences(board.id,{filters:updateFilter(preferencesFor(board.id).filters,id,change)}));
  return <div role="dialog" aria-label="Advanced filter" className={`${POPUP} w-[640px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-140px)] overflow-y-auto p-3`}>
    <div className="mb-3 flex items-center justify-between"><span className="font-medium">Advanced filter</span><button aria-label="Close advanced filter" onClick={()=>ui.send({type:"toolbar.close"})}><Icon name="close"/></button></div>
    <FilterGroupEditor group={filters} board={board} issues={all} patch={patch} depth={0}/>
    <PropertySyncNotice/>
    <div className="mt-3 flex justify-between border-t border-line-2 pt-3 text-[12px] text-fg-3"><span>{all.filter(i=>matchesFilters(i,filters,universe,ME.id)).length} matching issues in this view</span><button onClick={()=>ui.send({type:"toolbar.close"})} className="rounded-md bg-accent px-3 py-1 text-white">Done</button></div>
  </div>;
}
function FilterGroupEditor({group,board,issues,patch,depth}:{group:FilterGroup;board:Board;issues:Issue[];patch:(id:string,p:Parameters<typeof updateFilter>[2])=>void;depth:number}) {
  return <div className="space-y-2 rounded-lg border border-line-2 p-2">
    <div className="flex items-center gap-2 text-[12px] text-fg-3">Match<select aria-label={depth === 0 ? "Match conditions":"Match group conditions"} value={group.join} onChange={e=>patch(group.id,{join:e.target.value as FilterGroup["join"]})} className="view-select"><option value="and">all</option><option value="or">any</option></select>of the following
      {depth>0&&<button aria-label="Remove filter group" className="ml-auto" onClick={()=>patch(group.id,null)}><Icon name="close"/></button>}
    </div>
    {group.children.map(c=>"children" in c ? <FilterGroupEditor key={c.id} group={c} board={board} issues={issues} patch={patch} depth={depth+1}/> : <RuleEditor key={c.id} rule={c} board={board} issues={issues} patch={p=>patch(c.id,p)}/>)}
    <div className="flex gap-3 text-[12px] text-fg-3"><button aria-label={depth === 0 ? "Add filter condition":"Add group condition"} onClick={()=>patch(group.id,{children:[...group.children,{id:newId(),field:"status",op:"is",values:[]}]})}>+ Add filter</button>{depth<5&&<button aria-label={depth === 0 ? "Add filter group":"Add nested filter group"} onClick={()=>patch(group.id,{children:[...group.children,{id:newId(),join:"or",children:[]}]})}>+ Add filter group</button>}</div>
  </div>;
}
function RuleEditor({rule:r,board,issues,patch}:{rule:Rule;board:Board;issues:Issue[];patch:(p:Partial<Rule>|null)=>void}) {
  const choices = useMemo(()=>filterChoices(r.field,board,issues),[r.field,board,issues]);
  const free = isDate(r.field)||isNumeric(r.field)||r.field === "content"||r.field === "links";
  return <div className="flex flex-wrap items-start gap-1.5">
    <select className="view-select w-32" aria-label="Filter property" value={r.field} onChange={e=>{const field=e.target.value as Field;patch({field,op:field==="content"||field==="links"?"contains":"is",values:[]});}}>{FIELDS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    <select className="view-select w-32" aria-label="Filter operator" value={r.op} onChange={e=>patch({op:e.target.value as Rule["op"],values:[]})}>{operatorsFor(r.field).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    {!["empty","notEmpty"].includes(r.op)&& (free ? <input className="view-select min-w-24 flex-1" aria-label="Filter value" type={isNumeric(r.field)?"number":isDate(r.field)?["within","next"].includes(r.op)?"number":"date":"text"} step={isNumeric(r.field)?"any":undefined} value={r.values[0]??""} min={isNumeric(r.field)?0:undefined} onChange={e=>patch({values:e.target.value?[e.target.value]:[]})} placeholder={r.field === "statusAge"?"Days…":"Value…"}/> : <div className="min-w-32 flex-1 space-y-1">
      {r.values.map(v=><button key={v} className="mr-1 rounded bg-tab-on px-2 py-1 text-[11px]" title="Remove value" onClick={()=>patch({values:r.values.filter(x=>x!==v)})}>{choices.find(c=>c.value===v)?.label??v} ×</button>)}
      <select aria-label="Add filter value" value="" className="view-select w-full" onChange={e=>{if(e.target.value&&!r.values.includes(e.target.value))patch({values:[...r.values,e.target.value]});}}><option value="">Select values…</option>{choices.filter(c=>!r.values.includes(c.value)).map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select>
    </div>)}
    <button aria-label="Remove condition" className="grid size-7 place-items-center text-fg-3" onClick={()=>patch(null)}><Icon name="close" size={12}/></button>
  </div>;
}

function PropertySyncNotice() {
  const progress=useStore(s=>s.propertySync);
  if(!progress.pending&&!progress.errors)return null;
  return <div role="status" className="border-t border-line-2 px-2 py-2 text-[11px] leading-4 text-fg-3">
    {progress.pending?`Loading Jira properties… ${progress.completed} / ${progress.total}. Results update as data arrives.`:`Some Jira properties could not be read on ${progress.errors} issues. Restricted watcher lists are excluded from subscriber filters.`}
  </div>;
}
