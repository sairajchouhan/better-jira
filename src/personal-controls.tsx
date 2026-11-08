import {SubIssues,statusOf} from './sub-issues';
import {findIssueDocument,resourceMediaIds} from './issue-resource';
import {useHotkey} from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Adf, adfToText } from "./adf";
import { RichEditor } from "./rich-editor-loader";
import {MediaView} from './media-loader';
import { normalizeDocument } from "./document";
import { Icon, PriorityIcon, StatusIcon, hue } from "./icons";
import { PICKER_ITEM, PickerRow, PropertyMenu } from "./property-menu";
import { actions, addLocalFiles, beginCreate, boardOf, changePreferences, get, issueURL, isLocalIssue, ME, navigate, openSavedView, preferencesFor, saveView, set, toggleFavorite, ui, useStore, type Board, type Issue, type IssueDraft } from "./store";
import {RELATION_ISSUE} from "./issue-activity";
import { buckets, newId, priorityRank, type Field, type Grouping } from "./view-model";

const INPUT="w-full rounded-md border border-line-2 bg-card px-3 py-2 text-fg outline-none focus:border-accent";
const BUTTON="rounded-md px-3 py-1.5 text-fg-2 hover:bg-hover disabled:opacity-40";

export { MenuSurface as Modal } from "./menu-surface";
import { MenuSurface as Modal, issueAnchor } from "./menu-surface";
import { lazy,Suspense } from "react";
const DateInput=lazy(()=>import("./date-input").then(module=>({default:module.DateInput})));
import {IssueResources,ResourceForm,createIssueDocument} from './issue-resources';
import { ReactionPicker, shortcode } from "./reactions";
import { PillSelect } from "./pill-select";
import {shortcutLabel,runShortcut} from "./shortcuts";
import { copyIcons,copyKinds,copyShortcuts,issueCopy,type CopyKind } from "./issue-copy";
import {ActionMenu,type ActionEntry} from "./action-menu";
import {reminderPresets,reminderTime} from "./reminder-display";
import {duePresets} from "./due-date";

