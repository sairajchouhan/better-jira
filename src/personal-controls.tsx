import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Adf, adfToText } from "./adf";
import { RichEditor } from "./rich-editor-loader";
import { normalizeDocument } from "./document";
import { Icon } from "./icons";
import { actions, addLocalFile, beginCreate, boardOf, changePreferences, get, issueURL, isLocalIssue, ME, openSavedView, preferencesFor, saveView, set, useStore, type Board, type Issue, type IssueDraft } from "./store";
import { buckets, newId, type Field, type Grouping } from "./view-model";

const INPUT="w-full rounded-md border border-line-2 bg-card px-3 py-2 text-fg outline-none focus:border-accent";
const BUTTON="rounded-md px-3 py-1.5 text-fg-2 hover:bg-hover disabled:opacity-40";
const SELECT="min-w-0 rounded-md border border-line-2 bg-card px-2 py-1.5 text-[12px] text-fg-2 outline-none focus:border-accent";

export { MenuSurface as Modal } from "./menu-surface";
import { MenuSurface as Modal } from "./menu-surface";
import { lazy,Suspense } from "react";
const DateInput=lazy(()=>import("./date-input").then(module=>({default:module.DateInput})));
import { ReactionPicker } from "./reactions";
import { copyKinds,issueCopy,type CopyKind } from "./issue-copy";