/** Linear keeps an unsent title and description when the composer closes; the next C brings them back. */
const unsent={title:"",description:normalizeDocument("")};
export function CreateIssue() {
  const board=useStore(s=>s.boards.find(b=>b.id===s.board))!;
  const all=useStore(s=>s.issues);
  const initial=useStore(s=>s.draft);
  const [draft,setDraft]=useState<IssueDraft>(initial);
  const [title,setTitle]=useState(unsent.title);
  const [description,setDescription]=useState(()=>normalizeDocument(initial.descriptionDoc??unsent.description));
  useEffect(()=>{unsent.title=title;unsent.description=description;},[title,description]);
  const [draftIndex,setDraftIndex]=useState(0);
  const [labels,setLabels]=useState(initial.labels?.join(", ")??"");
  const [more,setMore]=useState(false);
  const [expanded,setExpanded]=useState(get().createExpanded);
  useEffect(()=>{set({createExpanded:false});},[]);
  const [attachments,setAttachments]=useState<Issue["attachments"]>(initial.attachments??[]);
  const [filesBusy,setFilesBusy]=useState(false);
  const [dateValid,setDateValid]=useState(true);
  const titleRef=useRef<HTMLInputElement>(null);
  const formRef=useRef<HTMLFormElement>(null);
  const issues=[...all.values()].filter(i=>i.board===board.id);
  const users=[...new Map([[ME.id,ME] as const,...issues.flatMap(i=>i.assignee?[[i.assignee.id,i.assignee] as const]:[])]).values()];
  const projects=[...new Map(issues.flatMap(i=>i.project?[[i.project.key,i.project] as const]:[])).values()];
  const options=useStore(s=>s.options),writable=useStore(s=>s.writable);
  const priorities=[...new Set([...(writable?[]:["Normal"]),...options.priorities.map(p=>p.name),...issues.flatMap(i=>i.priority?[i.priority]:[])])];
  // Create related › Parent issue: only a type one level above the source's in Jira's hierarchy can be its parent (a Task's is an Epic).
  const source=draft.related?.kind==="parent"?all.get(draft.related.key):undefined,jiraTypes=options.types?.[draft.project?.key??projects[0]?.key??""];
  const sourceLevel=jiraTypes?.find(t=>t.name===source?.type)?.hierarchyLevel;
  const parentTypes=source&&sourceLevel!==undefined?jiraTypes!.filter(t=>t.hierarchyLevel===sourceLevel+1).map(t=>t.name):undefined;
  const noParentType=parentTypes?.length===0?`Jira has no issue type above ${source!.type}, so ${source!.key} can't have a parent.`:"";
  const types=parentTypes??[...new Set(["Task",...issues.flatMap(i=>i.type?[i.type]:[])])];
  const type=draft.type&&types.includes(draft.type)?draft.type:types[0]??"Task";
  const milestones=[...new Map([...(options.versions[draft.project?.key??projects[0]?.key??""]??[]).map(m=>[m.id,m] as const),...issues.filter(i=>i.project?.key===(draft.project?.key??projects[0]?.key)).flatMap(i=>(i.milestones??[]).map(m=>[m.id,m] as const))]).values()];
  const close=()=>ui.send({type:"overlay.close"});
  const submit=()=> {
    if(!title.trim()||filesBusy||!dateValid||noParentType)return;
    const key=actions.create(title,{...draft,type,...(draft.priority===""?{priority:undefined}:{}),descriptionDoc:description,attachments,labels:[...new Set(labels.split(",").map(l=>l.trim()).filter(Boolean))]},more);
    if(key){unsent.title="";unsent.description=normalizeDocument("");}
    if(key&&more){setTitle("");setDescription(normalizeDocument(""));setDraftIndex(n=>n+1);setAttachments([]);titleRef.current?.focus();}
  };
  useHotkey("Mod+Enter",()=>submit(),{target:formRef,capture:true,ignoreInputs:false});
  return <Modal label="Create issue" close={close} width={expanded?Math.max(640,window.innerWidth-48):640}>
    <form ref={formRef} onSubmit={e=>{e.preventDefault();submit();}}>
      <div className="mb-3 flex items-center gap-2 text-[12px] text-fg-3"><span className="flex-1 truncate">{board.name} › {initial.parent?`Sub-issue of ${initial.parent}`:"New issue"}</span><button type="button" aria-label={expanded?"Collapse editor":"Expand editor"} onClick={()=>setExpanded(!expanded)} className={BUTTON}><Icon name="expand"/></button><button type="button" aria-label="Close" onClick={close} className={BUTTON}><Icon name="close"/></button></div>
      <input ref={titleRef} autoFocus aria-label="Issue title" value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.metaKey&&!e.ctrlKey&&!e.nativeEvent.isComposing){e.preventDefault();document.getElementById("create-description")?.focus();}}} placeholder="Issue title" className="mb-2 w-full bg-transparent py-1 text-[18px] font-medium text-fg outline-none"/>
      <RichEditor key={draftIndex} id="create-description" initial={description} onChange={setDescription} expanded={expanded}/>
      <div className="flex flex-wrap gap-2">
        <PillSelect label="Issue type" value={type} options={types.map(t=>[t,t] as const)} onChange={type=>setDraft({...draft,type})}/>
        <PillSelect label="Status" value={draft.status??board.columns[0]?.statuses[0]?.id??""} options={board.columns.flatMap(c=>c.statuses).map(st=>[st.id,st.name] as const)} onChange={status=>setDraft({...draft,status})}/>
        <PillSelect label="Priority" value={draft.priority??(writable?"":"Normal")} options={[["",writable?"Default priority":"No priority"],...[...priorities].sort((a,b)=>priorityRank(a)-priorityRank(b)).map(p=>[p,p] as const)]} onChange={priority=>setDraft({...draft,priority})}/>
        <PillSelect label="Assignee" value={draft.assignee?.id??""} options={[["","Unassigned"],...users.map(u=>[u.id,u.name] as const)]} onChange={id=>setDraft({...draft,assignee:users.find(u=>u.id===id)??null})}/>
        <PillSelect label="Project" value={draft.project===null?"":draft.project?.key??projects[0]?.key??""} options={[["","No project"],...projects.map(p=>[p.key,p.name] as const)]} onChange={key=>setDraft({...draft,project:projects.find(p=>p.key===key)??null,milestones:[]})}/>
        <PillSelect label="Milestone" value={draft.milestones?.[0]?.id??""} options={[["","No milestone"],...milestones.map(m=>[m.id,m.name] as const)]} onChange={id=>setDraft({...draft,milestones:milestones.filter(m=>m.id===id)})}/>
        <details className="w-full text-[12px] text-fg-3"><summary className="cursor-default py-1">Due date{draft.due?`: ${draft.due}`:""}</summary><Suspense fallback={<p>Loading dates…</p>}><DateInput value={draft.due??""} onChange={due=>setDraft({...draft,due:due||null})} onValidity={setDateValid}/></Suspense></details>
      </div>
      <input aria-label="Labels, comma separated" value={labels} onChange={e=>setLabels(e.target.value)} placeholder="Labels, separated by commas" className={`${INPUT} mt-3 text-[12px]`}/>
      {noParentType&&<p role="alert" className="mt-3 text-[12px] text-danger">{noParentType}</p>}
      <Attachments attachments={attachments} onChange={setAttachments} onBusy={setFilesBusy}/>
      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3"><label className="mr-auto flex items-center gap-2 text-[12px]"><input type="checkbox" checked={more} onChange={e=>setMore(e.target.checked)}/>Create more</label><button type="button" onClick={close} className={BUTTON}>Cancel</button><button type="submit" disabled={!title.trim()||filesBusy||!dateValid||!!noParentType} className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-40">Create issue</button></div>
    </form>
  </Modal>;
}

type Choice={id:string;name:string};
export function PropertyPicker({issue,field}:{issue:Issue;field:"priority"|"labels"|"project"|"milestone"|"due"}) {
  const all=useStore(s=>s.issues);
  const issues=[...all.values()].filter(i=>i.board===issue.board);
  const [query,setQuery]=useState("");
  const [date,setDate]=useState(issue.due??"");
  const [dateValid,setDateValid]=useState(true);
  // Linear lists the issue's labels first, then the rest after a divider; the order holds while the menu is open.
  const options=useStore(s=>s.options),writable=useStore(s=>s.writable);
  const [order]=useState(()=>{const rest=[...new Set([...issues.flatMap(i=>i.labels),...options.labels])].filter(l=>!issue.labels.includes(l));return {checked:[...issue.labels],rest};});
  // The label menu opens beside the chip or button that was clicked, else beside the add button (Linear, RAJ-52).
  const [trigger]=useState(()=>document.activeElement instanceof HTMLElement&&document.activeElement.closest("[data-properties]")?document.activeElement:issueAnchor("prop-labels",issue.key));
  const close=()=>ui.send({type:"overlay.close"});
  const label={priority:"Set priority",labels:"Change labels",project:"Change project",milestone:"Set milestone",due:"Due date"}[field];
  if(field==="due")return <Modal label={label} close={close} anchor={issueAnchor("prop-due",issue.key)} width={360}><form onSubmit={e=>{e.preventDefault();if(!dateValid)return;actions.patch(issue.key,{due:date||null});close();}}><div className="mb-3"><Suspense fallback={<p>Loading dates…</p>}><DateInput autoFocus value={date} onChange={setDate} onValidity={setDateValid}/></Suspense></div><div className="flex justify-end gap-2"><button type="button" className={BUTTON} onClick={()=>{actions.patch(issue.key,{due:null});close();}}>Remove due date</button><button className={BUTTON} type="submit" disabled={!dateValid}>Save</button></div></form></Modal>;
  if(field==="labels"){
    // Linear (RAJ-52): a row click or Enter toggles the label and closes; Space or the row's checkbox toggles and keeps the menu open.
    const toggle=(name:string)=>{const now=get().issues.get(issue.key)?.labels??[];actions.patch(issue.key,{labels:now.includes(name)?now.filter(l=>l!==name):[...now,name]});};
    const row=(name:string)=>{const on=issue.labels.includes(name);return <Command.Item key={name} value={name} data-label={name} data-checked={on} onSelect={()=>{toggle(name);close();}} className={`${PICKER_ITEM} label-row`}>
      <span className="grid size-4 shrink-0 place-items-center"><input type="checkbox" tabIndex={-1} aria-label={`${on?"Remove":"Add"} label ${name}`} checked={on} onChange={()=>toggle(name)} onClick={e=>e.stopPropagation()} className="label-check"/></span>
      <span className="-ml-0.5 grid size-4 shrink-0 place-items-center"><span className="size-[9px] rounded-full" style={{background:hue(name)}}/></span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </Command.Item>;};
    const exact=[...order.checked,...order.rest].some(l=>l.toLowerCase()===query.trim().toLowerCase());
    return <PropertyMenu label={label} placeholder={issue.labels.length?"Change or add labels…":"Add labels…"} hotkey="L" anchor={trigger} side={trigger?.closest("[data-properties]")?"left":undefined} close={close} query={query} onQuery={setQuery}
      onKeyDown={event=>{if(event.key!==" "||query)return;const name=event.currentTarget.querySelector<HTMLElement>("[cmdk-item][data-selected=true]")?.dataset.label;if(name){event.preventDefault();toggle(name);}}}>
      {order.checked.map(row)}
      {order.checked.length>0&&order.rest.length>0&&<Command.Separator/>}
      {order.checked.length>0&&order.rest.length>0?<Command.Group heading="Workspace labels">{order.rest.map(row)}</Command.Group>:order.rest.map(row)}
      {query.trim()&&!exact&&<Command.Item value={`Create ${query}`} onSelect={()=>{toggle(query.trim());setQuery("");}} className={PICKER_ITEM}><span className="grid size-4 place-items-center"><Icon name="plus" size={14}/></span><span className="flex-1 truncate">Create new label: "{query.trim()}"</span></Command.Item>}
    </PropertyMenu>;
  }
  let choices:Choice[]=[];
  // Jira can't clear a priority, so with Jira writes the menu offers only Jira's priorities.
  if(field==="priority")choices=[...(writable?[]:[{id:"",name:"No priority"}]),...[...new Set([...options.priorities.map(p=>p.name),...issues.flatMap(i=>i.priority?[i.priority]:[])])].sort((a,b)=>priorityRank(a)-priorityRank(b)).map(p=>({id:p,name:p}))];
  if(field==="project")choices=[{id:"",name:"No project"},...[...new Map(issues.flatMap(i=>i.project?[[i.project.key,{id:i.project.key,name:i.project.name}] as const]:[])).values()]];
  if(field==="milestone")choices=[{id:"",name:"No milestone"},...[...new Map([...(options.versions[issue.project?.key??""]??[]).map(m=>[m.id,m] as const),...issues.filter(i=>i.project?.key===issue.project?.key).flatMap(i=>(i.milestones??[]).map(m=>[m.id,m] as const))]).values()]];
  const selected=(id:string)=>field==="priority"?(issue.priority??"")===id:field==="project"?(issue.project?.key??"")===id:(issue.milestones?.[0]?.id??"")===id;
  const choose=(c:Choice)=> {
    if(field==="priority")actions.patch(issue.key,{priority:c.id||undefined});
    if(field==="project")actions.patch(issue.key,{project:issues.find(i=>i.project?.key===c.id)?.project??null,milestones:[]});
    if(field==="milestone")actions.patch(issue.key,{milestones:c.id?[c]:[]});
    close();
  };
  return <PropertyMenu label={label} placeholder={field==="priority"?"Change priority to…":`${label}…`} hotkey={field==="priority"?"P":undefined} anchor={issueAnchor(`prop-${field}`,issue.key)} close={close} current={choices.find(c=>selected(c.id))?.name}>
    {choices.map((c,i)=><PickerRow key={c.id} value={c.name} icon={field==="priority"?<PriorityIcon name={c.id||undefined}/>:field==="project"?<Icon name="layers"/>:<Icon name="calendar"/>} current={selected(c.id)} number={field==="priority"?i:undefined} onSelect={()=>choose(c)}>{c.name}</PickerRow>)}
  </PropertyMenu>;
}