export function CreateIssue() {
  const board=useStore(s=>s.boards.find(b=>b.id===s.board))!;
  const all=useStore(s=>s.issues);
  const initial=useStore(s=>s.draft);
  const [draft,setDraft]=useState<IssueDraft>(initial);
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState(()=>normalizeDocument(""));
  const [draftIndex,setDraftIndex]=useState(0);
  const [labels,setLabels]=useState(initial.labels?.join(", ")??"");
  const [more,setMore]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [attachments,setAttachments]=useState<Issue["attachments"]>([]);
  const [filesBusy,setFilesBusy]=useState(false);
  const [dateValid,setDateValid]=useState(true);
  const titleRef=useRef<HTMLInputElement>(null);
  const issues=[...all.values()].filter(i=>i.board===board.id);
  const users=[...new Map([[ME.id,ME] as const,...issues.flatMap(i=>i.assignee?[[i.assignee.id,i.assignee] as const]:[])]).values()];
  const projects=[...new Map(issues.flatMap(i=>i.project?[[i.project.key,i.project] as const]:[])).values()];
  const priorities=[...new Set(["Normal",...issues.flatMap(i=>i.priority?[i.priority]:[])])];
  const types=[...new Set(["Task",...issues.flatMap(i=>i.type?[i.type]:[])])];
  const milestones=[...new Map(issues.filter(i=>i.project?.key===(draft.project?.key??projects[0]?.key)).flatMap(i=>(i.milestones??[]).map(m=>[m.id,m] as const))).values()];
  const close=()=>set({overlay:null,draft:{}});
  const submit=()=> {
    if(!title.trim()||filesBusy||!dateValid)return;
    const key=actions.create(title,{...draft,...(draft.priority===""?{priority:undefined}:{}),descriptionDoc:description,attachments,labels:[...new Set(labels.split(",").map(l=>l.trim()).filter(Boolean))]},more);
    if(key&&more){setTitle("");setDescription(normalizeDocument(""));setDraftIndex(n=>n+1);setAttachments([]);titleRef.current?.focus();}
  };
  return <Modal label="Create issue" close={close}>
    <form onSubmit={e=>{e.preventDefault();submit();}} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();submit();}}}>
      <div className="mb-3 flex items-center gap-2 text-[12px] text-fg-3"><span className="flex-1 truncate">{board.name} › {initial.parent?`Sub-issue of ${initial.parent}`:"New issue"}</span><button type="button" aria-label={expanded?"Collapse editor":"Expand editor"} onClick={()=>setExpanded(!expanded)} className={BUTTON}><Icon name="expand"/></button><button type="button" aria-label="Close" onClick={close} className={BUTTON}><Icon name="close"/></button></div>
      <input ref={titleRef} aria-label="Issue title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Issue title" className="mb-2 w-full bg-transparent py-1 text-[18px] font-medium text-fg outline-none"/>
      <RichEditor key={draftIndex} id="create-description" initial={description} onChange={setDescription} expanded={expanded}/>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Issue type" className={SELECT} value={draft.type??"Task"} onChange={e=>setDraft({...draft,type:e.target.value})}>{types.map(type=><option key={type}>{type}</option>)}</select>
        <select aria-label="Status" className={SELECT} value={draft.status??board.columns[0]?.statuses[0]?.id} onChange={e=>setDraft({...draft,status:e.target.value})}>{board.columns.flatMap(c=>c.statuses).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select aria-label="Priority" className={SELECT} value={draft.priority??"Normal"} onChange={e=>setDraft({...draft,priority:e.target.value})}><option value="">No priority</option>{priorities.map(p=><option key={p}>{p}</option>)}</select>
        <select aria-label="Assignee" className={SELECT} value={draft.assignee?.id??""} onChange={e=>setDraft({...draft,assignee:users.find(u=>u.id===e.target.value)??null})}><option value="">Unassigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select aria-label="Project" className={SELECT} value={draft.project===null?"":draft.project?.key??projects[0]?.key??""} onChange={e=>setDraft({...draft,project:projects.find(p=>p.key===e.target.value)??null,milestones:[]})}><option value="">No project</option>{projects.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select>
        <select aria-label="Milestone" className={SELECT} value={draft.milestones?.[0]?.id??""} onChange={e=>setDraft({...draft,milestones:milestones.filter(m=>m.id===e.target.value)})}><option value="">No milestone</option>{milestones.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <details className="w-full text-[12px] text-fg-3"><summary className="cursor-pointer py-1">Due date{draft.due?`: ${draft.due}`:""}</summary><Suspense fallback={<p>Loading dates…</p>}><DateInput value={draft.due??""} onChange={due=>setDraft({...draft,due:due||null})} onValidity={setDateValid}/></Suspense></details>
      </div>
      <input aria-label="Labels, comma separated" value={labels} onChange={e=>setLabels(e.target.value)} placeholder="Labels, separated by commas" className={`${INPUT} mt-3 text-[12px]`}/>
      <Attachments attachments={attachments} onChange={setAttachments} onBusy={setFilesBusy}/>
      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3"><label className="mr-auto flex items-center gap-2 text-[12px]"><input type="checkbox" checked={more} onChange={e=>setMore(e.target.checked)}/>Create more</label><button type="button" onClick={close} className={BUTTON}>Cancel</button><button type="submit" disabled={!title.trim()||filesBusy||!dateValid} className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-40">Create issue</button></div>
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
  const close=()=>set({overlay:null});
  const multi=field==="labels";
  const label={priority:"Set priority",labels:"Change labels",project:"Change project",milestone:"Set milestone",due:"Due date"}[field];
  let choices:Choice[]=[];
  if(field==="priority")choices=[{id:"",name:"No priority"},...[...new Set(issues.flatMap(i=>i.priority?[i.priority]:[]))].map(p=>({id:p,name:p}))];
  if(field==="labels")choices=[...new Set(issues.flatMap(i=>i.labels))].map(l=>({id:l,name:l}));
  if(field==="project")choices=[{id:"",name:"No project"},...[...new Map(issues.flatMap(i=>i.project?[[i.project.key,{id:i.project.key,name:i.project.name}] as const]:[])).values()]];
  if(field==="milestone")choices=[{id:"",name:"No milestone"},...[...new Map(issues.filter(i=>i.project?.key===issue.project?.key).flatMap(i=>(i.milestones??[]).map(m=>[m.id,m] as const))).values()]];
  const selected=(id:string)=>field==="labels"?issue.labels.includes(id):field==="priority"?(issue.priority??"")===id:field==="project"?(issue.project?.key??"")===id:(issue.milestones?.[0]?.id??"")===id;
  const choose=(c:Choice)=> {
    if(field==="labels")actions.patch(issue.key,{labels:selected(c.id)?issue.labels.filter(l=>l!==c.id):[...issue.labels,c.id]});
    if(field==="priority")actions.patch(issue.key,{priority:c.id||undefined});
    if(field==="project")actions.patch(issue.key,{project:issues.find(i=>i.project?.key===c.id)?.project??null,milestones:[]});
    if(field==="milestone")actions.patch(issue.key,{milestones:c.id?[c]:[]});
    if(!multi)close();else setQuery("");
  };
  return <Modal label={label} close={close} anchorId={`prop-${field}`} width={360}>
    {field==="due"?<form onSubmit={e=>{e.preventDefault();if(!dateValid)return;actions.patch(issue.key,{due:date||null});close();}}><div className="mb-3"><Suspense fallback={<p>Loading dates…</p>}><DateInput value={date} onChange={setDate} onValidity={setDateValid}/></Suspense></div><div className="flex justify-end gap-2"><button type="button" className={BUTTON} onClick={()=>{actions.patch(issue.key,{due:null});close();}}>Remove due date</button><button className={BUTTON} type="submit" disabled={!dateValid}>Save</button></div></form>:<Command loop>
      <Command.Input autoFocus aria-label={label} placeholder={`${label}…`} value={query} onValueChange={setQuery} className={`${INPUT} mb-2`}/>
      <Command.List className="max-h-[45vh] overflow-y-auto [&_[data-selected=true]]:bg-sel">
        <Command.Empty className="p-2 text-fg-3">No matches</Command.Empty>
        {choices.map(c=><Command.Item key={c.id} value={c.name} onSelect={()=>choose(c)} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2"><span className="flex-1">{c.name}</span>{selected(c.id)&&<Icon name="check"/>}</Command.Item>)}
        {multi&&query.trim()&&!choices.some(c=>c.id.toLowerCase()===query.trim().toLowerCase())&&<Command.Item value={`Create ${query}`} onSelect={()=>choose({id:query.trim(),name:query.trim()})} className={BUTTON}>Create label "{query.trim()}"</Command.Item>}
      </Command.List>
      {multi&&<div className="mt-3 flex justify-end"><button className={BUTTON} onClick={close}>Done</button></div>}
    </Command>}
  </Modal>;
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
  const full=useStore(s=>s.full.get(issue.key));
  const description=issue.description??adfToText(full?.fields.description);
  const close=()=>set({overlay:null});
  const [historyOpen,setHistoryOpen]=useState(false);
  const [linkOpen,setLinkOpen]=useState(false),[link,setLink]=useState("");
  const [linkError,setLinkError]=useState("");
  const [copyOpen,setCopyOpen]=useState(false);
  const copy=async(kind:CopyKind)=> {
    const status=boardOf(issue.key)?.columns.flatMap(c=>c.statuses).find(s=>s.id===issue.status)?.name??issue.status;
    try{await navigator.clipboard.writeText(issueCopy(kind,issue,full,issueURL(issue),status));set({perf:`Copied ${kind}`});}catch{set({perf:"Could not access the clipboard"});}close();
  };
  const item=(label:string,run:()=>void)=><Command.Item key={label} value={label} onSelect={run} className="cursor-pointer rounded-md px-3 py-2 data-[selected=true]:bg-sel">{label}</Command.Item>;
  if(historyOpen)return <Modal label="Description history" close={close}><h3 className="mb-3 font-medium">Description history</h3><p className="mb-3 text-[12px] text-fg-3">Your locally saved description revisions.</p>{[...(issue.descriptionHistory??[])].reverse().map((entry,index)=><div key={index} className="mb-3 rounded-md border border-line-2 p-3"><div className="mb-2 text-[11px] text-fg-3">{new Date(entry.at).toLocaleString()}</div><div>{entry.document?<Adf node={entry.document}/>:<p className="whitespace-pre-wrap">{entry.text||"Empty description"}</p>}</div><button className={`${BUTTON} mt-2`} onClick={()=>{actions.description(issue.key,entry.document??entry.text);close();}}>Restore this description</button></div>)}{!issue.descriptionHistory?.length&&<p>No local description changes yet.</p>}<button onClick={close} className={`${BUTTON} mt-3`}>Close</button></Modal>;
  if(linkOpen)return <Modal label="Add link" close={close}><form onSubmit={e=>{e.preventDefault();try{const url=new URL(link);if(!["http:","https:"].includes(url.protocol))throw new Error();actions.patch(issue.key,{links:[...new Set([...(issue.links??[]),url.href])]});close();}catch{setLinkError("Enter an http or https URL");}}}><input autoFocus aria-label="Link URL" type="url" required value={link} onChange={e=>setLink(e.target.value)} className={INPUT}/>{linkError&&<p role="alert" className="mt-2 text-[12px]">{linkError}</p>}<div className="mt-3 flex justify-end"><button className={BUTTON}>Add link</button></div></form></Modal>;
  if(copyOpen)return <Modal label="Copy issue" close={()=>setCopyOpen(false)} anchorId="issue-options" width={300}><div onKeyDown={e=>{if(e.key==="ArrowLeft"){e.preventDefault();setCopyOpen(false);}}}><Command loop><Command.Input aria-label="Find copy action" placeholder="Copy…" className={`${INPUT} mb-2`}/><Command.List>{item("Back to issue options",()=>setCopyOpen(false))}{copyKinds.map(kind=>item(`Copy ${kind}`,()=>void copy(kind)))}</Command.List></Command></div></Modal>;
  return <Modal label="Issue options" close={close} anchorId="issue-options" width={300}><Command loop onKeyDown={e=>{if(e.key==="ArrowRight"&&document.querySelector("[cmdk-item][data-selected=true]")?.getAttribute("data-value")==="Copy…"){e.preventDefault();setCopyOpen(true);}}}><Command.Input aria-label="Find action" placeholder="Find action…" className={`${INPUT} mb-2`}/><Command.List className="max-h-[55vh] overflow-y-auto">
    <Command.Empty>No action found</Command.Empty>
    {item("Set due date",()=>set({overlay:"due"}))}
    {item("Change relations",()=>set({overlay:"relations"}))}
    {item("Add link",()=>setLinkOpen(true))}
    {item("Show description history",()=>setHistoryOpen(true))}
    {item("Add sub-issue",()=>beginCreate({parent:issue.key,project:issue.project}))}
    {item("Make a copy",()=>actions.duplicate(issue.key))}
    {item("Copy…",()=>setCopyOpen(true))}
    {!isLocalIssue(issue.key)&&item("Restore mirrored Jira version",()=>void actions.restoreJira(issue.key))}
    {item("Delete issue locally",()=>actions.remove(issue.key))}
  </Command.List></Command></Modal>;
}

export function Attachments({attachments=[],onChange,onBusy}:{attachments:Issue["attachments"];onChange:(files:NonNullable<Issue["attachments"]>)=>void;onBusy?:(busy:boolean)=>void}) {
  const file=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <div className="mt-3 text-[12px]">
    <input ref={file} type="file" multiple aria-label="Choose attachments" className="hidden" onChange={async e=>{
      const input=e.currentTarget,selected=[...(input.files??[])];
      setBusy(true);onBusy?.(true);setError("");
      try {const files=await Promise.all(selected.map(addLocalFile));onChange([...attachments,...files]);}
      catch(error){setError(error instanceof Error?error.message:"Could not save this file locally");}
      finally{input.value="";setBusy(false);onBusy?.(false);}
    }}/>
    <button type="button" disabled={busy} aria-label="Attach images, files, or videos" onClick={()=>file.current?.click()} className="text-fg-3 hover:text-fg disabled:opacity-40">{busy?"Saving file…":"+ Attach file"}</button>
    {error&&<p role="alert" className="mt-2 text-fg-3">{error}</p>}
    {attachments.map(a=><div key={a.id} className="mt-2 flex items-center gap-2 rounded-md border border-line-2 px-2 py-1.5">
      {a.missing?<span className="min-w-0 flex-1 truncate text-fg-3">{a.name} · file unavailable</span>:<a className="min-w-0 flex-1 truncate text-accent" href={a.url} download={a.name}>{a.name}</a>}
      <span className="text-fg-3">{Math.ceil(a.size/1024)} KB</span><button type="button" aria-label={`Remove attachment ${a.name}`} onClick={()=>onChange(attachments.filter(f=>f.id!==a.id))}><Icon name="close"/></button>
    </div>)}
  </div>;
}

export function PersonalIssueDetails({issue}:{issue:Issue}) {
  const [reactionAnchor,setReactionAnchor]=useState<HTMLElement|null>(null);
  const subscribed=issue.watchers?.some(u=>u.id===ME.id);
  const toggleReaction=(emoji:string)=>actions.patch(issue.key,{reactions:issue.reactions?.includes(emoji)?issue.reactions.filter(r=>r!==emoji):[...(issue.reactions??[]),emoji]});
  const all=useStore(s=>s.issues),children=[...all.values()].filter(i=>i.parent===issue.key);
  return <div className="mt-4 space-y-3 text-[12px]">
    <div className="flex flex-wrap items-center gap-2">{issue.reactions?.map(emoji=><button key={emoji} aria-label={`Remove ${emoji} reaction`} onClick={()=>toggleReaction(emoji)} className="rounded-md bg-sel px-2 py-1">{emoji} 1</button>)}<button aria-label="Add reaction" onClick={e=>setReactionAnchor(e.currentTarget)} className="text-fg-3 hover:text-fg">Add reaction</button><button onClick={()=>actions.patch(issue.key,{watchers:subscribed?(issue.watchers??[]).filter(u=>u.id!==ME.id):[...(issue.watchers??[]),ME]})} className="ml-auto text-fg-3 hover:text-fg">{subscribed?"Unsubscribe":"Subscribe"}</button></div>
    {reactionAnchor&&<ReactionPicker anchor={reactionAnchor} close={()=>setReactionAnchor(null)} choose={toggleReaction}/>}
    <Attachments attachments={issue.attachments} onChange={attachments=>actions.patch(issue.key,{attachments})}/>
    {issue.links?.map(url=><div key={url} className="flex items-center gap-2"><a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-accent">{url}</a><button aria-label={`Remove link ${url}`} onClick={()=>actions.patch(issue.key,{links:issue.links?.filter(l=>l!==url)})}><Icon name="close"/></button></div>)}
    {issue.parent&&<div className="flex items-center gap-2 text-fg-3">Parent <button className="text-accent" onClick={()=>{const parent=all.get(issue.parent!);if(parent)set({board:parent.board,selected:parent.key,panel:true});}}>{issue.parent}</button><button aria-label="Remove parent" onClick={()=>actions.patch(issue.key,{parent:undefined})}><Icon name="close"/></button></div>}
    {issue.relations?.map(r=><div key={`${r.kind}:${r.key}`} className="flex items-center gap-2"><span className="text-fg-3">{({related:"Related to",blocked:"Blocked by",blocking:"Blocking",duplicate:"Duplicate of"} as Record<string,string>)[r.kind]??r.kind}</span><button className="text-accent" onClick={()=>{const target=all.get(r.key);if(target)set({board:target.board,selected:target.key,panel:true});}}>{r.key}</button><button aria-label={`Remove ${r.kind} relation ${r.key}`} onClick={()=>actions.relate(issue.key,r.key,r.kind,true)}><Icon name="close"/></button></div>)}
    {children.map(child=><button key={child.key} onClick={()=>set({selected:child.key,panel:true})} className="flex w-full gap-2 rounded-md border border-line-2 px-3 py-2 text-left"><span className="text-fg-3">{child.key}</span><span className="truncate">{child.summary}</span></button>)}
    <button onClick={()=>beginCreate({parent:issue.key,project:issue.project})} className="text-fg-3 hover:text-fg">+ Add sub-issues</button>
  </div>;
}

export function Relations({issue}:{issue:Issue}) {
  const all=useStore(s=>s.issues);const [query,setQuery]=useState("");const [kind,setKind]=useState("related");const close=()=>set({overlay:null});
  const candidates=useMemo(()=>[...all.values()].filter(i=>i.key!==issue.key&&`${i.key} ${i.summary}`.toLowerCase().includes(query.toLowerCase())).slice(0,40),[all,issue.key,query]);
  const add=(target:Issue)=> {
    if(kind==="parent") {
      let ancestor:Issue|undefined=target;const seen=new Set([issue.key]);
      while(ancestor){if(seen.has(ancestor.key)){set({perf:"A parent cannot be its own descendant"});return;}seen.add(ancestor.key);ancestor=ancestor.parent?all.get(ancestor.parent):undefined;}
      actions.patch(issue.key,{parent:target.key});
    }else actions.relate(issue.key,target.key,kind);
    close();
  };
  return <Modal label="Issue relations" close={close}><select aria-label="Relation" className={`${SELECT} mb-3`} value={kind} onChange={e=>setKind(e.target.value)}>{[["related","Related to"],["blocked","Blocked by"],["blocking","Blocking"],["duplicate","Duplicate of"],["parent","Sub-issue of"]].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
    <input aria-label="Find related issue" placeholder="Search issues…" className={`${INPUT} mb-2`} value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="max-h-[40vh] overflow-y-auto">{candidates.map(i=><button key={i.key} onClick={()=>add(i)} className="flex w-full gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"><span className="shrink-0 text-fg-3">{i.key}</span><span className="truncate">{i.summary}</span></button>)}{!candidates.length&&<p>No matching issues</p>}</div>
  </Modal>;
}

export function SaveViewButton() {
  const [open,setOpen]=useState(false),[name,setName]=useState("");
  return <><button aria-label="Save current view" title="Save current view" onClick={()=>setOpen(true)} className="grid size-7 place-items-center rounded-full text-fg-3 hover:bg-hover"><Icon name="plus"/></button>{open&&<Modal label="Save personal view" close={()=>setOpen(false)}><form onSubmit={e=>{e.preventDefault();saveView(name);setOpen(false);setName("");}}><label className="text-[12px]">View name<input autoFocus aria-label="View name" value={name} onChange={e=>setName(e.target.value)} className={`${INPUT} mt-2`}/></label><p className="mt-2 text-[12px] text-fg-3">Saves this board's filters, layout, and issue scope in your browser.</p><div className="mt-4 flex justify-end gap-2"><button type="button" className={BUTTON} onClick={()=>setOpen(false)}>Cancel</button><button disabled={!name.trim()} className={BUTTON}>Save view</button></div></form></Modal>}</>;
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
    const [,boardId,scope]=id.split(":"),board=boards.find(b=>b.id===Number(boardId)),issue=issues.get(id);
    if(!board&&!issue)return null;
    return <button key={id} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fg-2 hover:bg-hover" onClick={()=>{if(issue)set({board:issue.board,selected:issue.key,panel:true});else if(board){set({board:board.id,panel:false,selected:null});changePreferences(board.id,{scope:scope==="active"?"active":scope==="backlog"?"backlog":"all"});}}}><span className="text-fg-3">☆</span><span className="truncate">{issue?`${issue.key} ${issue.summary}`:`${board!.name} · ${scope==="all"?"All issues":scope}`}</span></button>;
  })}</div>;
}