export function BoardDetails({board,issues}:{board:Board;issues:Issue[]}) {
  const [tab,setTab]=useState<Grouping>("assignee");
  const tabs:[Grouping,string][]=[["assignee","Assignees"],["label","Labels"],["priority","Priority"],["project","Projects"]];
  return <aside aria-label="Board details" className="w-[300px] shrink-0 overflow-y-auto border-l border-line p-3">
    <div role="tablist" aria-label="Board summary" className="mb-4 flex gap-1">{tabs.map(([id,label])=><button role="tab" key={id} aria-selected={id===tab} onClick={()=>setTab(id)} className={`rounded-md px-2 py-1.5 text-[11px] ${id===tab?"bg-sel":"text-fg-3 hover:bg-hover"}`}>{label}</button>)}</div>
    {buckets(issues,tab,board,issues).filter(g=>g.issues.length).map(group=><button key={group.id} onClick={()=>{
      const prefs=preferencesFor(board.id);const field:Field=tab==="label"?"labels":tab as Field;
      changePreferences(board.id,{filters:{...prefs.filters,children:[...prefs.filters.children.filter(c=>!("field"in c&&c.field===field)),{id:newId(),field,op:"is",values:[group.id]}]}});
    }} className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] hover:bg-hover"><span className="flex-1 truncate">{group.name}</span><span className="rounded-md bg-sel px-2 tabular-nums">{group.issues.length}</span></button>)}
    {!issues.length&&<p className="text-fg-3">No issues in this view.</p>}
  </aside>;
}

export function GroupMenu({name,hide}:{name:string;hide:()=>void}) {
  const [anchor,setAnchor]=useState<HTMLElement|null>(null);
  return <div className="ml-auto">
    <button aria-label={`Options for ${name}`} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={e=>setAnchor(anchor?null:e.currentTarget)} className="grid size-6 place-items-center rounded-full text-fg-3 hover:bg-hover"><Icon name="dots"/></button>
    {anchor&&<Modal label={`Column ${name}`} close={()=>setAnchor(null)} anchor={anchor} width={180}><button onClick={()=>{hide();setAnchor(null);}} className="w-full rounded-md px-3 py-2 text-left text-[12px] hover:bg-hover">Hide column</button></Modal>}
  </div>;
}

export function IssueOptions({issue}:{issue:Issue}) {
  const full=useStore(s=>s.full.get(issue.key)),parent=useStore(s=>issue.parent?s.issues.get(issue.parent):undefined);
  const description=issue.description??adfToText(full?.fields.description);
  const close=()=>ui.send({type:"overlay.close"});
  const start=useStore(s=>s.issueOptionsStart),[view,setView]=useState(start);
  useEffect(()=>{if(start&&start!=="reminder"){setView(start);set({issueOptionsStart:null});}},[start]);
  const historyOpen=view==="history";
  const linkOpen=view==="link"||view==="pull-request";
  const resourceKind=view==="pull-request"?"pull-request":"link";
  const copy=async(kind:CopyKind)=> {
    const status=boardOf(issue.key)?.columns.flatMap(c=>c.statuses).find(s=>s.id===issue.status)?.name??issue.status;
    try{await navigator.clipboard.writeText(issueCopy(kind,issue,full,issueURL(issue),status,ME.name));set({perf:`Copied ${kind}`});}catch{set({perf:"Could not access the clipboard"});}close();
  };
  if(historyOpen)return <Modal label="Description history" close={close}><h3 className="mb-3 font-medium">Description history</h3><p className="mb-3 text-[12px] text-fg-3">Your locally saved description revisions.</p>{[...(issue.descriptionHistory??[])].reverse().map((entry,index)=><div key={index} className="mb-3 rounded-md border border-line-2 p-3"><div className="mb-2 text-[11px] text-fg-3">{new Date(entry.at).toLocaleString()}</div><div>{entry.document?<Adf node={entry.document}/>:<p className="whitespace-pre-wrap">{entry.text||"Empty description"}</p>}</div><button className={`${BUTTON} mt-2`} onClick={()=>{actions.description(issue.key,entry.document??entry.text,true);close();}}>Restore this description</button></div>)}{!issue.descriptionHistory?.length&&<p>No local description changes yet.</p>}<button onClick={close} className={`${BUTTON} mt-3`}>Close</button></Modal>;
  if(linkOpen)return <ResourceForm issue={issue} kind={resourceKind} close={close}/>;
  const favorite=get().favorites.includes(issue.key),keys=(id:string)=>shortcutLabel(id)||undefined;
  const open=(overlay:"due"|"reminder"|"relations")=>ui.send({type:"overlay.open",overlay});
  const related=(kind:NonNullable<IssueDraft["related"]>["kind"])=>{close();beginCreate({related:{key:issue.key,kind},project:issue.project});};
  const mark=(kind:string)=>{set({relationKind:kind});open("relations");};
  const reopen=(view:"link"|"pull-request"|"history")=>{set({issueOptionsStart:view});ui.send({type:"overlay.open",overlay:"options"});};
  const entries:ActionEntry[]=[
    {name:"Due date",icon:"calendar",shortcut:keys("due"),children:[{name:"Custom…",run:()=>open("due")},...duePresets().map(preset=>({name:preset.name,shortcut:preset.label,run:()=>{actions.patch(issue.key,{due:preset.due});close();}}))]},
    {name:"Add link…",icon:"link",shortcut:keys("link"),run:()=>reopen("link")},
    {name:"Add pull request…",icon:"branch",run:()=>reopen("pull-request")},
    {name:"Add document…",icon:"file",run:()=>createIssueDocument(issue)},
    {name:"Create related",icon:"square-plus",divider:true,children:[{name:"Issue…",run:()=>related("related")},{name:"Sub-issue…",shortcut:keys("sub-issue"),run:()=>{close();requestAnimationFrame(()=>runShortcut("sub-issue"));}},{name:"Parent issue…",run:()=>related("parent")},{name:"Blocked issue…",run:()=>related("blocked")},{name:"Blocking issue…",run:()=>related("blocking")}]},
    {name:"Mark as",icon:"flag",children:[{name:"Parent of…",run:()=>mark("child")},{name:"Sub-issue of…",shortcut:keys("parent-set"),run:()=>mark("parent")},{name:"Related to…",shortcut:keys("related"),run:()=>mark("related")},{name:"Blocked by…",shortcut:keys("blocked"),run:()=>mark("blocked")},{name:"Blocking…",shortcut:keys("blocking"),run:()=>mark("blocking")},{name:"Duplicate of…",shortcut:keys("duplicate"),run:()=>mark("duplicate")}]},
    // Linear (RAJ-52): Remove lists the parent and every relation, named by the other issue's role ("Blocking issue RAJ-54 …").
    ...(parent||issue.relations?.length?[{name:"Remove",icon:"flag-x" as const,children:[...parent?[{name:`Parent issue ${parent.key} ${parent.summary}`,run:()=>{actions.patch(issue.key,{parent:undefined});close();}}]:[],
      ...(issue.relations??[]).map(r=>{const role=RELATION_ISSUE[r.kind]??"related";return {name:`${role[0]!.toUpperCase()}${role.slice(1)} issue ${r.key} ${get().issues.get(r.key)?.summary??""}`.trim(),run:()=>{actions.relate(issue.key,r.key,r.kind,true);close();}};})]}]:[]),
    {name:"Copy",icon:"clipboard",divider:true,children:copyKinds.map(kind=>({name:`Copy ${kind}`,icon:copyIcons[kind],shortcut:keys(copyShortcuts[kind]??""),run:()=>void copy(kind)}))},
    {name:"Make a copy…",icon:"copy",run:()=>actions.duplicate(issue.key)},
    {name:favorite?"Remove from favorites":"Favorite",icon:favorite?"starred":"star",divider:true,shortcut:keys("favorite"),run:()=>{toggleFavorite(issue.key);close();}},
    {name:"Remind me",icon:"clock",shortcut:keys("remind"),children:[...reminderPresets().map(preset=>({name:preset.label,shortcut:reminderTime(preset.at),run:()=>{actions.remind(issue.key,preset.at);close();}})),{name:"Custom…",run:()=>{set({issueOptionsStart:"reminder"});open("reminder");}}]},
    {name:"Show description history",icon:"undo",divider:true,run:()=>reopen("history")},
    ...(!isLocalIssue(issue.key)?[{name:"Restore mirrored Jira version",icon:"redo" as const,run:()=>void actions.restoreJira(issue.key)}]:[]),
    {name:"Delete",icon:"trash",shortcut:keys("delete"),danger:true,run:()=>actions.remove(issue.key)},
  ];
  return <ActionMenu anchor={document.getElementById("issue-options")} entries={entries} label="Issue options" close={close}/>;
}

export function Attachments({attachments=[],onChange,onBusy,choose,issueKey,hideChooser=false}:{attachments:Issue["attachments"];onChange:(files:NonNullable<Issue["attachments"]>)=>void;onBusy?:(busy:boolean)=>void;choose?:(files:File[])=>void;issueKey?:string;hideChooser?:boolean}) {
  const file=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <div className="mt-3 text-[12px]">
    <input ref={file} type="file" multiple aria-label="Choose attachments" className="hidden" onChange={async e=>{
      const input=e.currentTarget,selected=[...(input.files??[])];
      if(choose){choose(selected);input.value="";return;}
      setBusy(true);onBusy?.(true);setError("");
      try {const files=await addLocalFiles(selected);onChange([...attachments,...files]);}
      catch(error){setError(error instanceof Error?error.message:"Could not save this file locally");}
      finally{input.value="";setBusy(false);onBusy?.(false);}
    }}/>
    {!hideChooser&&<button type="button" disabled={busy} aria-label="Attach images, files, or videos" onClick={()=>file.current?.click()} className="text-fg-3 hover:text-fg disabled:opacity-40">{busy?"Saving file…":"+ Attach file"}</button>}
    {error&&<p role="alert" className="mt-2 text-fg-3">{error}</p>}
    {attachments.map(a=><div key={a.id} className="relative mt-2">
      <MediaView node={{type:'media',attrs:{id:a.id,type:'file'}}} issueKey={issueKey} attachments={attachments}/>
      <button type="button" aria-label={`Remove attachment ${a.name}`} className="absolute right-1 -top-2 z-10 rounded bg-card p-1" onClick={()=>onChange(attachments.filter(f=>f.id!==a.id))}><Icon name="close"/></button>
    </div>)}
  </div>;
}

export function PersonalIssueDetails({issue}:{issue:Issue}) {
  const [reactionAnchor,setReactionAnchor]=useState<HTMLElement|null>(null);
  const toggleReaction=(emoji:string)=>actions.patch(issue.key,{reactions:issue.reactions?.includes(emoji)?issue.reactions.filter(r=>r!==emoji):[...(issue.reactions??[]),emoji]});
  const full=useStore(s=>s.full.get(issue.key));
  const embedded=new Set<string>();
  const mediaIds=(node:any)=>{if(!node||typeof node!=='object')return;if(['media','mediaInline'].includes(node.type)&&node.attrs?.id)embedded.add(String(node.attrs.id));for(const child of node.content??[])mediaIds(child);};
  for(const resource of issue.resources??[])resourceMediaIds(resource,embedded);
  mediaIds(full?.fields.description);for(const comment of full?.fields.comment?.comments??[])mediaIds(comment.body);
  const all=useStore(s=>s.issues);
  return <div className="mt-5 space-y-3 text-[12px]">
    {/* Linear (RAJ-52): 26px below the last paragraph, 6px left of the text and 16px above the sub-issues header, reaction pills 8px apart, then the round add-reaction and attach buttons. */}
    <div data-reactions className="-ml-1.5 flex flex-wrap items-center"><div className="flex flex-wrap items-center gap-2 empty:hidden [&:not(:empty)]:mr-2">{issue.reactions?.map(emoji=><button key={emoji} aria-label={`Remove ${emoji} reaction`} aria-pressed="true" title={`You reacted with :${shortcode(emoji)}:`} onClick={()=>toggleReaction(emoji)} className="reaction-pill"><span>{emoji}</span><span>1</span></button>)}</div><button aria-label="Add reaction" title="Add reaction" onClick={e=>setReactionAnchor(e.currentTarget)} className="round-action"><Icon name="smile" size={14}/></button><button type="button" aria-label="Attach images, files, or videos" title="Attach images, files, or videos" className="round-action" onClick={()=>document.getElementById('description')?.closest('.rich-editor')?.querySelector<HTMLInputElement>('input[type=file]')?.click()}><Icon name="paperclip" size={14}/></button></div>
    {reactionAnchor&&<ReactionPicker anchor={reactionAnchor} close={()=>setReactionAnchor(null)} choose={toggleReaction}/>}
    <Attachments hideChooser issueKey={issue.key} attachments={issue.attachments?.filter(a=>!embedded.has(a.id)&&!embedded.has(a.mediaId??""))} onChange={attachments=>actions.patch(issue.key,{attachments:[...(issue.attachments??[]).filter(a=>embedded.has(a.id)||embedded.has(a.mediaId??"")),...attachments]})}/>

    <SubIssues key={issue.key} issue={issue}/>
    <IssueResources issue={issue}/>
  </div>;
}

export function Subscribers({issue}:{issue:Issue}) {
 const issues=useStore(s=>s.issues);
 const people=[...new Map([ME,...(issue.watchers??[]),...[...issues.values()].flatMap(i=>[i.assignee,i.creator,...(i.watchers??[])].filter((u):u is NonNullable<typeof u>=>!!u))].map(user=>[user.id,user])).values()];
 return <Modal label="Change subscribers" anchorId="issue-subscribers" width={300} close={()=>ui.send({type:'overlay.close'})}><Command loop><Command.Input autoFocus aria-label="Change subscribers" placeholder="Change subscribers…" className={`${INPUT} mb-2`}/><Command.List className="max-h-[40vh] overflow-y-auto"><Command.Empty className="p-2">No people found</Command.Empty>{people.map(user=><Command.Item key={user.id} aria-checked={!!issue.watchers?.some(u=>u.id===user.id)} value={`${user.name} ${user.id}`} onSelect={()=>actions.patch(issue.key,{watchers:issue.watchers?.some(u=>u.id===user.id)?issue.watchers.filter(u=>u.id!==user.id):[...(issue.watchers??[]),user]})} className="flex items-center gap-2 rounded px-2 py-2 data-[selected=true]:bg-sel"><span aria-hidden className="grid size-4 place-items-center rounded border border-line-2">{issue.watchers?.some(u=>u.id===user.id)&&<Icon name="check" size={12}/>}</span><span>{user.name}</span>{issue.assignee?.id===user.id&&<span className="ml-auto text-[11px] text-fg-3">Assignee</span>}</Command.Item>)}</Command.List></Command></Modal>;
}

/** `close` lets a row menu open this for another issue (a sub-issue) without the global overlay. */
/** Linear's "Mark as" command menu (RAJ-52): the kind comes from the menu item, so there is no type picker; its placeholder, Create row and Enter hint follow the kind. */
const MARK:Record<string,{placeholder:string;enter:string;create?:string;draft?:"related"|"blocked"|"blocking"}>={
  related:{placeholder:"Search for issue to reference…",enter:"Mark as related",create:"Create new issue related to",draft:"related"},
  blocked:{placeholder:"Search for issue to mark blocked by…",enter:"Mark as blocked by",create:"Create new issue blocking",draft:"blocking"},
  blocking:{placeholder:"Search for issue to mark as blocked by {key}…",enter:"Mark as blocking",create:"Create new issue blocked by",draft:"blocked"},
  duplicate:{placeholder:"Search for issue to mark as duplicate of…",enter:"Select"},
  parent:{placeholder:"Search for issue to set as a parent…",enter:"Set as parent"},
  child:{placeholder:"Search for issue to add as a sub-issue…",enter:"Add as sub-issue"},
};
const INVERSE:Record<string,string>={blocked:"blocking",blocking:"blocked"};
export function Relations({issue,close:done}:{issue:Issue;close?:()=>void}) {
  const all=useStore(s=>s.issues),boards=useStore(s=>s.boards);const [query,setQuery]=useState(""),[selected,setSelected]=useState("");const kind=get().relationKind;const close=done??(()=>ui.send({type:"overlay.close"}));
  const mark=MARK[kind]??MARK.related!;
  // Linear leaves out issues the new link would repeat or contradict; "Related issues" offers this issue's related ones first.
  // ponytail: "Recent" is most recently updated; Linear uses recently viewed. "More actions" (⌥↵) and "Quick look" (→) are not built.
  const linked=new Set((issue.relations??[]).filter(r=>kind==="related"||r.kind===kind||r.kind===INVERSE[kind]).map(r=>r.key));
  if(kind==="parent"||kind==="child")for(const i of all.values())if(i.parent===issue.key||i.key===issue.parent)linked.add(i.key);
  const words=query.toLowerCase().split(/\s+/).filter(Boolean),fits=(i:Issue)=>i.key!==issue.key&&!linked.has(i.key)&&words.every(w=>`${i.key} ${i.summary}`.toLowerCase().includes(w));
  const relatedIssues=["blocked","blocking","duplicate"].includes(kind)?(issue.relations??[]).filter(r=>r.kind==="related").map(r=>all.get(r.key)).filter((i):i is Issue=>!!i&&fits(i)):[];
  const recent=useMemo(()=>[...all.values()].filter(fits).sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,query?40:8),[all,query,kind]);
  const add=(target:Issue)=> {
    if(kind==="parent") {
      let ancestor:Issue|undefined=target;const seen=new Set([issue.key]);
      while(ancestor){if(seen.has(ancestor.key)){set({perf:"A parent cannot be its own descendant"});return;}seen.add(ancestor.key);ancestor=ancestor.parent?all.get(ancestor.parent):undefined;}
      actions.patch(issue.key,{parent:target.key});
    }else if(kind==="child") {
      for(let ancestor:Issue|undefined=issue;ancestor;ancestor=ancestor.parent?all.get(ancestor.parent):undefined)if(ancestor.key===target.key){set({perf:"A parent cannot be its own descendant"});return;}
      actions.patch(target.key,{parent:issue.key});
    }else actions.relate(issue.key,target.key,kind);
    close();
  };
  const create=mark.create&&!query?()=>{close();beginCreate({related:{key:issue.key,kind:mark.draft!},project:issue.project});}:kind==="child"&&!query?()=>{close();requestAnimationFrame(()=>runShortcut("sub-issue"));}:null;
  const row=(i:Issue,group:string)=><Command.Item key={`${group}${i.key}`} value={group==="related"?`related:${i.key}`:i.key} onSelect={()=>add(i)} className="mark-row"><span className="grid size-4 place-items-center"><StatusIcon status={statusOf(boards,i)}/></span><span className="text-[var(--menu-fg-3)]">{i.key}</span><span className="truncate text-[var(--menu-fg)]">{i.summary}</span></Command.Item>;
  return <Modal label="Issue relations" close={close} command width={720}>
    <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} data-kind={kind} className="flex min-h-0 flex-col">
      <div className="px-1.5 pt-1.5"><Command.Input autoFocus aria-label="Find related issue" placeholder={mark.placeholder.replace("{key}",issue.key)} className="h-10 w-full rounded-xl bg-transparent px-3 text-[13px] text-[var(--menu-fg)] outline-none placeholder:text-[var(--menu-placeholder)]" value={query} onValueChange={setQuery}/></div>
      <Command.List className="mark-list min-h-0 flex-1 overflow-y-auto p-1.5">
        {relatedIssues.length>0&&<Command.Group heading="Related issues">{relatedIssues.map(i=>row(i,"related"))}</Command.Group>}
        {recent.length>0&&(kind==="parent"&&!query?recent.map(i=>row(i,"recent")):<Command.Group heading={query?"Issues":"Recent"}>{recent.map(i=>row(i,"recent"))}</Command.Group>)}
        {create&&<Command.Group heading="Create"><Command.Item value="create" onSelect={create} className="mark-row"><Icon name="plus" size={16}/><span className="flex-1 truncate text-[var(--menu-fg)]">{kind==="child"?"Add sub-issue…":`${mark.create} ${issue.key}…`}</span>{kind==="child"&&<kbd>{shortcutLabel("sub-issue")}</kbd>}</Command.Item></Command.Group>}
        <Command.Empty className="px-3 py-3 text-[13px] text-fg-3">No matching issues</Command.Empty>
      </Command.List>
      <div className="mark-footer"><span><kbd>↵</kbd>{selected==="create"?"Select":mark.enter}</span></div>
    </Command>
  </Modal>;
}

export function SaveViewButton() {
  const [open,setOpen]=useState(false),[name,setName]=useState("");
  return <><button aria-label="Save current view" title="Save current view" onClick={()=>setOpen(true)} className="grid size-7 place-items-center rounded-full border-[0.5px] border-transparent text-fg-4 hover:bg-hover hover:text-fg-3"><Icon name="view" size={16}/></button>{open&&<Modal label="Save personal view" close={()=>setOpen(false)}><form onSubmit={e=>{e.preventDefault();saveView(name);setOpen(false);setName("");}}><label className="text-[12px]">View name<input autoFocus aria-label="View name" value={name} onChange={e=>setName(e.target.value)} className={`${INPUT} mt-2`}/></label><p className="mt-2 text-[12px] text-fg-3">Saves this board's filters, layout, and issue scope in your browser.</p><div className="mt-4 flex justify-end gap-2"><button type="button" className={BUTTON} onClick={()=>setOpen(false)}>Cancel</button><button disabled={!name.trim()} className={BUTTON}>Save view</button></div></form></Modal>}</>;
}

export function SavedViews() {
  const views=useStore(s=>s.savedViews);
  const [editing,setEditing]=useState<string|null>(null),[name,setName]=useState("");
  if(!views.length)return null;
  return <div className="mt-5"><div className="mb-1 px-2 text-[12px] text-fg-3">Saved views</div>{views.map(view=><div key={view.id} className="group flex items-center gap-1 rounded-lg hover:bg-hover"><button onClick={()=>openSavedView(view)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-fg-2"><Icon name="filter"/><span className="truncate">{view.name}</span></button><button aria-label={`Edit view ${view.name}`} onClick={()=>{setEditing(view.id);setName(view.name);}} className="mr-1 p-1 text-fg-3 hover:text-fg"><Icon name="dots"/></button></div>)}{editing&&<Modal label="Edit personal view" close={()=>setEditing(null)}><form onSubmit={e=>{e.preventDefault();if(!name.trim())return;set({savedViews:views.map(v=>v.id===editing?{...v,name:name.trim()}:v)});setEditing(null);}}><input aria-label="View name" className={INPUT} value={name} onChange={e=>setName(e.target.value)}/><div className="mt-3 flex gap-2"><button type="button" className={`${BUTTON} mr-auto`} onClick={()=>{set({savedViews:views.filter(v=>v.id!==editing)});setEditing(null);}}>Remove view</button><button type="button" className={BUTTON} onClick={()=>setEditing(null)}>Cancel</button><button disabled={!name.trim()} className={BUTTON}>Save view</button></div></form></Modal>}</div>;
}

export function Favorites() {
  const favorites=useStore(s=>s.favorites),boards=useStore(s=>s.boards),issues=useStore(s=>s.issues);
  if(!favorites.length)return null;
  return <div className="mt-5"><div className="mb-1 px-2 text-[12px] text-fg-3">Favorites</div>{favorites.map(id=> {
    const document=id.startsWith('document:')?findIssueDocument(issues.values(),id.slice(9)):undefined;
    if(document)return <button key={id} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fg-2 hover:bg-hover" onClick={()=>navigate({board:document.issue.board,selected:document.issue.key,panel:true,document:document.resource.id})}><Icon name="file"/><span className="truncate">{document.resource.title||'New document'}</span></button>;
    const [,boardId]=id.split(":"),board=boards.find(b=>b.id===Number(boardId)),issue=issues.get(id);
    if(!board&&!issue)return null;
    return <button key={id} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fg-2 hover:bg-hover" onClick={()=>{if(issue)navigate({board:issue.board,selected:issue.key,panel:true});else if(board)navigate({board:board.id,panel:false,selected:null});}}><span className="text-fg-3">☆</span><span className="truncate">{issue?`${issue.key} ${issue.summary}`:board!.name}</span></button>;
  })}</div>;
}
